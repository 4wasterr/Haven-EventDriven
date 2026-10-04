import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, birthdayError, internationalMobileNumber, postalCodeValid, passwordRules, suggestPassword, validateLogin, validateRegistration } from './validation.mjs';
import { YEARS, calendarCells } from './calendar.mjs';
import { countdown, timeZoneFor } from './format.mjs';

const today = new Date(2026, 9, 4);
const valid = { firstName: 'Anne-Marie', lastName: "O'Neil", middleInitial: 'M.', birthday: '10/04/2013',
  email: 'sample@gmail.com', country: 'PH', region: 'Metro Manila', city: 'Makati', postal: '1200',
  houseStreet: '24 Palm Street, Unit #2', mobile: '917 123 4567', password: 'GoodPassword!2026', confirmPassword: 'GoodPassword!2026' };
test('birthday requires an actual calendar date, MM/DD/YYYY, and the thirteenth birthday', () => {
  assert.equal(birthdayError('10/04/2013', today), ''); assert.match(birthdayError('10/05/2013', today), /13/);
  assert.match(birthdayError('10/04/2027', today), /future/);
  for (const date of ['2/01/2000', '02/30/2000', '02/29/2001', '13/01/2000', '00/15/2000', '01/00/2000', '2000-01-01']) assert.notEqual(birthdayError(date, today), '', date);
  assert.equal(birthdayError('02/29/2000', today), '');
});
test('registration validates names, initials, public providers, password limits and confirmation', () => {
  assert.deepEqual(validateRegistration(valid, today), {});
  for (const firstName of ['A', 'A'.repeat(51), 'Alex2', '---']) assert.ok(validateRegistration({ ...valid, firstName }, today).firstName);
  assert.deepEqual(validateRegistration({ ...valid, firstName: 'José', middleInitial: 'AB' }, today), {});
  assert.ok(validateRegistration({ ...valid, middleInitial: 'AB.' }, today).middleInitial);
  assert.ok(validateRegistration({ ...valid, email: 'employee@company.com' }, today).email);
  assert.ok(validateRegistration({ ...valid, password: 'short!', confirmPassword: 'short!' }, today).password);
  assert.ok(validateRegistration({ ...valid, password: 'A1!' + 'é'.repeat(40) }, today).password);
  assert.ok(validateRegistration({ ...valid, confirmPassword: 'goodPassword!2026' }, today).confirmPassword);
});
test('country, province, city, postal code and national mobile number must agree', () => {
  const address = { cities: [{ name: 'Makati' }], postalMode: 'select', postalCodes: [{ value: '1200' }] };
  for (const values of [{ country: 'unknown' }, { mobile: '09171234567' }, { postal: '1100' }, { city: 'Cebu City' }, { houseStreet: '<script>' }]) assert.ok(Object.keys(validateRegistration({ ...valid, ...values }, today, address)).length);
  assert.deepEqual(validateRegistration({ ...valid, country: 'US', region: 'California', city: 'San Francisco', postal: '94102', mobile: '4155550123' }, today), {});
  assert.deepEqual(validateRegistration({ ...valid, country: 'GB', region: 'England', city: 'London', postal: 'SW1A 1AA', mobile: '7400123456' }, today), {});
});
test('all countries, national mobile validation, and countries without postal codes are supported', () => {
  assert.equal(Object.keys(COUNTRIES).length, 250);
  for (const code of ['PH', 'IN', 'JP', 'AU', 'CA', 'AE', 'BR', 'ZA', 'NZ']) assert.ok(COUNTRIES[code]?.regions);
  assert.equal(Object.keys(COUNTRIES.PH.regions).length, 83);
  assert.equal(internationalMobileNumber('9123456789', 'IN'), '+919123456789');
  assert.equal(internationalMobileNumber('412345678', 'AU'), '+61412345678');
  assert.equal(internationalMobileNumber('123456', 'AU'), '');
  assert.equal(postalCodeValid('AE', 'N/A'), true);
  assert.equal(postalCodeValid('AE', '00000'), false);
  assert.equal(postalCodeValid('CA', 'K1A 0B1'), true);
  assert.equal(postalCodeValid('CA', '12345'), false);
  assert.equal(postalCodeValid('JP', '100-0001'), true);
  assert.equal(timeZoneFor({ country: 'IN', region: 'Maharashtra' }), 'Asia/Kolkata');
});
test('suggested passwords satisfy all required properties', () => {
  const passwords = new Set();
  for (let index=0; index<100; index++) { const password = suggestPassword(); passwords.add(password); assert.equal(password.length, 16); assert.ok(passwordRules(password).every(rule => rule.valid)); }
  assert.equal(passwords.size, 100);
});
test('login checks presence without registration composition rules', () => {
  assert.deepEqual(validateLogin({ email: 'any@company.com', password: 'x' }), {});
  assert.ok(validateLogin({ email: 'bad', password: '' }).email); assert.ok(validateLogin({ email: 'good@gmail.com', password: '' }).password);
});
test('calendar supports 2020–2027 and correctly aligns leap years and months', () => {
  assert.deepEqual(YEARS, [2020,2021,2022,2023,2024,2025,2026,2027]);
  assert.ok(calendarCells(2024,1).includes('2024-02-29')); assert.ok(!calendarCells(2023,1).includes('2023-02-29'));
  assert.equal(calendarCells(2026,0)[4], '2026-01-01'); assert.equal(calendarCells(2026,0).length % 7, 0);
  assert.equal(countdown(62000,1000), '1:01'); assert.equal(countdown(1000,62000), '0:00'); assert.equal(timeZoneFor(valid), 'Asia/Manila');
});
test('API client obtains CSRF, sends server credentials, and preserves delivery failures', async () => {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/csrf') return Response.json({ csrfToken: 'signed-token' });
    return Response.json({ message: 'Resend could not accept the email.', email_submitted: false }, { status: 201 });
  };
  try {
    const { api } = await import('./api.mjs?test=csrf');
    const result = await api('/register', valid);
    assert.equal(result.email_submitted, false); assert.equal(requests[0].url, '/api/csrf');
    assert.equal(requests[1].options.credentials, 'same-origin'); assert.equal(requests[1].options.headers['X-CSRF-Token'], 'signed-token');
    assert.equal(JSON.parse(requests[1].options.body).password, valid.password); assert.ok(!requests[1].options.body.includes('password_hash'));
  } finally { globalThis.fetch = previous; }
});
test('holiday requests use the selected year and provider failures remain errors', async () => {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ message: 'Holiday provider unavailable' }, { status: 502 }); };
  try {
    const { api, ApiError } = await import('./api.mjs?test=holidays');
    await assert.rejects(api('/holidays/2027'), error => error instanceof ApiError && error.status === 502);
    assert.equal(requests[0].url, '/api/holidays/2027'); assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests.length, 1, 'provider errors must not dispatch extra upstream requests');
  } finally { globalThis.fetch = previous; }
});

