const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { createApp, hashToken } = require('../app');
const { EmailDeliveryError } = require('../email');
const { SmsDeliveryError } = require('../sms');
const email = require('../email');
const disconnectedEmail = { ...email, getEmailConfiguration() { return email.getEmailConfiguration({}); } };
const sms = require('../sms');
const disconnectedSms = { ...sms, getSmsConfiguration() { return sms.getSmsConfiguration({}); },
  createVerification(message) { return sms.createVerification(message, { env: {} }); } };
const { MemoryStore } = require('./memory-store');
const registration = { firstName: 'Alex', lastName: 'Lopez', middleInitial: 'M.', birthday: '01/01/2000',
  password: 'StrongPassword!2026', confirmPassword: 'StrongPassword!2026', email: 'alex@gmail.com', mobile: '9171234567',
  houseStreet: '24 Palm Street', country: 'PH', city: 'Makati', region: 'Metro Manila', postal: '1200' };

async function harness(context, overrides = {}) {
  const store = overrides.store || new MemoryStore(), messages = [], smsRequests = [];
  let clock = Date.UTC(2026, 9, 4);
  const emailService = { getEmailConfiguration() {}, async sendVerificationEmail(message) { messages.push({ kind: 'verify', ...message }); },
    async sendUnlockEmail(message) { messages.push({ kind: 'unlock', ...message }); } };
  const smsService = { getSmsConfiguration() {}, async createVerification(message) { smsRequests.push(message); return { id: `sms_${smsRequests.length}` }; } };
  const server = createApp({ store, emailService, smsService, now: () => clock, env: {}, logger: { error() {} }, ...overrides }).listen(0, '127.0.0.1');
  await once(server, 'listening'); context.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  function cookies(response) { for (const item of response.headers.getSetCookie()) { const [name, value] = item.split(';')[0].split('='); jar[name] = value; } }
  const csrfResponse = await fetch(base + '/api/csrf'); cookies(csrfResponse); const csrfToken = (await csrfResponse.json()).csrfToken;
  async function request(route, body, headers = {}) {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; '), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    cookies(response); return { response, data: await response.json() };
  }
  async function register() { return request('/api/register', registration); }
  async function verifyEmail() { return request('/api/verify-email', { token: messages.find(message => message.kind === 'verify').token }); }
  const currentCode = () => smsRequests.at(-1).code;
  async function verified() { await register(); await verifyEmail(); await request('/api/verify-mobile', { code: currentCode() }); }
  return { store, messages, smsRequests, currentCode, emailService, smsService, request, register, verifyEmail, verified, jar, base,
    advance(milliseconds) { clock += milliseconds; } };
}

test('registration hashes passwords on the server, stores only hashed 24-hour tokens, and creates a restricted session', async t => {
  const h = await harness(t); const result = await h.register();
  assert.equal(result.response.status, 201); assert.equal(result.data.email_submitted, true);
  const user = h.store.state.users[0]; assert.match(user.password_hash, /^\$2b\$12\$/);
  assert.equal(user.email_verified_at, null); assert.equal(user.mobile_verified, 0);
  assert.ok(await bcrypt.compare(registration.password, user.password_hash));
  assert.equal(h.store.state.tokens[0].token_hash, hashToken(h.messages[0].token));
  assert.equal(h.store.state.tokens[0].expires_at.getTime() - Date.UTC(2026,9,4), 86400000);
  assert.equal((await h.request('/api/session')).data.user, null);
  assert.equal((await h.request('/api/accounts')).response.status, 401);
  assert.ok(result.response.headers.getSetCookie().some(value => value.includes('HttpOnly') && value.includes('SameSite=Lax')));
  assert.ok(!JSON.stringify(result.data).includes(registration.password));
});
test('server validation rejects corporate email, impossible birthday, underage users, weak passwords and supplied hashes', async t => {
  const h = await harness(t);
  for (const values of [{ email: 'employee@company.com' }, { birthday: '02/30/2000' }, { birthday: '10/05/2013' }, { password: 'short' }, { password_hash: 'injected' }]) {
    assert.equal((await h.request('/api/register', { ...registration, ...values })).response.status, 400);
  }
  assert.equal(h.store.state.users.length, 0); assert.equal(h.messages.length, 0);
});
test('public address APIs provide worldwide countries and dependent Caloocan postal areas', async t => {
  const h = await harness(t);
  const countries = await h.request('/api/addresses/countries');
  assert.equal(countries.response.status, 200);
  assert.equal(Object.keys(countries.data).length, 250);
  assert.equal(Object.keys(countries.data.PH.regions).length, 83);
  const cities = await h.request('/api/addresses/cities?country=PH&region=Metro%20Manila');
  assert.equal(cities.data.cities.length, 17);
  const postal = await h.request('/api/addresses/postal-codes?country=PH&region=Metro%20Manila&city=Caloocan%20City');
  assert.equal(postal.response.status, 200);
  assert.equal(postal.data.options.length, 23);
  assert.ok(postal.data.options.some(row => row.value === '1428' && row.label.includes('Bagong Silang')));
  assert.equal((await h.request('/api/addresses/postal-codes?country=PH&region=Cavite&city=Caloocan%20City')).response.status, 400);
  assert.equal((await h.request('/api/addresses/postal-codes?country=PH&region=Metro%20Manila&city=Fake')).response.status, 400);
  assert.equal(h.store.state.users.length, 0);
});

