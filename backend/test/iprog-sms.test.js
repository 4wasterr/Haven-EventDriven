const test = require('node:test');
const assert = require('node:assert/strict');
const sms = require('../sms');
const { hashOtp, matchesOtp } = require('../otp');
const env = { IPROG_API_TOKEN: 'test-only-token', IPROG_API_URL: 'https://www.iprogsms.com/api/v1/' };
const deadline = { expiresAt: Date.UTC(2026, 9, 4, 0, 5), timeZone: 'Asia/Manila' };

test('iProg receives the Haven SMS body and international number and returns only its acceptance ID', async () => {
  const requests = [];
  const axiosClient = { async post(...args) {
    requests.push(args);
    return { status: 200, data: { status: 200, message_id: 'iSms-test', message: 'queued', otp_code: '654321' } };
  } };
  const result = await sms.createVerification({ to: '0917 123 4567', code: '654321', ...deadline }, { env, axiosClient });
  assert.deepEqual(result, { id: 'iSms-test' });
  assert.deepEqual(requests, [['https://www.iprogsms.com/api/v1/sms_messages', {
    api_token: env.IPROG_API_TOKEN, phone_number: '639171234567',
    message: 'Haven\nYour OTP is 654321\nExpires at Oct 4, 2026, 8:05 AM (Asia/Manila). Valid for 5 minutes.'
  }, { timeout: 10000, maxRedirects: 0 }]]);
});

test('SMS expiry follows the selected state time zone, including daylight saving and date rollover', async () => {
  const cases = [
    { expiresAt: deadline.expiresAt, timeZone: 'America/Los_Angeles', local: 'Oct 3, 2026, 5:05 PM' },
    { expiresAt: Date.UTC(2026, 0, 4, 0, 5), timeZone: 'America/Los_Angeles', local: 'Jan 3, 2026, 4:05 PM' },
    { expiresAt: deadline.expiresAt, timeZone: 'Asia/Kolkata', local: 'Oct 4, 2026, 5:35 AM' }
  ];
  for (const { local, ...expiry } of cases) {
    const axiosClient = { async post(url, payload) {
      assert.equal(payload.message, `Haven\nYour OTP is 654321\nExpires at ${local} (${expiry.timeZone}). Valid for 5 minutes.`);
      return { status: 200, data: { status: 200, message_id: 'iSms-localized' } };
    } };
    await sms.createVerification({ to: '+639171234567', code: '654321', ...expiry }, { env, axiosClient });
  }
});

test('iProg Invalid Token responses are configuration failures even with HTTP 200', async () => {
  for (const httpStatus of [200, 500]) {
    const axiosClient = { async post() {
      const response = { status: httpStatus, data: { status: 500, message: 'Invalid Token' } };
      if (httpStatus !== 200) throw { response };
      return response;
    } };
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '654321', ...deadline }, { env, axiosClient }), error => {
      assert.ok(error instanceof sms.SmsDeliveryError);
      assert.equal(error.status, 503);
      assert.equal(error.reason, 'sms_invalid_credentials');
      assert.match(error.diagnostic, /IPROG_API_TOKEN/);
      assert.doesNotMatch(`${error.message} ${error.diagnostic}`, /test-only-token|654321/);
      return true;
    });
  }
});

test('the account check validates credentials and credits without sending SMS', async () => {
  const requests = [];
  const axiosClient = { async get(...args) {
    requests.push(args);
    return { status: 200, data: { status: 'success', data: { load_balance: '10.5' } } };
  }, async post() { assert.fail('Account checks must not send SMS'); } };
  assert.deepEqual(await sms.checkSmsAccount({ env, axiosClient }), { credits: 10.5 });
  assert.deepEqual(requests, [['https://www.iprogsms.com/api/v1/account/sms_credits', {
    params: { api_token: env.IPROG_API_TOKEN }, timeout: 10000, maxRedirects: 0
  }]]);
  axiosClient.get = async () => ({ status: 200, data: { status: 'success', data: { load_balance: 0 } } });
  assert.deepEqual(await sms.checkSmsAccount({ env, axiosClient }), { credits: 0 });
  axiosClient.get = async () => ({ status: 200, data: { status: 500, message: 'Invalid Token' } });
  await assert.rejects(sms.checkSmsAccount({ env, axiosClient }), { status: 503, reason: 'sms_invalid_credentials' });
  for (const balance of [null, undefined, '', 'not-a-number', -1]) {
    axiosClient.get = async () => ({ status: 200, data: { status: 'success', data: { load_balance: balance } } });
    await assert.rejects(sms.checkSmsAccount({ env, axiosClient }), sms.SmsDeliveryError);
  }
  axiosClient.get = async () => { throw { response: { status: 401, data: { message: 'test-only-token 654321' } } }; };
  await assert.rejects(sms.checkSmsAccount({ env, axiosClient }), error => {
    assert.equal(error.reason, 'sms_invalid_credentials');
    assert.doesNotMatch(`${error.message} ${error.diagnostic}`, /test-only-token|654321/);
    return true;
  });
});