test('registration waits through temporary proxy failures before obtaining CSRF and submits once', async () => {
  const previous = globalThis.fetch, requests = [];
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/csrf') {
      reads++;
      if (reads === 1) return new Response('Proxy connection refused', { status: 500 });
      if (reads === 2) throw new TypeError('fetch failed');
      return Response.json({ csrfToken: 'new-token' });
    }
    return Response.json({ email_submitted: true }, { status: 201 });
  };
  try {
    const { api } = await import('./api.mjs?test=startup');
    assert.equal((await api('/register', valid)).email_submitted, true);
    assert.equal(reads, 3);
    assert.equal(requests.filter(request => request.options.method === 'POST').length, 1);
  } finally { globalThis.fetch = previous; }
});

test('a backend restart refreshes a rejected CSRF token once before submitting again', async () => {
  const previous = globalThis.fetch;
  let csrfReads = 0;
  const tokens = [];
  globalThis.fetch = async (url, options) => {
    if (url === '/api/csrf') return Response.json({ csrfToken: `token-${++csrfReads}` });
    tokens.push(options.headers['X-CSRF-Token']);
    return tokens.length === 1 ? Response.json({ message: 'Refresh the page.', reason: 'csrf' }, { status: 403 })
      : Response.json({ email_submitted: true }, { status: 201 });
  };
  try {
    const { api } = await import('./api.mjs?test=csrf-restart');
    assert.equal((await api('/register', valid)).email_submitted, true);
    assert.deepEqual(tokens, ['token-1', 'token-2']);
    assert.equal(csrfReads, 2);
  } finally { globalThis.fetch = previous; }
});

test('interrupted read requests recover, but interrupted form submissions are never replayed', async () => {
  const previous = globalThis.fetch;
  let reads = 0, posts = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/csrf') return Response.json({ csrfToken: 'signed-token' });
    if (options.method === 'POST') { posts++; throw new TypeError('connection interrupted after submission'); }
    if (++reads === 1) throw new TypeError('fetch failed');
    return Response.json({ pending: null, user: null });
  };
  try {
    const { api, ApiError } = await import('./api.mjs?test=reconnect');
    assert.deepEqual(await api('/session'), { pending: null, user: null });
    assert.equal(reads, 2);
    await assert.rejects(api('/register', valid), error => error instanceof ApiError && error.status === 0);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = previous; }
});

test('HTML responses cannot be treated as successful registration and retries are bounded', async () => {
  const previous = globalThis.fetch;
  let reads = 0, posts = 0;
  globalThis.fetch = async (url, options) => {
    if (url === '/api/csrf') return Response.json({ csrfToken: 'signed-token' });
    if (options.method === 'POST') { posts++; return new Response('<html>Wrong server</html>'); }
    reads++; return new Response('Proxy connection refused', { status: 500 });
  };
  try {
    const { api, ApiError } = await import('./api.mjs?test=invalid-response');
    await assert.rejects(api('/register', valid), ApiError);
    assert.equal(posts, 1);
    await assert.rejects(api('/session'), error => error instanceof ApiError && error.status === 500);
    assert.equal(reads, 4);
  } finally { globalThis.fetch = previous; }
});

test('cancelled address requests stop during reconnection instead of issuing another read', async () => {
  const previous = globalThis.fetch, controller = new AbortController();
  let reads = 0;
  globalThis.fetch = async () => {
    reads++; controller.abort(); return new Response('Proxy connection refused', { status: 500 });
  };
  try {
    const { api } = await import('./api.mjs?test=cancel-reconnect');
    await assert.rejects(api('/addresses/cities?country=PH&region=NCR', undefined, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(reads, 1);
  } finally { globalThis.fetch = previous; }
});
