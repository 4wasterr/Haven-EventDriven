const test = require('node:test');
const assert = require('node:assert/strict');
const { getEmailConfiguration, checkEmailAccess, sendEmail, getEmailDelivery, sendVerificationEmail,
    sendUnlockEmail, EmailConfigurationError, EmailDeliveryError } = require('../email');
const env = { RESEND_API_KEY: 're_TestKey123', RESEND_FROM: 'verify@haven-mail.ph', PUBLIC_APP_URL: 'http://localhost:5173' };

test('Resend is the sole email provider; missing credentials fail before sending', () => {
    const config = getEmailConfiguration({ ...env, EMAIL_PROVIDER: 'smtp', SMTP_USER: 'old@gmail.com', SMTP_PASS: 'old-secret', EMAIL_API_KEY: 'bk_us1_OldKey123' });
    assert.equal(config.provider, 'resend'); assert.equal(config.endpoint, 'https://api.resend.com/emails');
    assert.equal(config.apiKey, env.RESEND_API_KEY); assert.equal(config.from, env.RESEND_FROM);
    assert.equal(getEmailConfiguration({ RESEND_API_KEY: env.RESEND_API_KEY }).testOnly, true);
    for (const key of ['', 'bk_us1_TestKey123', 're_xxxxxxxxx', 're_REPLACE_WITH_YOUR_REAL_KEY']) {
        assert.throws(() => getEmailConfiguration({ ...env, RESEND_API_KEY: key }), EmailConfigurationError);
    }
    assert.throws(() => getEmailConfiguration({ EMAIL_API_KEY: 'bk_us1_OldKey123', SMTP_USER: 'old@gmail.com', SMTP_PASS: 'old-secret' }), /RESEND_API_KEY/);
    for (const changes of [{ RESEND_FROM: 'not-an-email' }, { RESEND_FROM: 'sender@example.com' },
        { PUBLIC_APP_URL: 'http://public-domain.com' }, { PUBLIC_APP_URL: 'https://user:password@haven-mail.ph' }]) {
        assert.throws(() => getEmailConfiguration({ ...env, ...changes }), EmailConfigurationError);
    }
});

test('verification and unlock messages use Resend authentication, templates and single-use links', async () => {
    const requests = [];
    const options = { env, fetchImpl: async (url, request) => {
        requests.push({ url, ...request, body: JSON.parse(request.body) });
        return Response.json({ id: 'resend-test-id' });
    } };
    assert.equal((await sendVerificationEmail({ to: 'recipient@gmail.com', firstName: '<Alex>', token: 'a'.repeat(64), tokenId: 'verify-id' }, options)).status, 'accepted');
    await sendUnlockEmail({ to: 'recipient@outlook.com', firstName: 'Alex', token: 'b'.repeat(64), tokenId: 'unlock-id' }, options);
    assert.equal(requests[0].url, 'https://api.resend.com/emails'); assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
    assert.equal(requests[0].headers['Idempotency-Key'], 'email-verification-verify-id');
    assert.equal(requests[1].headers['Idempotency-Key'], 'account-unlock-unlock-id');
    assert.equal(requests[0].body.from, `Haven <${env.RESEND_FROM}>`); assert.deepEqual(requests[0].body.to, ['recipient@gmail.com']);
    assert.equal(requests[0].body.subject, 'Action Required: Verify your email address for Haven');
    assert.match(requests[0].body.html, /Dear &lt;Alex&gt;/); assert.match(requests[0].body.html, /Verify My Email Address/);
    assert.match(requests[0].body.html, /expire in 24 hours/);
    assert.ok(requests[0].body.text.includes(`/verify-email?token=${'a'.repeat(64)}`));
    assert.ok(requests[1].body.text.includes(`/unlock-account?token=${'b'.repeat(64)}`));
    assert.match(requests[1].body.text, /wait two minutes/);
    assert.deepEqual(Object.keys(requests[0].body).sort(), ['from', 'html', 'subject', 'text', 'to']);
    assert.ok(!JSON.stringify(requests.map(request => request.body)).includes(env.RESEND_API_KEY));
});