test('registration accepts the actual Caloocan postal area and rejects other city/province codes before sending email', async t => {
  const h = await harness(t), values = { ...registration, city: 'Caloocan City', postal: '1428', houseStreet: '24 Test Street, Bagong Silang' };
  for (const change of [{ postal: '1100' }, { postal: '4102' }, { region: 'Cavite' }]) {
    const result = await h.request('/api/register', { ...values, ...change });
    assert.equal(result.response.status, 400);
    assert.ok(result.data.errors.postal || result.data.errors.city);
  }
  assert.equal(h.store.state.users.length, 0); assert.equal(h.messages.length, 0);
  assert.equal((await h.request('/api/register', values)).response.status, 201);
  assert.equal(h.messages.length, 1);
});

test('CSRF and origin protections reject requests before registration side effects', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/register', registration, { 'X-CSRF-Token': '' })).response.status, 403);
  assert.equal((await h.request('/api/register', registration, { Origin: 'https://attacker.example' })).response.status, 403);
  assert.equal(h.store.state.users.length, 0);
});
test('every registration attempt counts toward the five-request hourly IP limit', async t => {
  const h = await harness(t);
  for (let i=0; i<5; i++) assert.equal((await h.request('/api/register', {})).response.status, 400);
  const limited = await h.register();
  assert.equal(limited.response.status, 429);
  assert.equal(limited.response.headers.get('Retry-After'), '3600');
  assert.equal(h.store.state.users.length, 0);
  h.advance(3600000);
  assert.equal((await h.register()).response.status, 201);
});

test('malformed JSON consumes an attempt but missing CSRF is rejected before the registration quota', async t => {
  const h = await harness(t);
  const cookies = Object.entries(h.jar).map(([key, value]) => `${key}=${value}`).join('; ');
  for (let i = 0; i < 3; i++) assert.equal((await h.request('/api/register', registration, { 'X-CSRF-Token': '' })).response.status, 403);
  assert.deepEqual(h.store.state.rates, {});
  for (let i = 0; i < 5; i++) {
    const response = await fetch(h.base + '/api/register', { method: 'POST', headers: {
      Cookie: cookies, 'X-CSRF-Token': h.jar.haven_csrf, 'Content-Type': 'application/json'
    }, body: '{malformed' });
    assert.equal(response.status, 400);
  }
  assert.equal((await h.register()).response.status, 429);
  assert.equal(h.messages.length, 0);
});

test('registration IP quota counts five requests per hour and is retained in shared storage', async t => {
  const store = new MemoryStore(), h = await harness(t, { store });
  for (let i=0; i<5; i++) {
    assert.equal((await h.request('/api/register', { ...registration, email: `quota-${i}@gmail.com` })).response.status, 201);
  }
  const otherServer = await harness(t, { store });
  const limited = await otherServer.register(); assert.equal(limited.response.status, 429); assert.equal(limited.response.headers.get('Retry-After'), '3600');
  assert.equal(limited.data.retryAfter, 3600);
  assert.equal(store.state.users.length, 5); assert.equal(otherServer.messages.length, 0);
  otherServer.advance(3600000); assert.equal((await otherServer.register()).response.status, 201);
});

test('duplicate and rolled-back registrations retain their attempt quota without sending extra email', async t => {
  const h = await harness(t); await h.register();
  assert.equal((await h.register()).response.status, 409);
  h.store.failAddress = true;
  for (let i=0; i<3; i++) {
    assert.equal((await h.request('/api/register', { ...registration, email: 'retry@gmail.com' })).response.status, 503);
  }
  h.store.failAddress = false;
  assert.equal((await h.request('/api/register', { ...registration, email: 'over-quota@gmail.com' })).response.status, 429);
  assert.equal(h.messages.length, 1);
  assert.equal(h.store.state.users.length, 1);
  h.advance(3600000);
  assert.equal((await h.request('/api/register', { ...registration, email: 'retry@gmail.com' })).response.status, 201);
});

