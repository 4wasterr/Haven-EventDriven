const test = require('node:test');
const assert = require('node:assert/strict');
const { getSmsConfiguration, checkSmsAccess, normalizePhoneNumber, parseRecipient,
    createVerification, checkVerification, SmsConfigurationError, SmsDeliveryError, SmsBillingError } = require('../sms');

const env = { INFOBIP_API_KEY: 'private-test-api-key', INFOBIP_BASE_URL: 'https://test.api.infobip.com',
    INFOBIP_2FA_APPLICATION_ID: 'app_123', INFOBIP_2FA_MESSAGE_ID: 'msg_123' };
const pinId = '9C817C6F8AF3D48F9FE553282AFA2B67', id = `infobip:${pinId}`, phone = '+639171234567';
const base = env.INFOBIP_BASE_URL + '/2fa/2';
const application = { applicationId: env.INFOBIP_2FA_APPLICATION_ID, enabled: true,
    configuration: { pinAttempts: 3, allowMultiplePinVerifications: false, pinTimeToLive: '5m' } };
const template = { applicationId: env.INFOBIP_2FA_APPLICATION_ID, messageId: env.INFOBIP_2FA_MESSAGE_ID,
    pinLength: 6, pinType: 'NUMERIC' };
const sent = { pinId, to: phone.slice(1), smsStatus: 'MESSAGE_SENT' };
const checked = { pinId, msisdn: phone.slice(1), verified: true, attemptsRemaining: 0 };
function provider(payload = sent, status = 200, requests = [], app = application, message = template) {
    return async (url, request) => {
        requests.push({ url, ...request });
        return request.method === 'GET' ? Response.json(url.includes('/messages/') ? message : app) : Response.json(payload, { status });
    };
}

test('Infobip configuration uses dedicated credentials and ignores previous SMS providers', () => {
    const config = getSmsConfiguration({ ...env, BIRD_API_KEY: 'old-bird-key', TWILIO_AUTH_TOKEN: 'old-twilio-token', RESEND_API_KEY: 'email-only' });
    assert.equal(config.provider, 'infobip'); assert.equal(config.apiKey, env.INFOBIP_API_KEY);
    assert.equal(getSmsConfiguration({ ...env, INFOBIP_BASE_URL: 'test.api.infobip.com' }).baseUrl, env.INFOBIP_BASE_URL);
    for (const invalid of [{}, { ...env, INFOBIP_API_KEY: '' }, { ...env, INFOBIP_2FA_MESSAGE_ID: '' },
        { ...env, INFOBIP_BASE_URL: 'http://test.api.infobip.com' }, { ...env, INFOBIP_BASE_URL: 'https://evil.example' },
        { ...env, INFOBIP_BASE_URL: 'https://test.api.infobip.com.evil.example' },
        { ...env, INFOBIP_BASE_URL: 'https://user:pass@test.api.infobip.com' },
        { ...env, INFOBIP_2FA_APPLICATION_ID: '../another-app' }]) {
        assert.throws(() => getSmsConfiguration(invalid), error => {
            assert.ok(error instanceof SmsConfigurationError); assert.match(error.diagnostic, /INFOBIP_API_KEY/);
            assert.ok(!error.message.includes('INFOBIP_')); return true;
        });
    }
});

test('international and local phone formats normalize correctly and invalid/email recipients are rejected', () => {
    assert.equal(normalizePhoneNumber(phone), phone);
    assert.equal(normalizePhoneNumber('09171234567', 'PH'), phone);
    assert.equal(normalizePhoneNumber('9171234567', 'PH'), phone);
    assert.equal(normalizePhoneNumber('4155550123', 'US'), '+14155550123');
    assert.equal(normalizePhoneNumber('07400123456', 'GB'), '+447400123456');
    assert.deepEqual(parseRecipient({ phone_number: phone }), { phone_number: phone });
    for (const value of ['', 'abc', '123', '+63', 'recipient@gmail.com', { email: 'recipient@gmail.com' }, {}]) {
        assert.throws(() => parseRecipient(value), SmsDeliveryError);
    }
});