test('Resend HTTP success requires an email ID and never implies inbox delivery', async () => {
    const message = { to: 'recipient@yahoo.com', subject: 'Test', text: 'Test' };
    assert.deepEqual(await sendEmail(message, { env, fetchImpl: async () => Response.json({ id: 'sent-id' }) }), { id: 'sent-id', status: 'accepted' });
    for (const data of [{}, { id: '' }, { error: 'rejected' }, null]) {
        await assert.rejects(sendEmail(message, { env, fetchImpl: async () => Response.json(data) }), EmailDeliveryError);
    }
    await assert.rejects(sendEmail({ ...message, to: 'invalid' }, { env, fetchImpl: () => { throw new Error('must not send'); } }), EmailDeliveryError);
});

test('Resend domain and authentication failures have safe actionable errors', async () => {
    const message = { to: 'recipient@gmail.com', subject: 'Test', text: 'Test' };
    for (const [status, hint] of [[401, /RESEND_API_KEY/], [403, /verified sending domain/], [422, /sender, recipient/], [429, /sending limit/], [500, /dashboard/]]) {
        await assert.rejects(sendEmail(message, { env, fetchImpl: async () => Response.json({ message: 'private-provider-body' }, { status }) }), error => {
            assert.ok(error instanceof EmailDeliveryError); assert.match(error.message, hint);
            assert.ok(!error.message.includes('private-provider-body')); assert.ok(!error.message.includes(env.RESEND_API_KEY)); return true;
        });
    }
    await assert.rejects(sendEmail(message, { env: { ...env, RESEND_FROM: 'onboarding@resend.dev' },
        fetchImpl: async () => Response.json({ name: 'validation_error' }, { status: 403 }) }), /only email your Resend account address/);
    await assert.rejects(sendEmail(message, { env, fetchImpl: async () => { throw new Error(env.RESEND_API_KEY); } }),
        error => error instanceof EmailDeliveryError && !error.message.includes(env.RESEND_API_KEY));
});

test('sender checks distinguish restricted test mode, verified domains and disabled sending without sending mail', async () => {
    const testMode = await checkEmailAccess({ env: { ...env, RESEND_FROM: 'onboarding@resend.dev' }, fetchImpl: () => { throw new Error('must not send'); } });
    assert.equal(testMode.ready, false); assert.equal(testMode.testOnly, true); assert.match(testMode.message, /account email/);
    for (const [status, sending, expected] of [['verified', 'enabled', true], ['pending', 'enabled', false], ['verified', 'disabled', false]]) {
        const result = await checkEmailAccess({ env, fetchImpl: async (url, request) => {
            assert.equal(new URL(url).pathname, '/domains'); assert.notEqual(request.method, 'POST');
            return Response.json({ data: [{ name: 'haven-mail.ph', status, capabilities: { sending } }], has_more: false });
        } });
        assert.equal(result.ready, expected);
    }
    assert.equal((await checkEmailAccess({ env, fetchImpl: async () => Response.json({ data: [], has_more: false }) })).ready, false);
    await assert.rejects(checkEmailAccess({ env, fetchImpl: async () => Response.json({ name: 'restricted_api_key' }, { status: 401 }) }), /Full access/);
});

test('sender readiness checks all pages and rejects malformed pagination', async () => {
    let requests = 0;
    const result = await checkEmailAccess({ env, fetchImpl: async url => {
        requests++;
        if (requests === 1) return Response.json({ data: [{ id: 'first-domain', name: 'other.ph' }], has_more: true });
        assert.equal(new URL(url).searchParams.get('after'), 'first-domain');
        return Response.json({ data: [{ name: 'haven-mail.ph', status: 'verified' }], has_more: false });
    } });
    assert.equal(result.ready, true); assert.equal(requests, 2);
    for (const data of [{}, { data: [], has_more: true }]) await assert.rejects(checkEmailAccess({ env, fetchImpl: async () => Response.json(data) }), EmailDeliveryError);
});

test('delivery diagnostics return only Resend status, keeping message content and tokens private', async () => {
    const delivery = await getEmailDelivery('sent-id', { env, fetchImpl: async (url, request) => {
        assert.equal(url, 'https://api.resend.com/emails/sent-id'); assert.equal(request.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
        return Response.json({ id: 'sent-id', last_event: 'delivered', html: 'private-token' });
    } });
    assert.deepEqual(delivery, { id: 'sent-id', status: 'delivered' });
    await assert.rejects(getEmailDelivery('../secret', { env }), EmailDeliveryError);
    await assert.rejects(getEmailDelivery('sent-id', { env, fetchImpl: async () => Response.json({ id: 'other-id', last_event: 'delivered' }) }), EmailDeliveryError);
});