test('email setup failures do not prevent registration after configuration is corrected', async t => {
  const h = await harness(t);
  h.emailService.getEmailConfiguration = () => { throw new Error('Email is not configured'); };
  for (let i=0; i<4; i++) assert.equal((await h.register()).response.status, 503);
  h.emailService.getEmailConfiguration = () => {};
  assert.equal((await h.register()).response.status, 201);
});

test('registration rejects concurrent submissions beyond five and one minute cannot reset the hour limit', async t => {
  const h = await harness(t);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => h.request('/api/register', {})));
  assert.equal(attempts.filter(result => result.response.status === 400).length, 5);
  assert.equal(attempts.filter(result => result.response.status === 429).length, 3);
  h.advance(60000);
  const limited = await h.request('/api/register', {});
  assert.equal(limited.response.status, 429); assert.equal(limited.data.retryAfter, 3540);
  h.advance(3540000); assert.equal((await h.register()).response.status, 201);
});
test('duplicate registration and rolled-back database writes never send extra email', async t => {
  const h = await harness(t); await h.register(); assert.equal((await h.register()).response.status, 409); assert.equal(h.messages.length, 1);
  const broken = await harness(t); broken.store.failAddress = true;
  const failure = await broken.register(); assert.equal(failure.response.status, 503); assert.equal(broken.store.state.users.length, 0); assert.equal(broken.messages.length, 0);
  assert.ok(!JSON.stringify(failure.data).includes('private database'));
});
test('failed email delivery preserves the account and reports a real delivery failure', async t => {
  const h = await harness(t); h.emailService.sendVerificationEmail = async () => { throw new EmailDeliveryError('Email rejected'); };
  const result = await h.register(); assert.equal(result.response.status, 201); assert.equal(result.data.email_submitted, false); assert.equal(h.store.state.users.length, 1);
});
test('registration automatically submits the professional Brevo email with a hashed 24-hour verification token', async t => {
  const requests = [];
  const env = { BREVO_API_KEY: 'registration-test-key', SENDER_NAME: 'Haven', SENDER_EMAIL: 'sender@example.com', PUBLIC_APP_URL: 'https://haven.example' };
  const emailService = { ...email, async sendVerificationEmail(message, options) {
    return email.sendVerificationEmail(message, { ...options, fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      requests.push(await request.json());
      return Response.json({ messageId: '<registration@example.com>' }, { status: 201 });
    } });
  } };
  const h = await harness(t, { env, emailService, smsService: disconnectedSms });
  const result = await h.register();
  assert.equal(result.response.status, 201); assert.equal(result.data.email_submitted, true);
  assert.equal(requests.length, 1);
  const message = requests[0];
  assert.deepEqual(message.to, [{ email: registration.email, name: registration.firstName }]);
  assert.equal(message.subject, 'Action Required: Verify your email address for Haven');
  assert.ok(message.textContent.startsWith('Dear: Alex\n\nThank you for registering with Haven.'));
  const token = message.textContent.match(/https:\/\/haven\.example\/verify-email\?token=([a-f0-9]{64})/)?.[1];
  assert.ok(token, 'the email contains the secure verification link');
  assert.equal(h.store.state.tokens[0].token_hash, hashToken(token));
  assert.equal(h.store.state.tokens[0].expires_at.getTime() - Date.UTC(2026, 9, 4), 86400000);
  assert.ok(!JSON.stringify(h.store.state).includes(token));
  assert.ok(!JSON.stringify(result.data).includes(token));
  const denied = await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal(denied.response.status, 403); assert.equal(denied.data.reason, 'email_unverified');
  assert.equal((await h.register()).response.status, 409); assert.equal(requests.length, 1);
  const verified = await h.request('/api/verify-email', { token });
  assert.equal(verified.response.status, 200); assert.equal(verified.data.email_verified, true);
});
test('email links require POST, expire at 24 hours, and are consumed once before requesting SMS', async t => {
  const h = await harness(t); await h.register(); const token = h.messages[0].token;
  assert.equal(h.smsRequests.length, 0); assert.equal((await h.request('/api/session')).data.pending.emailVerified, false);
  assert.equal((await h.verifyEmail()).response.status, 200); assert.equal(h.smsRequests[0].to, '+639171234567');
  assert.equal((await h.request('/api/verify-email', { token })).response.status, 400); assert.equal(h.smsRequests.length, 1);
  const expired = await harness(t); await expired.register(); expired.advance(86400000);
  assert.equal((await expired.verifyEmail()).response.status, 410); assert.equal(expired.smsRequests.length, 0);
});
test('email and SMS recovery keep verification pending when delivery fails', async t => {
  const h = await harness(t); await h.register();
  assert.equal((await h.request('/api/resend-verification', {})).response.status, 429);
  h.advance(60000); assert.equal((await h.request('/api/resend-verification', {})).response.status, 202);
  h.smsService.createVerification = async () => { throw new SmsDeliveryError('SMS unavailable'); };
  const verified = await h.request('/api/verify-email', { token: h.messages.at(-1).token });
  assert.equal(verified.data.email_verified, true); assert.equal(verified.data.sms_submitted, false);
  assert.equal((await h.request('/api/send-mobile-otp', {})).response.status, 502);
});
test('OTP enforces six digits, five-minute expiry, 60-second resend, and retained attempts across resends', async t => {
  const h = await harness(t); await h.register(); await h.verifyEmail();
  const pending = (await h.request('/api/session')).data.pending;
  assert.equal(pending.otp.expiresAt - Date.UTC(2026,9,4), 300000); assert.ok(!('code' in pending.otp));
  assert.equal(h.smsRequests[0].expiresAt, pending.otp.expiresAt);
  assert.equal(h.smsRequests[0].timeZone, 'Asia/Manila');
  assert.match(h.currentCode(), /^[1-9]\d{5}$/);
  assert.match(h.store.state.mobiles[h.store.state.users[0].id].otp_hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
  assert.equal((await h.request('/api/verify-mobile', { code: '12345' })).response.status, 400);
  assert.equal((await h.request('/api/resend-mobile-otp', {})).response.status, 429);
  assert.equal((await h.request('/api/verify-mobile', { code: '000000' })).data.otp.attemptsRemaining, 2);
  h.advance(60000); assert.equal((await h.request('/api/resend-mobile-otp', {})).response.status, 200);
  assert.equal((await h.request('/api/session')).data.pending.otp.attemptsRemaining, 2);
  h.advance(300000); assert.equal((await h.request('/api/verify-mobile', { code: '123456' })).response.status, 410);
});
test('three wrong OTP entries lock verification, including resends and a correct code afterward', async t => {
  const h = await harness(t); await h.register(); await h.verifyEmail();
  for (let attempt=0; attempt<3; attempt++) assert.equal((await h.request('/api/verify-mobile', { code: '000000' })).response.status, attempt===2 ? 423 : 400);
  h.advance(60000); assert.equal((await h.request('/api/resend-mobile-otp', {})).response.status, 423);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 423);
});
test('SMS verification uses only the current stored code and verification endpoints require a session', async t => {
  const h = await harness(t); assert.equal((await h.request('/api/send-mobile-otp', { email: registration.email })).response.status, 401);
  await h.register(); await h.verifyEmail();
  const oldCode = h.currentCode();
  h.advance(60000);
  assert.equal((await h.request('/api/resend-mobile-otp', {})).response.status, 200);
  assert.notEqual(h.currentCode(), oldCode);
  assert.equal((await h.request('/api/verify-mobile', { code: oldCode })).response.status, 400);
  assert.equal((await h.request('/api/session')).data.pending.mobileVerified, false);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 200);
  const challenge = h.store.state.mobiles[h.store.state.users[0].id];
  assert.equal(challenge.otp_hash, null); assert.equal(challenge.provider_id, null);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 401);
});

