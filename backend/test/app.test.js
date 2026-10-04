const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { createApp, hashToken } = require('../app');
const { EmailDeliveryError } = require('../email');
const { SmsDeliveryError } = require('../sms');
const infobipSms = require('../sms');
const { MemoryStore } = require('./memory-store');
const registration = { firstName: 'Alex', lastName: 'Lopez', middleInitial: 'M.', birthday: '01/01/2000',
  password: 'StrongPassword!2026', confirmPassword: 'StrongPassword!2026', email: 'alex@gmail.com', mobile: '9171234567',
  houseStreet: '24 Palm Street', country: 'PH', city: 'Makati', region: 'Metro Manila', postal: '1200' };

async function harness(context, overrides = {}) {
  const store = overrides.store || new MemoryStore(), messages = [], smsRequests = [], checkedCodes = [];
  let clock = Date.UTC(2026, 9, 4);
  const emailService = { getEmailConfiguration() {}, async sendVerificationEmail(message) { messages.push({ kind: 'verify', ...message }); },
    async sendUnlockEmail(message) { messages.push({ kind: 'unlock', ...message }); } };
  const smsService = { getSmsConfiguration() {}, async createVerification(message) { smsRequests.push(message); return { id: `vrf_${smsRequests.length}` }; },
    async checkVerification({ code }) { checkedCodes.push(code); return { success: code === '123456', reason: code === '123456' ? null : 'incorrect_code',
      verification: { id: `vrf_${smsRequests.length}` } }; } };
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
  async function verified() { await register(); await verifyEmail(); await request('/api/verify-mobile', { code: '123456' }); }
  return { store, messages, smsRequests, checkedCodes, emailService, smsService, request, register, verifyEmail, verified, jar, base,
    advance(milliseconds) { clock += milliseconds; } };
}