test('API keys cannot masquerade as 2FA application or template IDs', () => {
    const key = 'a'.repeat(32) + '-12345678-1234-1234-1234-123456789012';
    for (const field of ['INFOBIP_2FA_APPLICATION_ID', 'INFOBIP_2FA_MESSAGE_ID']) {
        assert.throws(() => getSmsConfiguration({ ...env, [field]: key }), error => {
            assert.ok(error instanceof SmsConfigurationError);
            assert.match(error.diagnostic, /API key was entered as a 2FA resource ID/);
            assert.ok(!error.message.includes(key));
            assert.ok(!error.diagnostic.includes(key));
            return true;
        });
    }
});

test('Infobip SMS creation uses JSON and App auth for the account recipient with number lookup disabled', async () => {
    const requests = [];
    const result = await createVerification({ to: phone }, { env, fetchImpl: provider(sent, 200, requests) });
    assert.equal(result.id, id); assert.equal(result.status, 'pending'); assert.equal(result.expiresAt, null);
    assert.deepEqual(result.to, { phone_number: phone }); assert.equal(requests.length, 3);
    assert.equal(requests[0].method, 'GET'); assert.equal(requests[1].method, 'GET');
    const request = requests[2];
    assert.equal(request.url, base + '/pin?ncNeeded=false'); assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'App ' + env.INFOBIP_API_KEY);
    assert.equal(request.headers['Content-Type'], 'application/json'); assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { applicationId: env.INFOBIP_2FA_APPLICATION_ID,
        messageId: env.INFOBIP_2FA_MESSAGE_ID, to: phone.slice(1) });
    assert.ok(!JSON.stringify(result).includes(env.INFOBIP_API_KEY));
});

test('email recipients fail before any provider call', async () => {
    await assert.rejects(createVerification({ to: { email: 'recipient@gmail.com' } }, {
        env, fetchImpl: () => { assert.fail('email must not use Infobip SMS'); }
    }), SmsDeliveryError);
});

test('access check reads the application and template without sending SMS or leaking keys', async () => {
    const requests = [];
    const result = await checkSmsAccess({ env, fetchImpl: provider(sent, 200, requests) });
    assert.equal(result.accessible, true); assert.equal(result.provider, 'infobip');
    assert.equal(requests.length, 2); assert.ok(requests.every(request => request.method === 'GET' && request.body === undefined));
    assert.equal(requests[1].url, `${base}/applications/app_123/messages/msg_123`);
    assert.ok(!JSON.stringify(result).includes(env.INFOBIP_API_KEY)); assert.match(result.message, /does not confirm/);
});

test('incorrect application/template settings never dispatch unusable or replayable OTPs', async () => {
    for (const [app, message] of [[{}, template], [{ ...application, enabled: false }, template],
        [{ ...application, configuration: { ...application.configuration, allowMultiplePinVerifications: true } }, template],
        [{ ...application, configuration: { ...application.configuration, pinAttempts: 5 } }, template],
        [{ ...application, configuration: { ...application.configuration, pinTimeToLive: '10m' } }, template],
        [application, { ...template, pinLength: 4 }], [application, { ...template, pinType: 'ALPHANUMERIC' }],
        [application, { ...template, applicationId: 'other_app' }]]) {
        const requests = [], fetchImpl = provider(sent, 200, requests, app, message);
        assert.equal((await checkSmsAccess({ env, fetchImpl })).accessible, false);
        await assert.rejects(createVerification({ to: phone }, { env, fetchImpl }), SmsConfigurationError);
        assert.ok(requests.every(request => request.method === 'GET'));
    }
    for (const status of [401, 403, 404]) {
        const result = await checkSmsAccess({ env, fetchImpl: async () => Response.json({ requestError: { serviceException: { text: 'private provider data' } } }, { status }) });
        assert.equal(result.accessible, false); assert.equal(result.status, status); assert.ok(!result.message.includes('private provider data'));
    }
});