test('send-otp validates the supplied number, requires email verification, and shares the resend cooldown', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/send-otp', { phoneNumber: '09171234567' })).response.status, 401);
  await h.register();
  assert.equal((await h.request('/api/send-otp', {})).response.status, 400);
  for (const phoneNumber of ['invalid', 9171234567, '09171234568']) {
    assert.equal((await h.request('/api/send-otp', { phoneNumber })).response.status, 400);
  }
  assert.equal((await h.request('/api/send-otp', { phoneNumber: '09171234567' })).response.status, 403);
  assert.equal(h.smsRequests.length, 0);
  await h.verifyEmail();
  h.advance(59999);
  const early = await h.request('/api/send-otp', { phoneNumber: '+639171234567' });
  assert.equal(early.response.status, 429); assert.equal(early.response.headers.get('Retry-After'), '1');
  h.advance(1);
  const sent = await h.request('/api/send-otp', { phoneNumber: '0917 123 4567' });
  assert.equal(sent.response.status, 200); assert.equal(sent.data.success, true);
  assert.equal(sent.data.otp.expiresAt - sent.data.otp.resendAt, 240000);
  assert.deepEqual(Object.keys(sent.data.otp).sort(), ['attemptsRemaining', 'expiresAt', 'locked', 'resendAt', 'sent']);
});

test('the direct flag cannot bypass a configured OTP workflow', async t => {
  const h = await harness(t); await h.register(); await h.verifyEmail();
  assert.equal((await h.request('/api/verify-mobile', { direct: true })).response.status, 400);
  assert.equal((await h.request('/api/verify-mobile', { direct: true, code: '000000' })).response.status, 400);
  assert.equal((await h.request('/api/session')).data.pending.mobileVerified, false);
});

