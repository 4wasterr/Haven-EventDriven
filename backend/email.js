// Resend is the sole provider for verification and account-unlock emails.
class EmailConfigurationError extends Error {}
class EmailDeliveryError extends Error {}
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const API_BASE = 'https://api.resend.com';

function isEmail(value) {
    return typeof value === 'string' && value.length <= 255 && EMAIL_PATTERN.test(value);
}

function getEmailConfiguration(env = process.env) {
    const apiKey = (env.RESEND_API_KEY || '').trim();
    if (!/^re_[A-Za-z0-9_-]+$/.test(apiKey) || /REPLACE|^re_x+$/i.test(apiKey)) {
        throw new EmailConfigurationError('Set RESEND_API_KEY in backend/.env to your real Resend API key from https://resend.com/api-keys.');
    }
    const from = (env.RESEND_FROM || 'onboarding@resend.dev').trim();
    if (!isEmail(from) || /@example\.(com|net|org)$/i.test(from)) {
        throw new EmailConfigurationError('Set RESEND_FROM to a sender address on your verified Resend domain, or onboarding@resend.dev for tests to your Resend account email.');
    }
    let publicUrl;
    try { publicUrl = new URL(env.PUBLIC_APP_URL || 'http://localhost:5173'); }
    catch { throw new EmailConfigurationError('PUBLIC_APP_URL must be a valid application URL.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
    if (publicUrl.username || publicUrl.password || !(publicUrl.protocol === 'https:' || (local && publicUrl.protocol === 'http:'))) {
        throw new EmailConfigurationError('PUBLIC_APP_URL must use HTTPS, or HTTP on localhost for local testing.');
    }
    return { provider: 'resend', apiKey, from, publicUrl, endpoint: `${API_BASE}/emails`, testOnly: from.toLowerCase().endsWith('@resend.dev') };
}

async function resendRequest(resource, config, options = {}, request = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    try {
        const response = await fetchImpl(`${API_BASE}${resource}`, {
            ...request,
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...request.headers },
            signal: AbortSignal.timeout(10000)
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
            // Use fixed, actionable hints; never expose provider response bodies, credentials or tokens.
            let hint = 'Check your Resend dashboard for the sending error.';
            if (response.status === 401) hint = 'Check RESEND_API_KEY.';
            if (data?.name === 'restricted_api_key' && request.method !== 'POST') hint = 'This diagnostic needs a Full access Resend key. A Sending access key can still send emails; check delivery in the Resend dashboard.';
            else if (response.status === 403) hint = config.testOnly ?
                'The resend.dev test sender can only email your Resend account address. Verify your own sender domain and set RESEND_FROM to email other registered users.' :
                'Check that RESEND_FROM uses a verified sending domain and that the API key permits sending from it.';
            if (response.status === 422) hint = 'Check the sender, recipient and email fields.';
            if (response.status === 429 || ['daily_quota_exceeded', 'monthly_quota_exceeded', 'rate_limit_exceeded'].includes(data?.name)) hint = 'Resend has reached a sending limit. Check your Resend quota and try again later.';
            throw new EmailDeliveryError(`Resend rejected the email request (HTTP ${response.status}). ${hint}`);
        }
        if (!data || typeof data !== 'object') throw new EmailDeliveryError('Resend returned an invalid response; email acceptance could not be confirmed.');
        return data;
    } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        throw new EmailDeliveryError('Could not confirm the email request with Resend. Check your connection and try again.');
    }
}

async function checkEmailAccess(options = {}) {
    const config = getEmailConfiguration(options.env);
    if (config.testOnly) return { provider: 'resend', ready: false, testOnly: true,
        message: 'Resend test mode: onboarding@resend.dev only sends to your Resend account email. Verify a domain you own and set RESEND_FROM to send to all registered Gmail, Outlook, Yahoo and other supported recipients.' };
    const domain = config.from.split('@')[1].toLowerCase();
    let after;
    do {
        const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
        const data = await resendRequest(`/domains?${query}`, config, options);
        if (!Array.isArray(data.data)) throw new EmailDeliveryError('Resend returned an invalid sender-domain response.');
        const found = data.data.find(item => item.name?.toLowerCase() === domain);
        if (found) {
            const ready = found.status === 'verified' && found.capabilities?.sending !== 'disabled';
            return { provider: 'resend', ready, testOnly: false, message: ready ?
                'Resend sender domain is verified. Send a real recipient test to confirm delivery.' :
                'The Resend sender domain is not verified for sending. Complete its DNS verification and enable sending in Resend.' };
        }
        const next = data.has_more && data.data.at(-1)?.id;
        if (data.has_more && (!next || next === after)) throw new EmailDeliveryError('Resend returned an invalid domain pagination response.');
        after = next;
    } while (after);
    return { provider: 'resend', ready: false, testOnly: false,
        message: 'RESEND_FROM does not match a domain registered in Resend. Add and verify a domain you own; public inbox domains such as gmail.com cannot be used as your sender domain.' };
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function sendEmail({ to, subject, html, text, idempotencyKey }, options = {}) {
    const config = getEmailConfiguration(options.env);
    if (!isEmail(to)) throw new EmailDeliveryError('A valid recipient email address is required.');
    const data = await resendRequest('/emails', config, options, {
        method: 'POST', headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
        body: JSON.stringify({ from: `Haven <${config.from}>`, to: [to], subject, html, text })
    });
    // Resend's successful send response contains an ID, not a delivery status.
    if (typeof data.id !== 'string' || !data.id.trim()) throw new EmailDeliveryError('Resend did not return an email ID; acceptance could not be confirmed.');
    return { id: data.id, status: 'accepted' };
}

async function getEmailDelivery(id, options = {}) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new EmailDeliveryError('A valid Resend email ID is required.');
    const data = await resendRequest(`/emails/${encodeURIComponent(id)}`, getEmailConfiguration(options.env), options);
    if (data.id !== id || typeof data.last_event !== 'string') throw new EmailDeliveryError('Resend did not return a valid delivery status.');
    return { id: data.id, status: data.last_event };
}

async function sendVerificationEmail({ to, firstName, token, tokenId }, options = {}) {
    const config = getEmailConfiguration(options.env);
    const link = new URL("/verify-email", config.publicUrl);
    link.searchParams.set("token", token);
    const text = `Dear ${firstName},\n\nThank you for registering with Haven. We are thrilled to welcome you to our community.\n\nTo ensure the security of your account and complete your registration, please verify your email address:\n${link.href}\n\nIf you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.\n\nWarm regards,\nThe Haven Security Team`;
    const html = `<p>Dear ${escapeHtml(firstName)},</p>
<p>Thank you for registering with Haven. We are thrilled to welcome you to our community.</p>
<p>To ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:</p>
<p><a href="${escapeHtml(link.href)}">Verify My Email Address</a></p>
<p>If you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.</p>
<p>Warm regards,<br>The Haven Security Team</p>`;
    return sendEmail({ to, subject: "Action Required: Verify your email address for Haven", html, text,
        idempotencyKey: `email-verification-${tokenId}` }, options);
}

async function sendUnlockEmail({ to, firstName, token, tokenId }, options = {}) {
    const config = getEmailConfiguration(options.env);
    const link = new URL('/unlock-account', config.publicUrl);
    link.searchParams.set('token', token);
    const subject = 'Security alert: Your Haven account is locked';
    const text = `Dear ${firstName},\n\nYour Haven account was locked after three unsuccessful sign-in attempts. For your security, wait two minutes before unlocking your account using this secure link:\n${link.href}\n\nThis link expires in 24 hours and can only be used once. If you did not attempt to sign in, secure your email account and contact support.\n\nThe Haven Security Team`;
    const html = `<p>Dear ${escapeHtml(firstName)},</p><p>Your Haven account was locked after three unsuccessful sign-in attempts.</p><p>Wait two minutes, then use the secure link below to unlock your account.</p><p><a href="${escapeHtml(link.href)}">Unlock My Account</a></p><p>This link expires in 24 hours and can only be used once. If you did not attempt to sign in, secure your email account and contact support.</p><p>The Haven Security Team</p>`;
    return sendEmail({ to, subject, text, html, idempotencyKey: `account-unlock-${tokenId}` }, options);
}
module.exports = { EmailConfigurationError, EmailDeliveryError, getEmailConfiguration, checkEmailAccess,
    isEmail, escapeHtml, sendEmail, getEmailDelivery, sendVerificationEmail, sendUnlockEmail };
