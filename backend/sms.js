const axios = require('axios');
const formatting = import('../frontend/src/format.mjs');

class SmsConfigurationError extends Error {
  constructor(diagnostic = 'Set IPROG_API_TOKEN in the backend environment.') {
    super('SMS verification is temporarily unavailable. Please try again later.');
    this.reason = 'sms_not_configured';
    this.diagnostic = diagnostic;
  }
}
class SmsDeliveryError extends Error {
  constructor(message, diagnostic, { status = 502, reason } = {}) {
    super(message);
    this.diagnostic = diagnostic;
    this.status = status;
    this.reason = reason;
  }
}

function providerFailure(data, httpStatus) {
  // iProg can return HTTP 200 with { status: 500, message: 'Invalid Token' }.
  // Classify known failures without logging raw bodies, credentials or OTPs.
  if (httpStatus === 401 || /^invalid(?:\s+api)?\s+token[.!]?$/i.test(String(data?.message || '').trim())) {
    return new SmsDeliveryError('SMS service authentication failed. Please contact support.',
      'iProg rejected IPROG_API_TOKEN. Set an active token from your iProg account in backend/.env and restart the backend.',
      { status: 503, reason: 'sms_invalid_credentials' });
  }
  const status = Number(httpStatus);
  return new SmsDeliveryError('Failed to send OTP via SMS. Please try again.',
    Number.isInteger(status) && status > 0 && status !== 200
      ? `iProg SMS request failed (HTTP ${status}).` : 'iProg did not accept the SMS request.');
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizePhoneNumber(value, defaultCountry = "PH") {
    if (!value || typeof value !== "string") {
        throw new SmsDeliveryError("A valid phone number is required.");
    }
    let cleaned = value.trim().replace(/[\s().-]/g, "");
    if (cleaned.startsWith("+")) {
        if (!E164_PATTERN.test(cleaned)) {
            throw new SmsDeliveryError("Phone number must follow international E.164 format (e.g., +639171234567).");
        }
        return cleaned;
    }

    // Philippines local format: 09XXXXXXXXX (11 digits) or 9XXXXXXXXX (10 digits)
    if (defaultCountry === "PH") {
        if (cleaned.startsWith("09") && cleaned.length === 11) {
            cleaned = "+63" + cleaned.slice(1);
        } else if (cleaned.startsWith("9") && cleaned.length === 10) {
            cleaned = "+63" + cleaned;
        } else if (/^639\d{9}$/.test(cleaned)) {
            cleaned = "+" + cleaned;
        }
    } else if (defaultCountry === "US" && cleaned.length === 10 && /^[2-9]/.test(cleaned)) {
        cleaned = "+1" + cleaned;
    } else if (defaultCountry === "GB" && cleaned.startsWith("07") && cleaned.length === 11) {
        cleaned = "+44" + cleaned.slice(1);
    } else {
        cleaned = "+" + cleaned;
    }

    if (!E164_PATTERN.test(cleaned)) {
        throw new SmsDeliveryError(`Phone number "${value}" cannot be formatted to a valid E.164 number (e.g., +639171234567).`);
    }
    return cleaned;
}

function getSmsConfiguration(env = process.env) {
  const apiToken = env.IPROG_API_TOKEN?.trim();
  if (!apiToken) throw new SmsConfigurationError();
  let url;
  try { url = new URL(env.IPROG_API_URL || 'https://www.iprogsms.com/api/v1'); }
  catch { throw new SmsConfigurationError('IPROG_API_URL must be an HTTPS API base URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new SmsConfigurationError('IPROG_API_URL must be an HTTPS API base URL without credentials, query parameters or fragments.');
  }
  return { apiToken, apiUrl: url.href.replace(/\/+$/, '') };
}

// Read-only credential/credit check: never submits a message or generates an OTP.
async function checkSmsAccount({ env = process.env, axiosClient = axios } = {}) {
  const config = getSmsConfiguration(env);
  let response;
  try {
    response = await axiosClient.get(`${config.apiUrl}/account/sms_credits`, {
      params: { api_token: config.apiToken }, timeout: 10000, maxRedirects: 0
    });
  } catch (error) {
    throw providerFailure(error.response?.data, error.response?.status);
  }
  const balance = response.data?.data?.load_balance;
  if (response.status !== 200 || response.data?.status !== 'success' ||
      !['number', 'string'].includes(typeof balance) || String(balance).trim() === '' ||
      !Number.isFinite(Number(balance)) || Number(balance) < 0) {
    throw providerFailure(response.data, response.status);
  }
  return { credits: Number(balance) };
}

// iProg transports the SMS; Haven generates and verifies the code locally.
async function createVerification({ to, code, expiresAt, timeZone }, { env = process.env, axiosClient = axios } = {}) {
  const config = getSmsConfiguration(env);
  const phone = normalizePhoneNumber(to);
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new SmsDeliveryError('A six-digit OTP is required.');
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || typeof timeZone !== 'string' || !timeZone) {
    throw new SmsDeliveryError('A valid OTP expiry and time zone are required.');
  }
  const { formatTime } = await formatting;
  let expiry;
  try { expiry = formatTime(expiresAt, timeZone); }
  catch { throw new SmsDeliveryError('A valid OTP expiry and time zone are required.'); }
  let response;
  try {
    response = await axiosClient.post(`${config.apiUrl}/sms_messages`, {
      api_token: config.apiToken,
      phone_number: phone.slice(1),
      message: `Haven\nYour OTP is ${code}\nExpires at ${expiry} (${timeZone}). Valid for 5 minutes.`
    }, { timeout: 10000, maxRedirects: 0 });
  } catch (error) {
    // Provider bodies and Axios errors can contain the OTP or API token.
    throw providerFailure(error.response?.data, error.response?.status);
  }
  const data = response.data;
  if (response.status !== 200 || ![200, '200', 'success'].includes(data?.status) ||
      typeof data?.message_id !== 'string' || !data.message_id.trim() || data.message_id.length > 255) {
    throw providerFailure(data, response.status);
  }
  return { id: data.message_id };
}
module.exports = { SmsConfigurationError, SmsDeliveryError, normalizePhoneNumber,
  getSmsConfiguration, checkSmsAccount, createVerification };