test('email verification sends a random Haven OTP through the real iProg adapter and never returns its code', async t => {
  const payloads = [];
  const env = { IPROG_API_TOKEN: 'test-only-iprog-key' };
  const axiosClient = { async post(url, payload) {
    payloads.push(payload);
    return { status: 200, data: { status: 200, message_id: 'iSms-route-test', otp_code: payload.message.match(/Your OTP is (\d{6})/)[1] } };
  } };
  const smsService = { ...sms, createVerification(message, options) { return sms.createVerification(message, { ...options, axiosClient }); } };
  const h = await harness(t, { env, smsService });
  await h.register();
  const result = await h.verifyEmail();
  assert.equal(result.data.sms_submitted, true);
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].message, /^Haven\nYour OTP is [1-9]\d{5}\nExpires at Oct 4, 2026, 8:05 AM \(Asia\/Manila\)\. Valid for 5 minutes\.$/);
  const code = payloads[0].message.match(/Your OTP is (\d{6})/)[1];
  const pending = (await h.request('/api/session')).data.pending;
  assert.equal(pending.otp.sent, true);
  assert.equal(pending.otp.expiresAt, Date.UTC(2026, 9, 4, 0, 5));
  assert.ok(!('code' in pending.otp) && !('otp_hash' in pending.otp));
  assert.ok(!JSON.stringify(result.data).includes(code));
  assert.equal((await h.request('/api/verify-mobile', { code })).response.status, 200);
});

test('delayed SMS submission cannot shift the deadline printed in the message', async t => {
  const h = await harness(t);
  const original = h.smsService.createVerification;
  h.smsService.createVerification = async message => { h.advance(10000); return original(message); };
  await h.register(); await h.verifyEmail();
  const first = (await h.request('/api/session')).data.pending.otp;
  assert.equal(first.expiresAt, h.smsRequests[0].expiresAt);
  assert.equal(first.expiresAt, Date.UTC(2026, 9, 4, 0, 5));
  h.advance(50000);
  const resent = await h.request('/api/resend-mobile-otp', {});
  assert.equal(resent.response.status, 200);
  assert.equal(resent.data.otp.expiresAt, h.smsRequests[1].expiresAt);
  assert.equal(resent.data.otp.expiresAt, first.expiresAt + 60000);
  h.advance(290000);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 410);
});

test('OTP delivery selects the registered state zone before the country default', async t => {
  const h = await harness(t); await h.register();
  const address = h.store.state.addresses[0];
  address.country = 'United States'; address.state = 'California';
  await h.verifyEmail();
  assert.equal(h.smsRequests[0].timeZone, 'America/Los_Angeles');
  assert.equal(h.smsRequests[0].expiresAt, (await h.request('/api/session')).data.pending.otp.expiresAt);
  address.state = 'Unknown subdivision';
  h.advance(60000); await h.request('/api/resend-mobile-otp', {});
  const { COUNTRIES } = await import('../../frontend/src/validation.mjs');
  assert.equal(h.smsRequests[1].timeZone, COUNTRIES.US.zone);
});

test('failed SMS resends preserve the previous code, expiry, and attempt count', async t => {
  const h = await harness(t); await h.register(); await h.verifyEmail();
  const code = h.currentCode();
  await h.request('/api/verify-mobile', { code: '000000' });
  const saved = structuredClone(h.store.state.mobiles);
  h.advance(60000);
  h.smsService.createVerification = async () => { throw new SmsDeliveryError('SMS unavailable'); };
  assert.equal((await h.request('/api/resend-mobile-otp', {})).response.status, 502);
  assert.deepEqual(h.store.state.mobiles, saved);
  assert.equal((await h.request('/api/verify-mobile', { code })).response.status, 200);
});

test('invalid iProg credentials return an actionable 503 and preserve an existing OTP', async t => {
  const logs = [];
  const h = await harness(t, { logger: { error(message) { logs.push(message); } } });
  await h.register(); await h.verifyEmail();
  const code = h.currentCode(), saved = structuredClone(h.store.state.mobiles);
  h.advance(60000);
  h.smsService.createVerification = (message) => sms.createVerification(message, {
    env: { IPROG_API_TOKEN: 'test-only-token' },
    axiosClient: { async post() { return { status: 200, data: { status: 500, message: 'Invalid Token' } }; } }
  });
  const result = await h.request('/api/resend-mobile-otp', {});
  assert.equal(result.response.status, 503);
  assert.equal(result.data.reason, 'sms_invalid_credentials');
  assert.match(result.data.message, /authentication failed/);
  assert.ok(logs.some(message => message.includes('IPROG_API_TOKEN')));
  assert.ok(!JSON.stringify({ response: result.data, logs }).includes('test-only-token'));
  assert.deepEqual(h.store.state.mobiles, saved);
  assert.equal((await h.request('/api/verify-mobile', { code })).response.status, 200);
});

