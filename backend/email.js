const { BrevoClient } = require('@getbrevo/brevo');

class EmailConfigurationError extends Error {
  constructor() {
    super('Email delivery is not configured. Please try again later.');
    this.reason = 'email_not_configured';
  }
}
class EmailDeliveryError extends Error {}
class EmailValidationError extends Error {}
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
function isEmail(value) {
  return typeof value === 'string' && value.length <= 255 && EMAIL_PATTERN.test(value);
}

function getEmailConfiguration(env = process.env) {
  const apiKey = env.BREVO_API_KEY?.trim();
  const name = env.SENDER_NAME?.trim();
  const senderEmail = env.SENDER_EMAIL?.trim();
  if (!apiKey || /\s|REPLACE|YOUR_API_KEY|placeholder/i.test(apiKey) || !name || name.length > 100 || /[\r\n]/.test(name) || !isEmail(senderEmail)) {
    throw new EmailConfigurationError();
  }
  let appUrl;
  try { appUrl = new URL(env.PUBLIC_APP_URL || 'http://localhost:5173'); }
  catch { throw new EmailConfigurationError(); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
  if (!(appUrl.protocol === 'https:' || (local && appUrl.protocol === 'http:')) || appUrl.username || appUrl.password ||
      (env.NODE_ENV === 'production' && appUrl.protocol !== 'https:')) throw new EmailConfigurationError();
  return { apiKey, sender: { name, email: senderEmail }, appUrl: appUrl.origin };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function deliver(content, { env = process.env, fetchImpl } = {}) {
  const configuration = getEmailConfiguration(env);
  const brevo = new BrevoClient({ apiKey: configuration.apiKey, timeoutInSeconds: 30,
    // A timeout can happen after acceptance; replaying a send can produce duplicate emails.
    maxRetries: 0, logging: { silent: true }, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  try {
    const result = await brevo.transactionalEmails.sendTransacEmail({ sender: configuration.sender, ...content });
    if (typeof result?.messageId !== 'string' || !result.messageId.trim()) throw new Error('Missing message ID');
    return { messageId: result.messageId };
  } catch (error) {
    const failure = new EmailDeliveryError('The email service could not accept the email. Please try again later.');
    failure.diagnostic = Number.isInteger(error.statusCode) ? `Brevo email submission failed (HTTP ${error.statusCode}).` : 'Brevo email submission failed.';
    throw failure;
  }
}

function validateEmailMessage(values) {
  const fields = ['recipientEmail', 'recipientName', 'subject', 'message'];
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
      Object.entries(values).some(([key, value]) => !fields.includes(key) || typeof value !== 'string')) {
    throw new EmailValidationError('Submit valid email fields.');
  }
  const { recipientEmail, recipientName, subject, message } = values;
  if (typeof recipientEmail !== 'string' || !isEmail(recipientEmail.trim()) || typeof message !== 'string' || !message.trim()) {
    throw new EmailValidationError('A valid recipient email and message are required.');
  }
  if ((recipientName !== undefined && typeof recipientName !== 'string') ||
      (subject !== undefined && typeof subject !== 'string') || (recipientName || '').length > 100 ||
      (subject || '').length > 200 || message.length > 10000 || /[\r\n]/.test((recipientName || '') + (subject || ''))) {
    throw new EmailValidationError('Use a name up to 100 characters, a single-line subject up to 200 characters, and a message up to 10,000 characters.');
  }
  return { recipientEmail: recipientEmail.trim(), recipientName: recipientName?.trim() || 'User',
    subject: subject?.trim() || 'Hello from our WebApp', message };
}

async function sendEmail(values, options = {}) {
  const { recipientEmail, recipientName, subject, message } = validateEmailMessage(values);
  return deliver({ to: [{ email: recipientEmail, name: recipientName }],
    subject, textContent: message,
    htmlContent: `<p>${escapeHtml(message).replace(/\r\n|\r|\n/g, '<br>')}</p>` }, options);
}

function accountLink(route, token, options) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new EmailValidationError('A valid account token is required.');
  const url = new URL(route, getEmailConfiguration(options.env).appUrl);
  url.searchParams.set('token', token);
  return url.href;
}

async function sendVerificationEmail({ to, firstName, token }, options = {}) {
  const link = accountLink('/verify-email', token, options);
  const name = typeof firstName === 'string' ? firstName : 'User';
  return deliver({ to: [{ email: to, name }], subject: 'Action Required: Verify your email address for Haven',
    textContent: `Dear: ${name}\n\nThank you for registering with Haven. We are thrilled to welcome you to our community.\n\nTo ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:\n\n[ Verify My Email Address ]: ${link}\n\nIf you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.\n\nWarm regards,\nThe Haven Security Team`,
    htmlContent: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your email address for Haven</title></head>
<body style="margin:0;padding:0;background-color:#f7f8f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f8f4;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #dfe6da;border-radius:12px;">
        <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#243b33;">
          <p style="margin:0 0 20px;">Dear: ${escapeHtml(name)}</p>
          <p style="margin:0 0 20px;">Thank you for registering with Haven. We are thrilled to welcome you to our community.</p>
          <p style="margin:0 0 24px;">To ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td bgcolor="#284c3e" style="border-radius:6px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 24px;border:1px solid #284c3e;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Verify My Email Address</a></td></tr></table>
          <p style="margin:0 0 24px;">If you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.</p>
          <p style="margin:0;">Warm regards,<br>The Haven Security Team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>` }, options);
}

async function sendUnlockEmail({ to, firstName, token }, options = {}) {
  const link = accountLink('/unlock-account', token, options);
  const name = typeof firstName === 'string' ? firstName : 'User';
  return deliver({ to: [{ email: to, name }], subject: 'Security Alert: Unlock your Haven account',
    textContent: `Dear ${name},\n\nYour Haven account was locked after three unsuccessful sign-in attempts. Wait two minutes after the lock before using this secure link to unlock your account:\n\nUnlock My Account: ${link}\n\nThis link expires in 24 hours. If you did not attempt to sign in, keep your account locked and contact support.\n\nThe Haven Security Team`,
    htmlContent: `<p>Dear ${escapeHtml(name)},</p><p>Your Haven account was locked after three unsuccessful sign-in attempts. Wait two minutes after the lock before using this secure link to unlock your account:</p><p><a href="${escapeHtml(link)}">Unlock My Account</a></p><p>This link expires in 24 hours. If you did not attempt to sign in, keep your account locked and contact support.</p><p>The Haven Security Team</p>` }, options);
}

module.exports = { EmailConfigurationError, EmailDeliveryError, EmailValidationError, isEmail,
  getEmailConfiguration, validateEmailMessage, sendEmail, sendVerificationEmail, sendUnlockEmail };
