const test = require('node:test');
const assert = require('node:assert/strict');
const email = require('../email');
const sms = require('../sms');
const { fetchHolidays, HolidayError } = require('../holidays');

test('legacy credentials cannot enable Brevo or iProg SMS and holidays require their own configuration', async () => {
  const env = { RESEND_API_KEY: 'removed-email-key', RESEND_FROM: 'sender@example.com',
    INFOBIP_API_KEY: 'removed-sms-key', INFOBIP_BASE_URL: 'https://unused.example',
    INFOBIP_2FA_APPLICATION_ID: 'old-app', INFOBIP_2FA_MESSAGE_ID: 'old-template',
    HOLIDAY_API_KEY: 'unrecognized-holiday-key' };
  const previous = globalThis.fetch;
  let requests = 0;
  const fetchImpl = async () => { requests++; throw new Error('Unexpected external request'); };
  globalThis.fetch = fetchImpl;
  const options = { env, fetchImpl };
  const unavailableHolidays = error => error instanceof HolidayError && error.reason === 'holiday_not_configured';
  try {
    const emailUnavailable = error => error instanceof email.EmailConfigurationError && error.reason === 'email_not_configured';
    const smsUnavailable = error => error instanceof sms.SmsConfigurationError && error.reason === 'sms_not_configured';
    assert.throws(() => email.getEmailConfiguration(env), emailUnavailable);
    assert.throws(() => sms.getSmsConfiguration(env), smsUnavailable);
    await assert.rejects(email.sendVerificationEmail({ to: 'recipient@example.com', token: 'a'.repeat(64) }, options), emailUnavailable);
    await assert.rejects(email.sendUnlockEmail({ to: 'recipient@example.com', token: 'a'.repeat(64) }, options), emailUnavailable);
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '123456' }, options), smsUnavailable);
    for (const year of [2020, 2026, 2027]) await assert.rejects(fetchHolidays(year, options), unavailableHolidays);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = previous; }
});

test('email and phone validation still work without providers', () => {
  assert.equal(email.isEmail('person@example.com'), true);
  for (const value of [null, 'missing-domain', 'a b@example.com', 'a'.repeat(256) + '@example.com']) assert.equal(email.isEmail(value), false);
  assert.equal(sms.normalizePhoneNumber('0917 123 4567'), '+639171234567');
  assert.equal(sms.normalizePhoneNumber('9171234567'), '+639171234567');
  assert.equal(sms.normalizePhoneNumber('639171234567'), '+639171234567');
  assert.equal(sms.normalizePhoneNumber('4155550123', 'US'), '+14155550123');
  assert.equal(sms.normalizePhoneNumber('07400123456', 'GB'), '+447400123456');
  assert.throws(() => sms.normalizePhoneNumber('invalid'), sms.SmsDeliveryError);
});
