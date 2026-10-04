const express = require('express');
const crypto = require('crypto');
const path = require('path');
const email = require('./email');
const sms = require('./sms');
const { Store, hashToken } = require('./store');
const { security, hashPassword, comparePassword } = require('./auth');
const { fetchHolidays, HolidayError } = require('./holidays');
const addresses = require('./addresses');
const validation = import('../frontend/src/validation.mjs');

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
const publicOtp = mobile => mobile ? { sent: Boolean(mobile.provider_id), expiresAt: timestamp(mobile.expires_at),
  resendAt: timestamp(mobile.resend_at), attemptsRemaining: Math.max(0, 3 - mobile.attempts), locked: Boolean(mobile.is_locked) } : null;

function createApp({ db, store = new Store(db), emailService = email, smsService = sms, now = Date.now,
  env = process.env, logger = console, holidayService = fetchHolidays } = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  const auth = security(app, { env, store, now });
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
      await emailService[kind]({ to: user.email, firstName: user.first_name, ...token });
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
      smsService.getSmsConfiguration();
      const result = await smsService.createVerification({ to: user.mobile_number });
      const sentAt = now();
      const providerExpiry = timestamp(result.expiresAt);
      const mobile = { provider_id: result.id, expires_at: new Date(Math.min(sentAt + 300000, providerExpiry || Infinity)),
        resend_at: new Date(sentAt + 60000), attempts: saved?.attempts || 0, is_locked: false };
      await tx.saveMobile(user.id, mobile);
      return { message: 'A six-digit verification code has been requested by SMS.', otp: publicOtp(mobile) };
    });
  }
  app.get('/api/health', async (req, res) => {
    if (db) await db.query('SELECT 1');
    let emailConfigured = true, smsConfigured = true;
    try { emailService.getEmailConfiguration(); } catch { emailConfigured = false; }
    try { smsService.getSmsConfiguration(); } catch { smsConfigured = false; }
    res.json({ status: 'ok', emailConfigured, smsConfigured });
  });
  app.get('/api/session', async (req, res) => {
    const session = await auth.session(req);
    const user = session && await store.user(session.user_id);
    if (!user || user.is_locked) return res.json({ user: null, pending: null });
    const verified = user.email_verified_at && user.mobile_verified;
    return res.json(session.type === 'authenticated' && verified ? { user: publicUser(user), pending: null }
      : { user: null, pending: { ...publicUser(user), otp: publicOtp(await store.mobile(user.id)) } });
  });
  app.get('/api/addresses/countries', (req, res) => res.json(addresses.countries));
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
  app.post('/api/register', limit('register-submit', 60, 60000), async (req, res) => {
    const values = req.body;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(value => typeof value !== 'string') || 'password_hash' in values) {
      throw new RequestError(400, 'Submit valid registration fields and a password.');
    }
    const rules = await validation;
    const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now()));
    const part = name => Number(todayParts.find(item => item.type === name).value);
    const postalChoices = await addresses.getPostalChoices(values.country, values.region, values.city);
    const errors = rules.validateRegistration(values, new Date(part('year'), part('month') - 1, part('day')), { postalMode: postalChoices.mode, postalCodes: postalChoices.options });
    if (!errors.country && !errors.region && !errors.city && !errors.postal) Object.assign(errors, await addresses.validateAddress(values));
    if (Object.keys(errors).length) throw new RequestError(400, 'Please correct the highlighted fields.', { errors });
    emailService.getEmailConfiguration();
    smsService.getSmsConfiguration();
    const passwordHash = await hashPassword(values.password);
    const to = rules.normalizeEmail(values.email);
    const [month, day, year] = values.birthday.split('/');
    const user = { id: crypto.randomUUID(), first_name: values.firstName.trim(), last_name: values.lastName.trim(),
      middle_initial: values.middleInitial || null, birthday: `${year}-${month}-${day}`, password_hash: passwordHash,
      email: to, mobile_number: rules.internationalMobileNumber(values.mobile, values.country) };
    const token = await store.transaction(async tx => {
      if (await tx.userByEmail(to, true)) throw new RequestError(409, 'This email is already registered.', { errors: { email: 'This email is already registered. Sign in to continue.' } });
      // Commit the hourly quota with the account, so rejected or rolled-back requests do not use a slot.
      const retry = await tx.consumeRate(`register:${req.ip}`, 5, 3600000, now());
      if (retry) {
        const minutes = Math.ceil(retry / 60);
        throw new RequestError(429, `Five accounts have already been created from this network within an hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`, { retryAfter: retry });
      }
      await tx.insertUser(user, { id: crypto.randomUUID(), user_id: user.id, house_street: values.houseStreet.trim(),
        country: values.country, city: values.city, state: values.region, zip_code: values.postal });
      const token = await tx.replaceToken(user.id, 'email_verify', now());
      await auth.issue(req, res, tx, user.id, 'verification');
      return token;
    });
    const submitted = await submitEmail('sendVerificationEmail', user, token);
    res.status(201).json({ email_submitted: submitted, email_verification_required: true,
      message: submitted ? 'Account created. Check your inbox to verify your email.' : 'Account created, but the email service could not accept the verification email. Use Resend verification email to try again.' });
  });
  app.post('/api/resend-verification', limit('email-send', 10, 3600000), async (req, res) => {
    const user = await account(req);
    if (user.email_verified_at) throw new RequestError(400, 'Your email is already verified.');
    emailService.getEmailConfiguration();
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
    if (req.body?.direct) {
      const user = await account(req);
      if (user.is_locked) throw new RequestError(403, 'This account is locked.');
      if (!user.email_verified_at) {
        await store.transaction(async tx => {
          await tx.updateUser(user.id, { email_verified_at: new Date(now()), updated_at: new Date(now()) });
          await tx.deleteTokens(user.id, 'email_verify');
          await auth.issue(req, res, tx, user.id, 'verification');
        });
      }
      let otp, smsSubmitted = false;
      try { const result = await sendOtp(user.id); otp = result.otp; smsSubmitted = true; }
      catch (error) { logger.error(error.diagnostic || 'Email verified; mobile delivery requires a retry.'); }
      return res.json({ message: smsSubmitted ? 'Email verified. Check your phone for the SMS code.' : 'Email verified. Request an SMS code on the next screen.', email_verified: true, sms_submitted: smsSubmitted, otp });
    }
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
  app.post(['/api/send-mobile-otp', '/api/resend-mobile-otp'], limit('sms-send', 10, 3600000), async (req, res) => {
    const user = await account(req);
    res.json(await sendOtp(user.id));
  });
  app.post('/api/verify-mobile', limit('sms-check', 30, 60000), async (req, res) => {
    const user = await account(req);
    if (req.body?.direct) {
      const result = await store.transaction(async tx => {
        const current = await tx.user(user.id, true);
        if (!current.email_verified_at || current.is_locked) throw new RequestError(403, 'Verify your email first.');
        if (current.mobile_verified) return { mobile_verified: true, message: 'Mobile already verified.' };
        await tx.updateUser(user.id, { mobile_verified: 1, updated_at: new Date(now()) });
        const saved = await tx.mobile(user.id);
        if (saved) await tx.saveMobile(user.id, { ...saved, provider_id: null, expires_at: null });
        await auth.logout(req, res, tx);
        return { mobile_verified: true, message: 'Mobile verified. Sign in to continue.' };
      });
      return res.json(result);
    }
    if (typeof req.body?.code !== 'string' || !/^\d{6}$/.test(req.body.code)) throw new RequestError(400, 'Enter the six-digit code from your SMS.');
    const result = await store.transaction(async tx => {
      const current = await tx.user(user.id, true);
      if (!current.email_verified_at || current.is_locked) throw new RequestError(403, 'Verify your email first.');
      if (current.mobile_verified) return { mobile_verified: true };
      const saved = await tx.mobile(user.id);
      if (saved?.is_locked) throw new RequestError(423, 'Mobile verification is locked. Contact support.', { reason: 'attempts_exhausted', otp: publicOtp(saved) });
      if (!saved?.provider_id || timestamp(saved.expires_at) <= now()) throw new RequestError(410, 'Your code has expired. Request another SMS code.', { reason: 'expired', otp: publicOtp(saved) });
      const checked = await smsService.checkVerification({ to: current.mobile_number, code: req.body.code, id: saved.provider_id });
      // Bind the provider result to this account's current challenge, including after a resend.
      if (checked.success && checked.verification?.id === saved.provider_id) {
        await tx.updateUser(user.id, { mobile_verified: 1, updated_at: new Date(now()) });
        await tx.saveMobile(user.id, { ...saved, provider_id: null, expires_at: null });
        await auth.logout(req, res, tx);
        return { mobile_verified: true, message: 'Mobile verified. Sign in to continue.' };
      }
      if (['expired', 'not_found'].includes(checked.reason)) {
        await tx.saveMobile(user.id, { ...saved, expires_at: new Date(now()) });
        return { status: 410, message: 'Your code has expired. Request another SMS code.', reason: 'expired', otp: publicOtp({ ...saved, expires_at: new Date(now()) }) };
      }
      const attempts = checked.reason === 'attempts_exhausted' ? 3 : saved.attempts + 1;
      const next = { ...saved, attempts, is_locked: attempts >= 3 };
      await tx.saveMobile(user.id, next);
      return { status: attempts >= 3 ? 423 : 400, message: attempts >= 3 ? 'Mobile verification is locked after three incorrect attempts. Contact support.' : 'Incorrect code. Please try again.',
        reason: attempts >= 3 ? 'attempts_exhausted' : 'incorrect_code', otp: publicOtp(next) };
    });
    const { status = 200, ...data } = result;
    res.status(status).json(data);
  });
  app.post('/api/login', limit('login', 60, 3600000), async (req, res) => {
    const { email: identifier, password } = req.body || {};
    if (!email.isEmail(identifier) || typeof password !== 'string' || !password || Buffer.byteLength(password) > 72) throw new RequestError(401, 'Invalid email or password.');
    const result = await store.transaction(async tx => {
      const user = await tx.userByEmail(identifier.trim().toLowerCase(), true);
      const matches = await comparePassword(password, user?.password_hash);
      if (!user || user.is_locked) return { invalid: true };
      if (!matches) {
        const attempts = user.failed_login_attempts + 1;
        await tx.updateUser(user.id, { failed_login_attempts: attempts, is_locked: attempts >= 3 ? 1 : 0,
          lockout_until: attempts >= 3 ? new Date(now() + 120000) : null, updated_at: new Date(now()) });
        if (attempts >= 3) {
          await tx.deleteUserSessions(user.id);
          return { invalid: true, lockedUser: user, unlock: await tx.replaceToken(user.id, 'account_unlock', now()) };
        }
        return { invalid: true };
      }
      await tx.updateUser(user.id, { failed_login_attempts: 0, updated_at: new Date(now()) });
      const verified = user.email_verified_at && user.mobile_verified;
      await auth.issue(req, res, tx, user.id, verified ? 'authenticated' : 'verification');
      return { next: verified ? '/dashboard' : user.email_verified_at ? '/verify-mobile' : '/verify-email' };
    });
    if (result.unlock) await submitEmail('sendUnlockEmail', result.lockedUser, result.unlock);
    if (result.invalid) throw new RequestError(401, 'Invalid email or password.');
    res.json({ next: result.next });
  });
  app.post('/api/logout', async (req, res) => { await auth.logout(req, res); res.json({ message: 'Signed out.' }); });
  app.post('/api/request-unlock', limit('unlock-mail', 5, 3600000), async (req, res) => {
    if (!email.isEmail(req.body?.email)) throw new RequestError(400, 'Enter a valid email address.');
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
    res.json({ holidays: await holidayService(Number(req.params.year), { env }), source: env.CALENDARIFIC_API_KEY ? 'Calendarific' : 'Nager.Date' });
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
      return res.status(503).json({ message: error.message });
    }
    if (error instanceof email.EmailConfigurationError) return res.status(503).json({ message: error.message });
    if (error instanceof sms.SmsBillingError) {
      logger.error(error.diagnostic);
      return res.status(503).json({ message: error.message });
    }
    if (error instanceof sms.SmsDeliveryError) {
      logger.error(error.diagnostic || error.message);
      return res.status(502).json({ message: error.message });
    }
    if (error instanceof HolidayError) return res.status(502).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'This email is already registered.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Submit valid JSON.' });
    logger.error(`API request failed: ${error.code || error.name || 'unknown error'}`);
    res.status(503).json({ message: 'The service is unavailable. Please try again.' });
  });
  return app;
}
module.exports = { createApp, hashToken, RequestError, publicUser };