test('registration hashes passwords on the server, stores only hashed 24-hour tokens, and creates a restricted session', async t => {
  const h = await harness(t); const result = await h.register();
  assert.equal(result.response.status, 201); assert.equal(result.data.email_submitted, true);
  const user = h.store.state.users[0]; assert.match(user.password_hash, /^\$2b\$12\$/);
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
test('invalid registration submissions do not exhaust the hourly account quota', async t => {
  const h = await harness(t);
  for (let i=0; i<6; i++) assert.equal((await h.request('/api/register', {})).response.status, 400);
  assert.equal((await h.register()).response.status, 201);
});

test('registration IP quota counts five created accounts per hour and is retained in shared storage', async t => {
  const store = new MemoryStore(), h = await harness(t, { store });
  for (let i=0; i<5; i++) {
    assert.equal((await h.request('/api/register', { ...registration, email: `quota-${i}@gmail.com` })).response.status, 201);
  }
  const otherServer = await harness(t, { store });
  const limited = await otherServer.register(); assert.equal(limited.response.status, 429); assert.equal(limited.response.headers.get('Retry-After'), '3600');
  assert.match(limited.data.message, /60 minutes/);
  assert.equal(store.state.users.length, 5); assert.equal(otherServer.messages.length, 0);
  otherServer.advance(3600000); assert.equal((await otherServer.register()).response.status, 201);
});

test('duplicate and rolled-back registrations do not consume the hourly account quota', async t => {
  const h = await harness(t); await h.register();
  for (let i=0; i<6; i++) assert.equal((await h.register()).response.status, 409);
  h.store.failAddress = true;
  for (let i=0; i<6; i++) {
    assert.equal((await h.request('/api/register', { ...registration, email: 'retry@gmail.com' })).response.status, 503);
  }
  h.store.failAddress = false;
  for (let i=0; i<4; i++) {
    assert.equal((await h.request('/api/register', { ...registration, email: `retry-${i}@gmail.com` })).response.status, 201);
  }
  assert.equal((await h.request('/api/register', { ...registration, email: 'over-quota@gmail.com' })).response.status, 429);
  assert.equal(h.messages.length, 5);
});

test('email setup failures do not prevent registration after configuration is corrected', async t => {
  const h = await harness(t);
  h.emailService.getEmailConfiguration = () => { throw new Error('Email is not configured'); };
  for (let i=0; i<6; i++) assert.equal((await h.register()).response.status, 503);
  h.emailService.getEmailConfiguration = () => {};
  assert.equal((await h.register()).response.status, 201);
});

test('registration still rejects a burst of submissions and recovers after one minute', async t => {
  const h = await harness(t);
  for (let i=0; i<60; i++) assert.equal((await h.request('/api/register', {})).response.status, 400);
  const limited = await h.request('/api/register', {});
  assert.equal(limited.response.status, 429); assert.equal(limited.data.retryAfter, 60);
  h.advance(60000); assert.equal((await h.register()).response.status, 201);
});
test('duplicate registration and rolled-back database writes never send extra email', async t => {
  const h = await harness(t); await h.register(); assert.equal((await h.register()).response.status, 409); assert.equal(h.messages.length, 1);
  const broken = await harness(t); broken.store.failAddress = true;
  const failure = await broken.register(); assert.equal(failure.response.status, 503); assert.equal(broken.store.state.users.length, 0); assert.equal(broken.messages.length, 0);
  assert.ok(!JSON.stringify(failure.data).includes('private database'));
});
test('failed email delivery preserves the account and reports a real delivery failure', async t => {
  const h = await harness(t); h.emailService.sendVerificationEmail = async () => { throw new EmailDeliveryError('Resend rejected'); };
  const result = await h.register(); assert.equal(result.response.status, 201); assert.equal(result.data.email_submitted, false); assert.equal(h.store.state.users.length, 1);
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
  assert.equal((await h.request('/api/verify-mobile', { code: '12345' })).response.status, 400); assert.equal(h.checkedCodes.length, 0);
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
  assert.equal((await h.request('/api/verify-mobile', { code: '123456' })).response.status, 423); assert.equal(h.checkedCodes.length, 3);
});
test('SMS verification must match the stored current challenge; verification endpoints require a session', async t => {
  const h = await harness(t); assert.equal((await h.request('/api/send-mobile-otp', { email: registration.email })).response.status, 401);
  await h.register(); await h.verifyEmail();
  h.smsService.checkVerification = async () => ({ success: true, verification: { id: 'different-challenge' } });
  assert.equal((await h.request('/api/verify-mobile', { code: '123456' })).response.status, 400);
  assert.equal((await h.request('/api/session')).data.pending.mobileVerified, false);
});

test('Infobip trial failure keeps email verified and recovers with an SMS bound to the account challenge', async t => {
  const env = { INFOBIP_API_KEY: 'private-test-api-key', INFOBIP_BASE_URL: 'https://test.api.infobip.com', INFOBIP_2FA_APPLICATION_ID: 'app_123', INFOBIP_2FA_MESSAGE_ID: 'msg_123' };
  const pinId = '9C817C6F8AF3D48F9FE553282AFA2B67', requests = [], logs = [];
  let trialExhausted = true;
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    requests.push({ url, method: options.method, body });
    if (options.method === 'GET') return Response.json(url.includes('/messages/') ? {
      applicationId: env.INFOBIP_2FA_APPLICATION_ID, messageId: env.INFOBIP_2FA_MESSAGE_ID, pinLength: 6, pinType: 'NUMERIC'
    } : { applicationId: env.INFOBIP_2FA_APPLICATION_ID, enabled: true, configuration: { pinAttempts: 3, allowMultiplePinVerifications: false, pinTimeToLive: '5m' } });
    if (trialExhausted) return Response.json({ message: 'private provider data' }, { status: 402 });
    return Response.json(url.endsWith('/verify') ? { pinId, msisdn: '639171234567', verified: true, attemptsRemaining: 0 }
      : { pinId, to: '639171234567', smsStatus: 'MESSAGE_SENT' });
  };
  const smsService = { getSmsConfiguration: () => infobipSms.getSmsConfiguration(env),
    createVerification: params => infobipSms.createVerification(params, { env, fetchImpl }),
    checkVerification: params => infobipSms.checkVerification(params, { env, fetchImpl }) };
  const h = await harness(t, { smsService, logger: { error: message => logs.push(message) } });
  await h.register();
  const emailResult = await h.verifyEmail();
  assert.equal(emailResult.data.email_verified, true); assert.equal(emailResult.data.sms_submitted, false);
  const pending = (await h.request('/api/session')).data.pending;
  assert.equal(pending.emailVerified, true); assert.equal(pending.mobileVerified, false); assert.equal(pending.otp, null);
  const failed = await h.request('/api/send-mobile-otp', {});
  assert.equal(failed.response.status, 503); assert.match(failed.data.message, /SMS service is unavailable/);
  assert.ok(!JSON.stringify(failed.data).includes('Infobip')); assert.ok(!JSON.stringify(failed.data).includes('private provider data'));
  assert.ok(logs.some(message => message.includes('free SMS allowance')));
  assert.equal((await h.request('/api/verify-mobile', { code: '123456' })).response.status, 410);
  trialExhausted = false;
  const sent = await h.request('/api/send-mobile-otp', { to: '+14155550123' });
  assert.equal(sent.response.status, 200); assert.equal(sent.data.otp.sent, true);
  assert.equal(requests.at(-1).body.to, '639171234567');
  assert.equal((await h.request('/api/verify-mobile', { code: '123456' })).response.status, 200);
  assert.deepEqual(requests.at(-1).body, { pin: '123456' });
  assert.ok(requests.at(-1).url.endsWith(`/pin/${pinId}/verify`));
  assert.equal(h.store.state.users[0].mobile_verified, 1);
});
test('login only grants workspace access after both verifications, and logout invalidates the server session', async t => {
  const h = await harness(t); await h.register();
  assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).data.next, '/verify-email');
  await h.verifyEmail(); assert.equal((await h.request('/api/login', { email: registration.email, password: registration.password })).data.next, '/verify-mobile');
  await h.request('/api/verify-mobile', { code: '123456' });
  assert.equal((await h.request('/api/accounts')).response.status, 401);
  await h.request('/api/login', { email: registration.email, password: registration.password });
  const cookie = h.jar.haven_session;
  const accounts = await h.request('/api/accounts'); assert.equal(accounts.response.status, 200); assert.equal(accounts.data.accounts.length, 1); assert.ok(!JSON.stringify(accounts.data).includes('password'));
  await h.request('/api/logout', {}); h.jar.haven_session = cookie;
  assert.equal((await h.request('/api/accounts')).response.status, 401);
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
test('authenticated holiday requests fetch the selected year, reject years outside 2020–2027, and never return fixtures', async t => {
  const years = []; const h = await harness(t, { holidayService: async year => { years.push(year); return []; } });
  assert.equal((await h.request('/api/holidays/2026')).response.status, 401);
  await h.verified(); await h.request('/api/login', { email: registration.email, password: registration.password });
  assert.equal((await h.request('/api/holidays/2020')).response.status, 200); assert.deepEqual(years, [2020]);
  assert.equal((await h.request('/api/holidays/2028')).response.status, 400);
});
