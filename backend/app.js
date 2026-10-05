const express = require('express');
const crypto = require('crypto');
const path = require('path');
const email = require('./email');
const sms = require('./sms');
const { generateOtp, hashOtp, matchesOtp, OTP_TTL, OTP_RESEND_DELAY, OTP_MAX_ATTEMPTS } = require('./otp');
const { Store, hashToken } = require('./store');
const { security, hashPassword, comparePassword } = require('./auth');
const { fetchHolidays, getHolidayConfiguration, HolidayError, HOLIDAY_SOURCE, HOLIDAY_SOURCE_URL } = require('./holidays');
const addresses = require('./addresses');
const validation = import('../frontend/src/validation.mjs');
const formatting = import('../frontend/src/format.mjs');

class RequestError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
const timestamp = value => value ? new Date(value).getTime() : 0;
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function publicUser(user) {
  const birthday = user.birthday instanceof Date ? user.birthday.toISOString().slice(0,10) : String(user.birthday).slice(0,10);
  const [year, month, day] = birthday.split('-');
  return { id: user.id, firstName: user.first_name, lastName: user.last_name, middleInitial: user.middle_initial || '',
    birthday: `${month}/${day}/${year}`, email: user.email, mobile: user.mobile_number,
    country: ({ Philippines: 'PH', 'United States': 'US', 'United Kingdom': 'GB' })[user.country] || user.country,
    region: user.state, city: user.city, postal: user.zip_code, houseStreet: user.house_street,
    emailVerified: Boolean(user.email_verified_at), mobileVerified: Boolean(user.mobile_verified) };
}
const publicOtp = mobile => mobile ? { sent: Boolean(mobile.provider_id && mobile.otp_hash), expiresAt: timestamp(mobile.expires_at),
  resendAt: timestamp(mobile.resend_at), attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - mobile.attempts), locked: Boolean(mobile.is_locked) } : null;

