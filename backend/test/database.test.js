const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const crypto = require('crypto');
const { createApp } = require('../app');
const { Store, hashToken } = require('../store');
const { ensureSchema } = require('../schema');

test('MariaDB integration: register, verify email/mobile, login, profile, lockout and unlock using actual SQL',
  { skip: process.env.RUN_DATABASE_TESTS !== '1' }, async () => {
    const db = require('../db');
    await ensureSchema(db);
    await ensureSchema(db); // Startup additions must be safe to repeat.
    const connection = await db.getConnection();
    let server;
    await connection.beginTransaction();
    // Exercise every SQL statement inside an outer transaction rolled back after the check.
    const transactionConnection = { query: (...args) => connection.query(...args),
      beginTransaction: () => connection.query('SAVEPOINT haven_integration'),
      commit: () => connection.query('RELEASE SAVEPOINT haven_integration'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT haven_integration'), release() {} };
    const testDb = { query: (...args) => connection.query(...args), async getConnection() { return transactionConnection; } };
    // Verification token TIMESTAMP columns store whole seconds.
    let clock = Math.floor(Date.now() / 1000) * 1000, token, unlockToken, otpCode;
    const emailService = { getEmailConfiguration() {}, async sendVerificationEmail(message) { token = message.token; }, async sendUnlockEmail(message) { unlockToken = message.token; } };
    const smsService = { getSmsConfiguration() {}, async createVerification({ code }) { otpCode = code; return { id: 'sms_sql_test' }; } };
    try {
      const columns = await connection.query("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users','addresses','verification_tokens')");
      const column = (table, name) => columns.find(row => row.TABLE_NAME === table && row.COLUMN_NAME === name);
      for (const [name, type, length] of [['id','char',36], ['first_name','varchar',50], ['last_name','varchar',50], ['birthday','date',null], ['password_hash','varchar',255], ['email','varchar',255], ['mobile_number','varchar',20]]) {
        const row = column('users', name);
        assert.ok(row, `users.${name}`);
        assert.equal(row.DATA_TYPE, type);
        assert.equal(row.IS_NULLABLE, 'NO');
        if (length) assert.equal(Number(row.CHARACTER_MAXIMUM_LENGTH), length);
      }
      for (const name of ['email_verified_at','lockout_until','created_at','updated_at']) assert.equal(column('users', name).DATA_TYPE, 'timestamp');
      assert.equal(Number(column('users','middle_initial').CHARACTER_MAXIMUM_LENGTH), 2);
      assert.equal(column('users','middle_initial').IS_NULLABLE, 'YES');
      for (const name of ['house_street','country','city','state','zip_code','user_id']) assert.equal(column('addresses', name).IS_NULLABLE, 'NO');
      assert.equal(column('verification_tokens','expires_at').IS_NULLABLE, 'NO');
      assert.equal(column('verification_tokens','type').DATA_TYPE, 'enum');
      const emailIndexes = await connection.query("SHOW INDEX FROM users WHERE Column_name = 'email'");
      assert.ok(emailIndexes.some(row => Number(row.Non_unique) === 0));
      const tokenIndexes = await connection.query("SHOW INDEX FROM verification_tokens WHERE Key_name = 'idx_verification_lookup'");
      assert.deepEqual(tokenIndexes.map(row => row.Column_name), ['token_hash','type']);
      const cascades = await connection.query("SELECT rc.DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE kcu ON rc.CONSTRAINT_SCHEMA=kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME AND rc.TABLE_NAME=kcu.TABLE_NAME WHERE rc.CONSTRAINT_SCHEMA=DATABASE() AND rc.TABLE_NAME='addresses' AND kcu.COLUMN_NAME='user_id' AND kcu.REFERENCED_TABLE_NAME='users'");
      assert.ok(cascades.some(row => row.DELETE_RULE === 'CASCADE'));
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
      const unverified = await store.userByEmail(email);
      assert.equal(unverified.email_verified_at, null); assert.equal(Number(unverified.mobile_verified), 0);
      const savedToken = await store.tokenByHash(hashToken(token), 'email_verify');
      assert.equal(new Date(savedToken.expires_at).getTime() - clock, 86400000);
      const denied = await request('/api/login', { email, password });
      assert.equal(denied.response.status, 403); assert.equal(denied.data.reason, 'email_unverified');
      assert.equal((await request('/api/verify-email', { token })).response.status, 200);
      const pending = (await request('/api/session')).data.pending; assert.equal(pending.emailVerified, true); assert.equal(pending.otp.attemptsRemaining, 3);
      assert.equal((await request('/api/verify-mobile', { code: otpCode })).response.status, 200);
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