test('provider failures explain configuration, trial and rate limits without returning raw provider data', async () => {
    for (const [status, ErrorType, diagnostic] of [[401, SmsConfigurationError, /2fa:manage/], [403, SmsConfigurationError, /verified recipients/],
        [402, SmsBillingError, /trial period/], [400, SmsDeliveryError, /trial sender/], [429, SmsDeliveryError, /rate limit/], [500, SmsDeliveryError, /HTTP 500/]]) {
        await assert.rejects(createVerification({ to: phone }, { env, fetchImpl: provider({ message: 'private data ' + env.INFOBIP_API_KEY }, status) }), error => {
            assert.ok(error instanceof ErrorType); assert.match(error.diagnostic, diagnostic);
            assert.ok(!error.message.includes('private data')); assert.ok(!JSON.stringify(error).includes(env.INFOBIP_API_KEY)); return true;
        });
    }
});

test('transport failures never automatically retry ambiguous sends', async () => {
    let attempts = 0;
    await assert.rejects(createVerification({ to: phone }, { env, fetchImpl: async (url, request) => {
        if (request.method === 'GET') return Response.json(url.includes('/messages/') ? template : application);
        attempts++; throw new Error('private provider data');
    } }), error => error instanceof SmsDeliveryError && !error.message.includes('private provider data'));
    assert.equal(attempts, 1);
});

test('creation rejects failed, malformed and mismatched recipient responses', async () => {
    for (const payload of [{}, { ...sent, pinId: '../bad' }, { ...sent, smsStatus: 'MESSAGE_NOT_SENT' }, { ...sent, to: '14155550123' }]) {
        await assert.rejects(createVerification({ to: phone }, { env, fetchImpl: provider(payload) }), SmsDeliveryError);
    }
});

test('PIN verification binds the stored challenge and checks the returned recipient and boolean result', async () => {
    for (const [payload, success, reason] of [[checked, true, null], [{ ...checked, verified: false, attemptsRemaining: 2 }, false, 'incorrect_code'],
        [{ ...checked, verified: false, attemptsRemaining: 0 }, false, 'attempts_exhausted'],
        [{ ...checked, verified: false, pinError: 'PIN_EXPIRED' }, false, 'expired']]) {
        let captured;
        const result = await checkVerification({ to: phone, code: '123456', id }, { env, fetchImpl: async (url, request) => {
            captured = { url, ...request }; return Response.json(payload);
        } });
        assert.equal(result.success, success); assert.equal(result.reason, reason); assert.equal(result.verification.id, id);
        assert.equal(captured.url, `${base}/pin/${pinId}/verify`); assert.deepEqual(JSON.parse(captured.body), { pin: '123456' });
    }
    for (const payload of [{}, { ...checked, pinId: 'different' }, { ...checked, msisdn: '14155550123' },
        { ...checked, verified: 'true' }, { ...checked, pinError: 'ERROR' }]) {
        await assert.rejects(checkVerification({ to: phone, code: '123456', id }, { env, fetchImpl: async () => Response.json(payload) }), SmsDeliveryError);
    }
});

test('legacy provider IDs, missing challenges and invalid codes cannot verify a number', async () => {
    for (const oldId of ['VE' + 'a'.repeat(32), 'ver_old_bird_id', 'infobip:../bad']) {
        const result = await checkVerification({ to: phone, code: '123456', id: oldId }, {
            env, fetchImpl: () => { assert.fail('legacy IDs must not contact Infobip'); }
        });
        assert.equal(result.success, false); assert.equal(result.reason, 'not_found');
    }
    const result = await checkVerification({ to: phone, code: '123456', id }, { env, fetchImpl: async () => Response.json({}, { status: 404 }) });
    assert.equal(result.success, false); assert.equal(result.reason, 'not_found');
    for (const params of [{ to: phone, code: '12345', id }, { to: phone, code: '123456' }]) {
        await assert.rejects(checkVerification(params, { env, fetchImpl: () => { assert.fail('invalid input must not contact Infobip'); } }), SmsDeliveryError);
    }
});