test('concurrent OTP resends and guesses cannot bypass cooldowns or the three-attempt lockout', async t => {
  const h = await harness(t); await h.register(); await h.verifyEmail(); h.advance(60000);
  const resends = await Promise.all([h.request('/api/send-mobile-otp', {}), h.request('/api/resend-mobile-otp', {})]);
  assert.deepEqual(resends.map(result => result.response.status).sort(), [200, 429]);
  assert.equal(h.smsRequests.length, 2);
  const guesses = await Promise.all(Array.from({ length: 4 }, () => h.request('/api/verify-mobile', { code: '000000' })));
  assert.deepEqual(guesses.map(result => result.response.status).sort(), [400, 400, 423, 423]);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 423);
});

test('unconfigured email keeps pending accounts unverified and cannot create new accounts', async t => {
  const offline = await harness(t, { emailService: disconnectedEmail, smsService: disconnectedSms });
  const health = await offline.request('/api/health');
  assert.deepEqual(health.data, { status: 'ok', emailConfigured: false, smsConfigured: false, holidayConfigured: false });
  assert.deepEqual((await offline.request('/api/session')).data.services, { email: false, sms: false, holidays: false });
  const registrationResult = await offline.register();
  assert.equal(registrationResult.response.status, 503);
  assert.equal(registrationResult.data.reason, 'email_not_configured');
  assert.equal(offline.store.state.users.length, 0);
  assert.equal(offline.store.state.tokens.length, 0);
  const h = await harness(t);
  await h.register();
  Object.assign(h.emailService, disconnectedEmail);
  Object.assign(h.smsService, disconnectedSms);
  for (const [route, body] of [
    ['/api/verify-email', { direct: true }],
    ['/api/verify-email', { token: h.messages[0].token }],
    ['/api/resend-verification', {}],
    ['/api/request-unlock', { email: registration.email }]
  ]) {
    const result = await h.request(route, body);
    assert.equal(result.response.status, 503);
    assert.equal(result.data.reason, 'email_not_configured');
  }
  const pending = (await h.request('/api/session')).data.pending;
  assert.equal(pending.emailVerified, false);
  assert.equal(pending.mobileVerified, false);
  assert.equal(h.store.state.tokens.length, 1);
  assert.equal(h.messages.length, 1);
});

test('unconfigured SMS prevents resends but a previously delivered OTP can still be verified locally', async t => {
  const h = await harness(t);
  await h.register(); await h.verifyEmail();
  h.advance(60000);
  const savedChallenge = structuredClone(h.store.state.mobiles);
  Object.assign(h.smsService, disconnectedSms);
  for (const [route, body] of [
    ['/api/send-mobile-otp', {}], ['/api/resend-mobile-otp', {}]
  ]) {
    const result = await h.request(route, body);
    assert.equal(result.response.status, 503);
    assert.equal(result.data.reason, 'sms_not_configured');
  }
  assert.deepEqual(h.store.state.mobiles, savedChallenge);
  const pending = (await h.request('/api/session')).data.pending;
  assert.equal(pending.emailVerified, true);
  assert.equal(pending.mobileVerified, false);
  assert.equal(h.smsRequests.length, 1);
  assert.equal((await h.request('/api/verify-mobile', { code: h.currentCode() })).response.status, 200);
});

test('existing verified accounts can sign in and sign out while external services are disconnected', async t => {
  const h = await harness(t);
  await h.verified();
  Object.assign(h.emailService, disconnectedEmail);
  Object.assign(h.smsService, disconnectedSms);
  assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).data.next, '/dashboard');
  assert.equal((await h.request('/api/accounts')).data.accounts[0].email, registration.email);
  const holidays = await h.request('/api/holidays/2026');
  assert.equal(holidays.response.status, 503);
  assert.equal(holidays.data.reason, 'holiday_not_configured');
  assert.ok(!('holidays' in holidays.data));
  assert.equal((await h.request('/api/logout', {})).response.status, 200);
  assert.equal((await h.request('/api/accounts')).response.status, 401);
});

test('email verification requires the emailed token even when Brevo is configured', async t => {
  const h = await harness(t); await h.register();
  assert.equal((await h.request('/api/verify-email', { direct: true })).response.status, 400);
  assert.equal((await h.request('/api/session')).data.pending.emailVerified, false);
  assert.equal(h.store.state.tokens.length, 1);
  assert.equal(h.smsRequests.length, 0);
});

