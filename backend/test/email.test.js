const test = require('node:test');
const assert = require('node:assert/strict');
const email = require('../email');

const env = { BREVO_API_KEY: 'test-brevo-key', SENDER_NAME: 'Haven', SENDER_EMAIL: 'sender@example.com',
  PUBLIC_APP_URL: 'https://haven.example' };

function provider(status = 201, body = { messageId: '<test-id@example.com>' }) {
  const requests = [];
  const fetchImpl = async (input, init) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, body: await request.json() });
    return Response.json(body, { status });
  };
  return { requests, options: { env, fetchImpl } };
}

test('Brevo configuration validates its own credentials, sender and application origin locally', () => {
  assert.deepEqual(email.getEmailConfiguration(env), { apiKey: env.BREVO_API_KEY,
    sender: { name: 'Haven', email: 'sender@example.com' }, appUrl: env.PUBLIC_APP_URL });
  for (const overrides of [{ BREVO_API_KEY: '' }, { SENDER_NAME: '' }, { SENDER_EMAIL: 'invalid' },
    { PUBLIC_APP_URL: 'javascript:alert(1)' }, { PUBLIC_APP_URL: 'https://user:pass@example.com' },
    { NODE_ENV: 'production', PUBLIC_APP_URL: 'http://haven.example' }, { BREVO_API_KEY: 'YOUR_API_KEY' },
    { BREVO_API_KEY: 'key with whitespace' }, { PUBLIC_APP_URL: 'http://haven.example' }]) {
    assert.throws(() => email.getEmailConfiguration({ ...env, ...overrides }), email.EmailConfigurationError);
  }
});

test('the real Brevo SDK posts the supplied recipient and safe HTML with a server API key', async () => {
  const p = provider();
  const result = await email.sendEmail({ recipientEmail: ' recipient@example.com ', recipientName: ' Taylor ',
    subject: 'Hello', message: '<img src=x onerror="alert(1)">\nA & B' }, p.options);
  assert.deepEqual(result, { messageId: '<test-id@example.com>' });
  assert.equal(p.requests.length, 1);
  const request = p.requests[0];
  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.headers.get('api-key'), env.BREVO_API_KEY);
  assert.deepEqual(request.body.sender, { name: 'Haven', email: 'sender@example.com' });
  assert.deepEqual(request.body.to, [{ email: 'recipient@example.com', name: 'Taylor' }]);
  assert.equal(request.body.subject, 'Hello');
  assert.equal(request.body.textContent, '<img src=x onerror="alert(1)">\nA & B');
  assert.equal(request.body.htmlContent, '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<br>A &amp; B</p>');
});

test('optional email fields get defaults and invalid submissions never contact Brevo', async () => {
  const p = provider(), body = { recipientEmail: 'recipient@example.com', message: 'Hello' };
  await email.sendEmail(body, p.options);
  assert.equal(p.requests[0].body.to[0].name, 'User');
  assert.equal(p.requests[0].body.subject, 'Hello from our WebApp');
  for (const change of [{ recipientEmail: 'bad' }, { recipientEmail: [] }, { message: '   ' }, { message: {} },
    { subject: {} }, { subject: 'a'.repeat(201) }, { subject: 'Line\nBreak' },
    { recipientName: null }, { recipientName: 'a'.repeat(101) }, { recipientName: 'Line\nBreak' },
    { message: 'a'.repeat(10001) }, { sender: 'forged@example.com' }]) {
    await assert.rejects(email.sendEmail({ ...body, ...change }, p.options), email.EmailValidationError);
  }
  assert.equal(p.requests.length, 1);
});

test('verification and unlock emails include the current secure account links', async () => {
  const p = provider(), token = 'a'.repeat(64), account = { to: 'recipient@example.com', firstName: 'Alex <script>', token };
  await email.sendVerificationEmail(account, p.options);
  await email.sendUnlockEmail(account, p.options);
  const [verify, unlock] = p.requests.map(request => request.body);
  assert.equal(verify.subject, 'Action Required: Verify your email address for Haven');
  assert.equal(verify.textContent, [
    'Dear: Alex <script>',
    'Thank you for registering with Haven. We are thrilled to welcome you to our community.',
    'To ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:',
    `[ Verify My Email Address ]: ${env.PUBLIC_APP_URL}/verify-email?token=${token}`,
    'If you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.',
    'Warm regards,\nThe Haven Security Team',
  ].join('\n\n'));
  assert.ok(verify.htmlContent.includes(`href="${env.PUBLIC_APP_URL}/verify-email?token=${token}"`));
  assert.ok(verify.htmlContent.includes('>Verify My Email Address</a>'));
  assert.ok(verify.htmlContent.includes('Alex &lt;script&gt;'));
  assert.match(verify.textContent, /24 hours/);
  assert.ok(unlock.textContent.includes(`${env.PUBLIC_APP_URL}/unlock-account?token=${token}`));
  assert.match(unlock.textContent, /two minutes/);
  await assert.rejects(email.sendVerificationEmail({ ...account, token: 'bad' }, p.options), email.EmailValidationError);
  assert.equal(p.requests.length, 2);
});

test('provider rejection and missing acceptance IDs fail without exposing credentials or retrying sends', async () => {
  for (const [status, body] of [[401, { message: env.BREVO_API_KEY }], [429, { message: 'Rate limited' }],
    [500, { message: 'Failed' }], [201, {}], [201, { messageId: ' ' }]]) {
    const p = provider(status, body);
    await assert.rejects(email.sendEmail({ recipientEmail: 'recipient@example.com', message: 'Hello' }, p.options), error => {
      assert.ok(error instanceof email.EmailDeliveryError);
      assert.ok(!error.message.includes(env.BREVO_API_KEY));
      assert.ok(!error.diagnostic.includes(env.BREVO_API_KEY));
      return true;
    });
    assert.equal(p.requests.length, 1);
  }
});

test('network failures preserve privacy and do not retry an ambiguous email submission', async () => {
  let requests = 0;
  await assert.rejects(email.sendEmail({ recipientEmail: 'recipient@example.com', message: 'Hello' }, {
    env, fetchImpl: async () => { requests++; throw new Error('Private body ' + env.BREVO_API_KEY); }
  }), error => error instanceof email.EmailDeliveryError && !JSON.stringify(error).includes(env.BREVO_API_KEY));
  assert.equal(requests, 1);
});
