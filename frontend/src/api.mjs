let csrfToken;
let csrfRequest;
export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}
const connectionMessage = 'The app could not connect. Please try again in a moment.';
async function requestJson(url, options = {}) {
  const canRetry = !options.method || options.method === 'GET';
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    } catch (error) {
      if (error.name === 'AbortError' || options.signal?.aborted) throw error;
      if (!canRetry || attempt === 3) throw new ApiError(connectionMessage, 0, {});
    }
    const data = response && await response.json().catch(() => null);
    // Vite returns an empty/HTML error while the API starts or restarts.
    // Only retry reads: an interrupted form submission may already have succeeded.
    if (canRetry && attempt < 3 && (!response ||
        (!data && [500, 502, 503, 504].includes(response.status)))) {
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      options.signal?.throwIfAborted();
      continue;
    }
    if (!data || typeof data !== 'object') throw new ApiError(connectionMessage, response.status || 503, {});
    if (!response.ok) throw new ApiError(data.message || 'The request failed.', response.status, data);
    return data;
  }
}
async function csrf() {
  if (!csrfRequest) csrfRequest = requestJson('/api/csrf')
    .then(data => {
      csrfToken = data.csrfToken;
      if (!csrfToken) throw new Error('Could not prepare a secure request.');
      return csrfToken;
    }).finally(() => { csrfRequest = null; });
  return csrfRequest;
}
export async function api(route, body, options = {}) {
  const method = body === undefined ? 'GET' : 'POST';
  try {
    if (method === 'POST' && !csrfToken) await csrf();
    let data;
    try {
      data = await requestJson(`/api${route}`, { method, signal: options.signal,
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      // A server restart changes the CSRF signing key. Refresh once; rejected requests have no side effects.
      if (error.status === 403 && error.data?.reason === 'csrf' && !options.retried) {
        csrfToken = null; await csrf(); return api(route, body, { ...options, retried: true });
      }
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError || error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the API. Please try again.', 0, {});
  }
}
