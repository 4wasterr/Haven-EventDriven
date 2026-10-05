const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const { MemoryStore } = require('./memory-store');

test('production requires a persistent strong CSRF secret', () => {
  for (const CSRF_SECRET of [undefined, 'short', 'replace_with_a_random_secret_at_least_32_characters_long']) {
    assert.throws(() => createApp({ store: new MemoryStore(), env: { NODE_ENV: 'production', CSRF_SECRET } }), /CSRF_SECRET/);
  }
});

test('production rejects HTTP and older/missing TLS versions before processing submission payloads', async t => {
  const store = new MemoryStore();
  const server = createApp({ store, env: { NODE_ENV: 'production', TRUST_PROXY: '1', PUBLIC_APP_URL: 'https://haven.example', CSRF_SECRET: 'a'.repeat(64) } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const headers of [{}, { 'X-Forwarded-Proto': 'https' }, { 'X-Forwarded-Proto': 'https', 'X-TLS-Version': 'TLSv1.2' }]) {
    const response = await fetch(base + '/api/register', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{malformed' });
    assert.equal(response.status, 426);
    assert.ok(!(await response.text()).includes('JSON'));
  }
  assert.equal(store.state.users.length, 0);
  assert.deepEqual(store.state.rates, {});
  const response = await fetch(base + '/api/csrf', { headers: { 'X-Forwarded-Proto': 'https', 'X-TLS-Version': 'TLSv1.3' } });
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('Strict-Transport-Security'));
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
  assert.match(response.headers.get('Set-Cookie'), /Secure/);
  assert.match(response.headers.get('Set-Cookie'), /SameSite=Lax/);
});