test('configured email permits registration while SMS remains paused', async t => {
  const h = await harness(t, { smsService: disconnectedSms });
  const registrationResult = await h.register();
  assert.equal(registrationResult.response.status, 201);
  assert.equal(registrationResult.data.email_submitted, true);
  const verification = await h.verifyEmail();
  assert.equal(verification.response.status, 200);
  assert.equal(verification.data.email_verified, true);
  assert.equal(verification.data.sms_submitted, false);
  const session = (await h.request('/api/session')).data;
  assert.equal(session.pending.emailVerified, true);
  assert.equal(session.pending.mobileVerified, false);
  assert.deepEqual(session.services, { email: true, sms: false, holidays: false });
  assert.equal((await h.request('/api/accounts')).response.status, 401);
});

test('send-email requires a verified session and CSRF, and forwards Brevo message IDs', async t => {
  const h = await harness(t), sent = [];
  h.emailService.sendEmail = async (message, options) => { sent.push({ message, options }); return { messageId: '<brevo-id@example.com>' }; };
  const body = { recipientEmail: 'recipient@example.com', recipientName: 'Taylor', subject: 'Hello', message: 'A message' };
  assert.equal((await h.request('/api/send-email', body)).response.status, 401);
  await h.register();
  assert.equal((await h.request('/api/send-email', body)).response.status, 401);
  await h.verifyEmail(); await h.request('/api/verify-mobile', { code: h.currentCode() });
  await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal((await h.request('/api/send-email', body, { 'X-CSRF-Token': '' })).response.status, 403);
  assert.equal(sent.length, 0);
  const result = await h.request('/api/send-email', body);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { success: true, messageId: '<brevo-id@example.com>' });
  assert.deepEqual(sent[0], { message: body, options: { env: {} } });
  const unicode = { ...body, message: '文'.repeat(10000) };
  assert.equal((await h.request('/api/send-email', unicode)).response.status, 200);
  assert.equal(sent[1].message.message, unicode.message);
});

test('send-email validates inputs, reports unavailable delivery, and limits sends', async t => {
  const h = await harness(t); await h.verified();
  await h.request('/api/login', { email: registration.email, password: registration.password });
  const body = { recipientEmail: 'recipient@example.com', message: 'Hello' };
  h.emailService.sendEmail = email.sendEmail;
  assert.equal((await h.request('/api/send-email', { ...body, message: '   ' })).response.status, 400);
  assert.equal((await h.request('/api/send-email', { ...body, sender: 'forged@example.com' })).response.status, 400);
  h.emailService.getEmailConfiguration = email.getEmailConfiguration;
  const unavailable = await h.request('/api/send-email', body);
  assert.equal(unavailable.response.status, 503); assert.equal(unavailable.data.reason, 'email_not_configured');
  h.emailService.getEmailConfiguration = () => {};
  h.emailService.sendEmail = async () => { const error = new EmailDeliveryError('Email rejected'); error.diagnostic = 'Brevo HTTP 401'; throw error; };
  const rejected = await h.request('/api/send-email', body);
  assert.equal(rejected.response.status, 502); assert.equal(rejected.data.error, 'Email rejected');
  let sends = 0;
  h.emailService.sendEmail = async () => { sends++; return { messageId: 'accepted' }; };
  for (let i = 0; i < 9; i++) assert.equal((await h.request('/api/send-email', body)).response.status, 200);
  const limited = await h.request('/api/send-email', body);
  assert.equal(limited.response.status, 429); assert.equal(limited.response.headers.get('Retry-After'), '3600');
  assert.equal(sends, 9);
});

test('login rejects unverified emails, requires mobile verification for workspace access, and logout invalidates the server session', async t => {
  const h = await harness(t); await h.register();
  const existingSession = h.jar.haven_session;
  const sessions = structuredClone(h.store.state.sessions);
  const denied = await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal(denied.response.status, 403); assert.equal(denied.data.reason, 'email_unverified');
  assert.equal(denied.response.headers.getSetCookie().length, 0);
  assert.equal(h.jar.haven_session, existingSession); assert.deepEqual(h.store.state.sessions, sessions);
  await h.request('/api/logout', {});
  assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).response.status, 403);
  assert.deepEqual(h.store.state.sessions, {});
  await h.verifyEmail(); assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).data.next, '/verify-mobile');
  await h.request('/api/verify-mobile', { code: h.currentCode() });
  assert.equal((await h.request('/api/accounts')).response.status, 401);
  await h.request('/api/login', { email: registration.email, password: registration.password });
  const cookie = h.jar.haven_session;
  const accounts = await h.request('/api/accounts'); assert.equal(accounts.response.status, 200); assert.equal(accounts.data.accounts.length, 1); assert.ok(!JSON.stringify(accounts.data).includes('password'));
  await h.request('/api/logout', {}); h.jar.haven_session = cookie;
  assert.equal((await h.request('/api/accounts')).response.status, 401);
});