function createApp({ db, store = new Store(db), emailService = email, smsService = sms, now = Date.now,
  env = process.env, logger = console, holidayService = fetchHolidays, holidaySource = HOLIDAY_SOURCE } = {}) {
  const app = express();
  const auth = security(app, { env, store, now });
  // Limit all CSRF-validated submissions, including malformed and rejected ones.
  app.use('/api/register', (req, res, next) => req.method === 'POST' ? limit('register', 5, 3600000)(req, res, next) : next());
  app.use('/api/send-email', express.json({ limit: '64kb' }));
  app.use(express.json({ limit: '16kb' }));
  function serviceStatus() {
    let email = true, sms = true, holidays = true;
    try { emailService.getEmailConfiguration(env); } catch { email = false; }
    try { smsService.getSmsConfiguration(env); } catch { sms = false; }
    if (holidayService === fetchHolidays) { try { getHolidayConfiguration(env); } catch { holidays = false; } }
    return { email, sms, holidays };
  }
  function limit(name, count, duration) {
    return async (req, res, next) => {
      const retry = await store.consumeRate(`${name}:${req.ip}`, count, duration, now());
      if (retry) { res.set('Retry-After', String(retry)); throw new RequestError(429, 'Too many requests. Please try again later.', { retryAfter: retry }); }
      next();
    };
  }
  async function account(req, authenticated = false) {
    const session = await auth.session(req);
    if (!session || (authenticated && session.type !== 'authenticated')) throw new RequestError(401, 'Sign in to continue.');
    const user = await store.user(session.user_id);
    if (!user || user.is_locked || (authenticated && (!user.email_verified_at || !user.mobile_verified))) throw new RequestError(401, 'Sign in to continue.');
    return user;
  }
  async function submitEmail(kind, user, token) {
    try {
      await emailService[kind]({ to: user.email, firstName: user.first_name, ...token }, { env });
      return true;
    } catch (error) {
      logger.error(error instanceof email.EmailDeliveryError ? error.message : 'Email submission failed.');
      return false;
    }
  }
  async function sendOtp(userId) {
    return store.transaction(async tx => {
      const user = await tx.user(userId, true);
      if (!user || !user.email_verified_at || user.is_locked) throw new RequestError(403, 'Verify your email address before verifying your mobile number.');
      if (user.mobile_verified) return { mobile_verified: true };
      const saved = await tx.mobile(user.id);
      if (saved?.is_locked) throw new RequestError(423, 'Mobile verification is locked after three incorrect attempts. Contact support.', { reason: 'attempts_exhausted', otp: publicOtp(saved) });
      const retry = Math.ceil((timestamp(saved?.resend_at) - now()) / 1000);
      if (retry > 0) throw new RequestError(429, 'Wait 60 seconds before requesting another code.', { retryAfter: retry, otp: publicOtp(saved) });
      smsService.getSmsConfiguration(env);
      let code;
      // A resend always replaces the previous code, including a random collision.
      do { code = generateOtp(); } while (saved?.otp_hash && await matchesOtp(code, saved.otp_hash, user));
      const otpHash = await hashOtp(code, user);
      const { timeZoneFor } = await formatting;
      // The SMS, persisted verifier and UI all use the same five-minute deadline.
      const sentAt = now();
      const expiresAt = sentAt + OTP_TTL;
      const result = await smsService.createVerification({ to: user.mobile_number, code, expiresAt,
        timeZone: timeZoneFor(publicUser(user)) }, { env });
      const mobile = { provider_id: result.id, otp_hash: otpHash, expires_at: new Date(expiresAt),
        resend_at: new Date(sentAt + OTP_RESEND_DELAY), attempts: saved?.attempts || 0, is_locked: false };
      await tx.saveMobile(user.id, mobile);
      return { success: true, message: 'OTP sent successfully.', otp: publicOtp(mobile) };
    });
  }
  app.get('/api/health', async (req, res) => {
    if (db) await db.query('SELECT 1');
    const services = serviceStatus();
    res.json({ status: 'ok', emailConfigured: services.email, smsConfigured: services.sms,
      holidayConfigured: services.holidays });
  });
  app.get('/api/session', async (req, res) => {
    const session = await auth.session(req);
    const user = session && await store.user(session.user_id);
    const services = serviceStatus();
    if (!user || user.is_locked) return res.json({ user: null, pending: null, services });
    const verified = user.email_verified_at && user.mobile_verified;
    return res.json(session.type === 'authenticated' && verified ? { user: publicUser(user), pending: null, services }
      : { user: null, pending: { ...publicUser(user), otp: publicOtp(await store.mobile(user.id)) }, services });
  });
  app.get('/api/addresses/countries', (req, res) => res.json(addresses.countries));
  app.post('/api/send-email', async (req, res) => {
    const user = await account(req, true);
    const content = email.validateEmailMessage(req.body);
    emailService.getEmailConfiguration(env);
    const retry = await store.consumeRate(`compose-email:${user.id}`, 10, 3600000, now());
    if (retry) throw new RequestError(429, 'You have reached the email sending limit. Please try again later.', { retryAfter: retry });
    const result = await emailService.sendEmail(content, { env });
    res.status(200).json({ success: true, messageId: result.messageId });
  });
  app.get('/api/addresses/cities', async (req, res) => {
    const country = String(req.query.country || ''), region = String(req.query.region || '');
    if (!/^[A-Z]{2}$/.test(country) || region.length > 100) throw new RequestError(400, 'Choose a country and province or state.');
    res.json({ cities: await addresses.getCities(country, region) });
  });
  app.get('/api/addresses/postal-codes', async (req, res) => {
    const country = String(req.query.country || ''), region = String(req.query.region || ''), city = String(req.query.city || '');
    if (!/^[A-Z]{2}$/.test(country) || region.length > 100 || !city || city.length > 100) throw new RequestError(400, 'Choose a country, province or state, and city.');
    const choices = await addresses.getPostalChoices(country, region, city);
    if (choices.invalidCity) throw new RequestError(400, 'Choose a city in the selected province or state.');
    res.json(choices);
  });
  app.post('/api/register', async (req, res) => {
    const values = req.body;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string') || 'password_hash' in values) {
      throw new RequestError(400, 'Submit valid registration fields and a password.');
    }
    const rules = await validation;
    const postalChoices = await addresses.getPostalChoices(values.country, values.region, values.city);
    const errors = rules.validateRegistration(values, rules.manilaToday(new Date(now())), { postalMode: postalChoices.mode, postalCodes: postalChoices.options });
    if (!errors.country && !errors.region && !errors.city && !errors.postal) Object.assign(errors, await addresses.validateAddress(values));
    if (Object.keys(errors).length) throw new RequestError(400, 'Please correct the highlighted fields.', { errors });
    emailService.getEmailConfiguration(env);
    const passwordHash = await hashPassword(values.password);
    const to = rules.normalizeEmail(values.email);
    const [month, day, year] = values.birthday.split('/');
    const user = { id: crypto.randomUUID(), first_name: values.firstName.trim(), last_name: values.lastName.trim(),
      middle_initial: values.middleInitial || null, birthday: `${year}-${month}-${day}`, password_hash: passwordHash,
      email: to, email_verified_at: null, mobile_verified: 0,
      mobile_number: rules.internationalMobileNumber(values.mobile, values.country) };
    const token = await store.transaction(async tx => {
      if (await tx.userByEmail(to, true)) throw new RequestError(409, 'This email is already registered.', { errors: { email: 'This email is already registered. Sign in to continue.' } });
      await tx.insertUser(user, { id: crypto.randomUUID(), user_id: user.id, house_street: values.houseStreet.trim(),
        country: values.country, city: values.city, state: values.region, zip_code: values.postal });
      const token = await tx.replaceToken(user.id, 'email_verify', now());
      await auth.issue(req, res, tx, user.id, 'verification');
      return token;
    });
    const submitted = await submitEmail('sendVerificationEmail', user, token);
    res.status(201).json({ email_submitted: submitted, email_verification_required: true,
      message: submitted ? 'Account created. Check your inbox to verify your email.' : 'Account created, but the email service could not accept the verification email. Request another verification email to try again.' });
  });
  app.post('/api/resend-verification', limit('email-send', 10, 3600000), async (req, res) => {
    const user = await account(req);
    if (user.email_verified_at) throw new RequestError(400, 'Your email is already verified.');
    emailService.getEmailConfiguration(env);
    const token = await store.transaction(async tx => {
      await tx.user(user.id, true);
      const old = await tx.latestToken(user.id, 'email_verify');
      const retry = Math.ceil((timestamp(old?.expires_at) - 86400000 + 60000 - now()) / 1000);
      if (retry > 0) throw new RequestError(429, 'Wait 60 seconds before requesting another email.', { retryAfter: retry });
      return tx.replaceToken(user.id, 'email_verify', now());
    });
    if (!await submitEmail('sendVerificationEmail', user, token)) throw new RequestError(502, 'The email service could not accept the verification email. Please try again after 60 seconds.');
    res.status(202).json({ message: 'Verification email requested. Check your inbox and spam folder.' });
  });
  app.get('/api/verify-email', (req, res) => {
    if (!validToken(req.query.token)) throw new RequestError(400, 'This verification link is invalid.');
    const url = new URL('/verify-email', env.PUBLIC_APP_URL || 'http://localhost:5173');
    url.searchParams.set('token', req.query.token);
    res.redirect(303, url.href);
  });
  app.post('/api/verify-email', limit('email-verify', 30, 60000), async (req, res) => {
    emailService.getEmailConfiguration(env);
    if (!validToken(req.body?.token)) throw new RequestError(400, 'This verification link is invalid.');
    const saved = await store.tokenByHash(hashToken(req.body.token), 'email_verify');
    if (!saved) throw new RequestError(400, 'This verification link is invalid or has already been used.');
    await store.transaction(async tx => {
      const user = await tx.user(saved.user_id, true);
      const current = await tx.tokenByHash(hashToken(req.body.token), 'email_verify', true);
      if (!user || !current) throw new RequestError(400, 'This verification link has already been used.');
      if (timestamp(current.expires_at) <= now()) throw new RequestError(410, 'This verification link has expired. Request another verification email.');
      await tx.updateUser(user.id, { email_verified_at: new Date(now()), updated_at: new Date(now()) });
      await tx.deleteTokens(user.id, 'email_verify');
      await auth.issue(req, res, tx, user.id, 'verification');
    });
    let otp, smsSubmitted = false;
    try { const result = await sendOtp(saved.user_id); otp = result.otp; smsSubmitted = true; }
    catch (error) { logger.error(error.diagnostic || 'Email verified; mobile delivery requires a retry.'); }
    res.json({ message: smsSubmitted ? 'Email verified. Check your phone for the SMS code.' : 'Email verified. Request an SMS code on the next screen.', email_verified: true, sms_submitted: smsSubmitted, otp });
  });
  app.post(['/api/send-otp', '/api/send-mobile-otp', '/api/resend-mobile-otp'], limit('sms-send', 10, 3600000), async (req, res) => {
    const user = await account(req);
    if (req.path === '/api/send-otp' && !req.body?.phoneNumber) throw new RequestError(400, 'Phone number is required');
    if (req.body?.phoneNumber !== undefined) {
      let phone;
      try { phone = sms.normalizePhoneNumber(req.body.phoneNumber, publicUser(user).country); }
      catch { throw new RequestError(400, 'Enter a valid phone number.'); }
      if (phone !== user.mobile_number) throw new RequestError(400, 'Use the mobile number registered to your account.');
    }
    res.json(await sendOtp(user.id));
  });
  app.post('/api/verify-mobile', limit('sms-check', 30, 60000), async (req, res) => {
    const user = await account(req);
    if (typeof req.body?.code !== 'string' || !/^\d{6}$/.test(req.body.code)) throw new RequestError(400, 'Enter the six-digit code from your SMS.');
    const result = await store.transaction(async tx => {
      const current = await tx.user(user.id, true);
      if (!current.email_verified_at || current.is_locked) throw new RequestError(403, 'Verify your email first.');
      if (current.mobile_verified) return { mobile_verified: true };
      const saved = await tx.mobile(user.id);
      if (saved?.is_locked) throw new RequestError(423, 'Mobile verification is locked. Contact support.', { reason: 'attempts_exhausted', otp: publicOtp(saved) });
      if (!saved?.provider_id || !saved.otp_hash || timestamp(saved.expires_at) <= now()) throw new RequestError(410, 'Your code has expired. Request another SMS code.', { reason: 'expired', otp: publicOtp(saved) });
      if (await matchesOtp(req.body.code, saved.otp_hash, current)) {
        await tx.updateUser(user.id, { mobile_verified: 1, updated_at: new Date(now()) });
        await tx.saveMobile(user.id, { ...saved, provider_id: null, otp_hash: null, expires_at: null });
        await auth.logout(req, res, tx);
        return { mobile_verified: true, message: 'Mobile verified. Sign in to continue.' };
      }
      const attempts = saved.attempts + 1;
      const next = { ...saved, attempts, is_locked: attempts >= OTP_MAX_ATTEMPTS };
      await tx.saveMobile(user.id, next);
      return { status: attempts >= OTP_MAX_ATTEMPTS ? 423 : 400, message: attempts >= OTP_MAX_ATTEMPTS ? 'Mobile verification is locked after three incorrect attempts. Contact support.' : 'Incorrect code. Please try again.',
        reason: attempts >= OTP_MAX_ATTEMPTS ? 'attempts_exhausted' : 'incorrect_code', otp: publicOtp(next) };
    });
    const { status = 200, ...data } = result;
    res.status(status).json(data);
  });
  app.post('/api/login', limit('login', 60, 3600000), async (req, res) => {
    const { email: identifier, password } = req.body || {};
    const rules = await validation;
    if (typeof identifier !== 'string' || !rules.validEmail(rules.normalizeEmail(identifier)) || typeof password !== 'string' || !password) throw new RequestError(401, 'Invalid email or password.');
    const result = await store.transaction(async tx => {
      const user = await tx.userByEmail(rules.normalizeEmail(identifier), true);
      const validLength = Buffer.byteLength(password) <= 72;
      // Blueprint order: lock, email/active status, then the stored password hash.
      if (!user || user.is_locked) {
        await comparePassword(validLength ? password : 'invalid');
        return { invalid: true };
      }
      if (!user.email_verified_at) return { emailUnverified: true };
      const verified = Boolean(user.mobile_verified);
      const matches = await comparePassword(validLength ? password : 'invalid', validLength ? user.password_hash : undefined);
      if (!validLength || !matches) {
        const attempts = user.failed_login_attempts + 1;
        await tx.updateUser(user.id, { failed_login_attempts: attempts, is_locked: attempts >= 3 ? 1 : 0,
          // Legacy TIMESTAMP columns store whole seconds; round up so precision
          // loss can never shorten the required two-minute cooling period.
          lockout_until: attempts >= 3 ? new Date(Math.ceil((now() + 120000) / 1000) * 1000) : null, updated_at: new Date(now()) });
        if (attempts >= 3) {
          await tx.deleteUserSessions(user.id);
          return { invalid: true, lockedUser: user, unlock: await tx.replaceToken(user.id, 'account_unlock', now()) };
        }
        return { invalid: true };
      }
      await tx.updateUser(user.id, { failed_login_attempts: 0, updated_at: new Date(now()) });
      await auth.issue(req, res, tx, user.id, verified ? 'authenticated' : 'verification');
      return { next: verified ? '/dashboard' : '/verify-mobile' };
    });
    if (result.unlock) await submitEmail('sendUnlockEmail', result.lockedUser, result.unlock);
    if (result.invalid) throw new RequestError(401, 'Invalid email or password.');
    if (result.emailUnverified) throw new RequestError(403, 'Verify your email address using the link in your inbox before signing in.', { reason: 'email_unverified' });
    res.json({ next: result.next });
  });
  app.post('/api/logout', async (req, res) => { await auth.logout(req, res); res.json({ message: 'Signed out.' }); });
  app.post('/api/request-unlock', limit('unlock-mail', 5, 3600000), async (req, res) => {
    if (!email.isEmail(req.body?.email)) throw new RequestError(400, 'Enter a valid email address.');
    emailService.getEmailConfiguration(env);
    const result = await store.transaction(async tx => {
      const user = await tx.userByEmail(req.body.email.trim().toLowerCase(), true);
      if (!user?.is_locked) return null;
      const old = await tx.latestToken(user.id, 'account_unlock');
      if (timestamp(old?.expires_at) - 86400000 + 60000 > now()) return null;
      return { user, token: await tx.replaceToken(user.id, 'account_unlock', now()) };
    });
    if (result) await submitEmail('sendUnlockEmail', result.user, result.token);
    res.status(202).json({ message: 'If this account is locked, a security email has been requested. Check your inbox.' });
  });
  async function unlockStatus(token, tx = store) {
    if (!validToken(token)) throw new RequestError(400, 'This unlock link is invalid.');
    const saved = await tx.tokenByHash(hashToken(token), 'account_unlock');
    if (!saved || timestamp(saved.expires_at) <= now()) throw new RequestError(410, 'This unlock link is expired or has already been used.');
    const user = await tx.user(saved.user_id, true);
    if (!user?.is_locked) throw new RequestError(400, 'This account is already unlocked.');
    return { user, saved };
  }
  app.post('/api/unlock-status', limit('unlock-check', 30, 60000), async (req, res) => {
    const { user } = await unlockStatus(req.body?.token);
    res.json({ unlockAt: timestamp(user.lockout_until), serverNow: now() });
  });
  app.post('/api/unlock-account', limit('unlock', 30, 60000), async (req, res) => {
    await store.transaction(async tx => {
      const { user, saved } = await unlockStatus(req.body?.token, tx);
      const current = await tx.tokenByHash(saved.token_hash, 'account_unlock', true);
      if (!current) throw new RequestError(400, 'This unlock link has already been used.');
      const retry = Math.ceil((timestamp(user.lockout_until) - now()) / 1000);
      if (retry > 0) throw new RequestError(429, 'Wait two minutes before unlocking your account.', { retryAfter: retry });
      await tx.updateUser(user.id, { is_locked: 0, lockout_until: null, failed_login_attempts: 0, updated_at: new Date(now()) });
      await tx.deleteTokens(user.id, 'account_unlock');
      await tx.deleteUserSessions(user.id);
    });
    res.json({ message: 'Account unlocked. Sign in with your password.' });
  });
  app.get('/api/accounts', async (req, res) => { const user = await account(req, true); res.json({ accounts: [publicUser(user)] }); });
  app.get('/api/holidays/:year', async (req, res) => {
    await account(req, true);
    if (!/^202[0-7]$/.test(req.params.year)) throw new RequestError(400, 'Choose a year from 2020 to 2027.');
    let sourceName = 'Nager.Date';
    let sourceUrl = `https://date.nager.at`;
    try {
      const config = getHolidayConfiguration(env);
      if (config.provider === 'calendarific') {
        sourceName = 'Calendarific';
        sourceUrl = `${HOLIDAY_SOURCE_URL}${req.params.year}/PH`;
      }
    } catch {}
    res.json({ holidays: await holidayService(Number(req.params.year), { env }), source: sourceName,
      sourceUrl: holidayService === fetchHolidays ? sourceUrl : null, timeZone: 'Asia/Manila' });
  });
  // Serve the built React app in production; Vite proxies /api during development.
  const frontend = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontend));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res, next) => res.sendFile(path.join(frontend, 'index.html'), error => error && next()));
  app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (error instanceof RequestError) {
      if (error.details.retryAfter) res.set('Retry-After', String(error.details.retryAfter));
      return res.status(error.status).json({ message: error.message, ...error.details });
    }
    if (error instanceof sms.SmsConfigurationError) {
      logger.error(error.diagnostic || error.message);
      return res.status(503).json({ message: error.message, reason: error.reason });
    }
    if (error instanceof email.EmailConfigurationError) return res.status(503).json({ message: error.message, reason: error.reason });
    if (error instanceof email.EmailValidationError) return res.status(400).json({ message: error.message, error: error.message });
    if (error instanceof email.EmailDeliveryError) {
      logger.error(error.diagnostic || error.message);
      return res.status(502).json({ message: error.message, error: error.message });
    }
    if (error instanceof sms.SmsDeliveryError) {
      logger.error(error.diagnostic || error.message);
      return res.status(error.status || 502).json({ message: error.message, ...(error.reason && { reason: error.reason }) });
    }
    if (error instanceof HolidayError) return res.status(error.status).json({ message: error.message, reason: error.reason });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This email is already registered.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Submit valid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'This message is too large. Please shorten it and try again.' });
    logger.error(`API request failed: ${error.code || error.name || 'unknown error'}`);
    res.status(503).json({ message: 'The service is unavailable. Please try again.' });
  });
  return app;
}
module.exports = { createApp, hashToken, RequestError, publicUser };
