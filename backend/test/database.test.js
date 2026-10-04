const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const crypto = require('crypto');
const { createApp } = require('../app');
const { Store, hashToken } = require('../store');

test('MariaDB integration: register, verify email/mobile, login, profile, lockout and unlock using actual SQL',
  { skip: process.env.RUN_DATABASE_TESTS !== '1' }, async () => {
    const db = require('../db');
    const connection = await db.getConnection();
    let server;
    await connection.beginTransaction();
    // Exercise every SQL statement inside an outer transaction rolled back after the check.
    const transactionConnection = { query: (...args) => connection.query(...args),
      beginTransaction: () => connection.query('SAVEPOINT haven_integration'),
      commit: () => connection.query('RELEASE SAVEPOINT haven_integration'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT haven_integration'), release() {} };
    const testDb = { query: (...args) => connection.query(...args), async getConnection() { return transactionConnection; } };
    let clock = Date.now(), token, unlockToken;
    const emailService = { getEmailConfiguration() {}, async sendVerificationEmail(message) { token = message.token; }, async sendUnlockEmail(message) { unlockToken = message.token; } };
    const smsService = { getSmsConfiguration() {}, async createVerification() { return { id: 'vrf_sql_test' }; },
      async checkVerification() { return { success: true, verification: { id: 'vrf_sql_test' } }; } };
    try {
      const store = new Store(testDb), rateKey = `integration-rollback:${crypto.randomUUID()}`;
      const failure = new Error('Simulated account write failure');
      await assert.rejects(store.transaction(async tx => {
        assert.equal(await tx.consumeRate(rateKey, 1, 3600000, clock), 0);
        throw failure;
      }), error => error === failure);
      assert.equal((await connection.query('SELECT count FROM api_rate_limits WHERE rate_key = ?', [hashToken(rateKey)])).length, 0);
      assert.equal(await store.consumeRate(rateKey, 1, 3600000, clock), 0);
      assert.equal(await store.consumeRate(rateKey, 1, 3600000, clock), 3600);
      server = createApp({ db: testDb, emailService, smsService, env: {}, now: () => clock, logger: { error: console.error } }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`, jar = {};
      const saveCookies = response => { for (const cookie of response.headers.getSetCookie()) { const [key,value] = cookie.split(';')[0].split('='); jar[key] = value; } };
      const csrf = await fetch(base + '/api/csrf'); saveCookies(csrf); const csrfToken = (await csrf.json()).csrfToken;
      async function request(route, body) {
        const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
          headers: { Cookie: Object.entries(jar).map(([key,value]) => `${key}=${value}`).join('; '), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        saveCookies(response); const data = await response.json(); assert.ok(response.status !== 503, JSON.stringify(data)); return { response, data };
      }
      const email = `haven-integration-${crypto.randomUUID()}@gmail.com`, password = 'Integration!Pass2026';
      assert.equal((await request('/api/register', { firstName: 'Integration', lastName: 'Check', middleInitial: '', birthday: '01/01/2000', email, password, confirmPassword: password,
        country: 'PH', region: 'Metro Manila', city: 'Makati', postal: '1200', houseStreet: '24 Test Street', mobile: '9171234567' })).response.status, 201);
      assert.equal((await request('/api/verify-email', { token })).response.status, 200);
      const pending = (await request('/api/session')).data.pending; assert.equal(pending.emailVerified, true); assert.equal(pending.otp.attemptsRemaining, 3);
      assert.equal((await request('/api/verify-mobile', { code: '123456' })).response.status, 200);
      assert.equal((await request('/api/login', { email, password })).data.next, '/dashboard');
      assert.equal((await request('/api/accounts')).data.accounts[0].firstName, 'Integration');
      for (let i=0; i<3; i++) assert.equal((await request('/api/login', { email, password: 'wrong' })).response.status, 401);
      assert.ok(unlockToken); assert.equal((await request('/api/unlock-account', { token: unlockToken })).response.status, 429);
      clock += 120000;
      assert.equal((await request('/api/unlock-account', { token: unlockToken })).response.status, 200);
      assert.equal((await request('/api/login', { email, password })).data.next, '/dashboard');
      assert.equal((await request('/api/logout', {})).response.status, 200);
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await connection.rollback(); connection.release(); await db.end();
    }
});