test('login rejects email-unverified accounts before checking passwords or changing the failure counter', async t => {
  const h = await harness(t); await h.register();
  const user = h.store.state.users[0];
  user.failed_login_attempts = 2;
  const sessions = structuredClone(h.store.state.sessions);
  const compare = t.mock.method(bcrypt, 'compare', () => { assert.fail('Unverified accounts must be rejected before password comparison'); });
  for (const password of ['wrong', registration.password, 'x'.repeat(73)]) {
    const denied = await h.request('/api/login', { email: registration.email, password });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.data.reason, 'email_unverified');
    assert.equal(user.failed_login_attempts, 2); assert.equal(user.is_locked, 0);
    assert.equal(denied.response.headers.getSetCookie().length, 0);
  }
  assert.equal(compare.mock.callCount(), 0);
  assert.deepEqual(h.store.state.sessions, sessions);
  assert.equal(h.messages.filter(message => message.kind === 'unlock').length, 0);
  user.is_locked = 1;
  compare.mock.mockImplementation(async (password, hash) => { assert.notEqual(hash, user.password_hash); return false; });
  const locked = await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal(locked.response.status, 401); assert.equal(locked.data.message, 'Invalid email or password.');
  assert.equal(compare.mock.callCount(), 1);
  assert.equal(user.failed_login_attempts, 2);
});
test('three failed logins lock the account, send one unlock email, and enforce two minutes plus single-use unlock', async t => {
  const h = await harness(t); await h.verified();
  for (let attempt=0; attempt<3; attempt++) { const result = await h.request('/api/login', { email: registration.email, password: 'wrong' }); assert.equal(result.response.status, 401); assert.equal(result.data.message, 'Invalid email or password.'); }
  const email = h.messages.find(message => message.kind === 'unlock'); assert.ok(email);
  assert.equal((await h.request('/api/unlock-account', { token: email.token })).response.status, 429);
  assert.equal((await h.request('/api/login', { email: 'unknown@gmail.com', password: 'wrong' })).data.message, 'Invalid email or password.');
  h.advance(120000);
  assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).response.status, 401);
  assert.equal((await h.request('/api/unlock-account', { token: email.token })).response.status, 200);
  assert.equal((await h.request('/api/unlock-account', { token: email.token })).response.status, 410);
  assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).data.next, '/dashboard');
});
test('successful login resets consecutive failures, normalizes email, and oversized incorrect passwords cannot bypass lockout', async t => {
  const h = await harness(t); await h.verified();
  for (let i = 0; i < 2; i++) assert.equal((await h.request('/api/login', { email: registration.email, password: 'wrong' })).response.status, 401);
  assert.equal((await h.request('/api/login', { email: ` ${registration.email.toUpperCase()} `, password: registration.password })).data.next, '/dashboard');
  assert.equal(h.store.state.users[0].failed_login_attempts, 0);
  for (let i = 0; i < 3; i++) {
    const result = await h.request('/api/login', { email: registration.email, password: registration.password + 'x'.repeat(80) });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.message, 'Invalid email or password.');
  }
  assert.equal(h.store.state.users[0].is_locked, 1);
  assert.equal(h.messages.filter(message => message.kind === 'unlock').length, 1);
  assert.equal((await h.request('/api/accounts')).response.status, 401);
});
test('whole-second database timestamps cannot shorten the two-minute unlock cooldown', async t => {
  const h = await harness(t); await h.verified(); h.advance(123);
  for (let i = 0; i < 3; i++) await h.request('/api/login', { email: registration.email, password: 'wrong' });
  const token = h.messages.find(message => message.kind === 'unlock').token;
  h.advance(119999);
  assert.equal((await h.request('/api/unlock-account', { token })).response.status, 429);
  h.advance(1000);
  assert.equal((await h.request('/api/unlock-account', { token })).response.status, 200);
});
test('authenticated holiday requests fetch the selected year, reject years outside 2020–2027, and never return fixtures', async t => {
  const years = []; const h = await harness(t, { holidayService: async year => { years.push(year); return []; } });
  assert.equal((await h.request('/api/holidays/2026')).response.status, 401);
  await h.verified(); await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal((await h.request('/api/holidays/2020')).response.status, 200); assert.deepEqual(years, [2020]);
  assert.equal((await h.request('/api/holidays/2028')).response.status, 400);
});