test('missing or invalid iProg settings and invalid codes never submit SMS', async () => {
  let calls = 0;
  const axiosClient = { async post() { calls++; throw new Error('Unexpected request'); } };
  for (const config of [{}, { ...env, IPROG_API_TOKEN: '  ' }, { ...env, IPROG_API_URL: 'bad-url' },
    { ...env, IPROG_API_URL: 'http://example.com' }, { ...env, IPROG_API_URL: 'https://user:pass@example.com' },
    { ...env, IPROG_API_URL: 'https://example.com?token=secret' }]) {
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '654321' }, { env: config, axiosClient }), sms.SmsConfigurationError);
  }
  for (const message of [{ to: 'invalid', code: '654321' }, { to: '+639171234567', code: '12345' },
    { to: '+639171234567', code: 654321 }, { to: '+639171234567', code: 'abcdef' }]) {
    await assert.rejects(sms.createVerification(message, { env, axiosClient }), sms.SmsDeliveryError);
  }
  assert.equal(calls, 0);
});

test('missing or invalid expiry/time zones cannot submit an SMS', async () => {
  const axiosClient = { async post() { assert.fail('Invalid expiry must not send SMS'); } };
  for (const expiry of [{}, { ...deadline, expiresAt: undefined }, { ...deadline, expiresAt: NaN },
    { ...deadline, expiresAt: 0 }, { ...deadline, expiresAt: Infinity }, { ...deadline, expiresAt: 1e20 },
    { ...deadline, timeZone: undefined }, { ...deadline, timeZone: 'invalid/zone' }]) {
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '654321', ...expiry }, { env, axiosClient }), sms.SmsDeliveryError);
  }
});

test('iProg error bodies, malformed acceptance responses and timeouts do not expose OTPs or credentials', async () => {
  const responses = [
    { status: 200, data: { status: 'error', message: 'secret test-only-token 654321' } },
    { status: 200, data: { status: 200 } },
    { status: 200, data: { status: 200, message_id: '' } },
    { status: 200, data: { status: 200, message_id: 'x'.repeat(256) } },
    { status: 500, data: { status: 200, message_id: 'iSms-test' } },
    { status: 200, data: null }
  ];
  for (const response of responses) {
    const axiosClient = { async post() { return response; } };
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '654321', ...deadline }, { env, axiosClient }), error => {
      assert.ok(error instanceof sms.SmsDeliveryError);
      assert.doesNotMatch(`${error.message} ${error.diagnostic}`, /test-only-token|654321/);
      return true;
    });
  }
  for (const status of [401, 429, 500, undefined]) {
    const axiosClient = { async post() { throw { message: 'test-only-token 654321', response: { status, data: 'test-only-token 654321' } }; } };
    await assert.rejects(sms.createVerification({ to: '+639171234567', code: '654321', ...deadline }, { env, axiosClient }), error => {
      assert.ok(error instanceof sms.SmsDeliveryError);
      assert.doesNotMatch(`${error.message} ${error.diagnostic}`, /test-only-token|654321/);
      return true;
    });
  }
});

test('persisted OTP verifiers are salted and bound to the registered account and phone', async () => {
  const account = { id: 'first-account', mobile_number: '+639171234567' };
  const hash = await hashOtp('654321', account);
  assert.notEqual(await hashOtp('654321', account), hash);
  assert.equal(await matchesOtp('654321', hash, account), true);
  assert.equal(await matchesOtp('654322', hash, account), false);
  assert.equal(await matchesOtp('654321', hash, { ...account, id: 'different-account' }), false);
  assert.equal(await matchesOtp('654321', hash, { ...account, mobile_number: '+639171234568' }), false);
  for (const value of [null, '654321', 'a'.repeat(64)]) assert.equal(await matchesOtp('654321', value, account), false);
});
