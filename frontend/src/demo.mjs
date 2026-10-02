// Frontend-only simulation. This state is inspectable/editable and is not authentication.
// No requests, database, email delivery, SMS delivery, or production security are provided.
import { COUNTRIES, normalizeEmail, phoneDigits } from './validation.mjs';

export const STORAGE_KEY = 'haven.frontend-demo.v2';
export const DEMO_CREDENTIALS = { email: 'alex.lopez@gmail.com', password: 'HavenDemo!2026' };
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('');
export const countdown = (deadline, now = Date.now()) => {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
export const timeZoneFor = (account) => COUNTRIES[account.country]?.regions[account.region]?.zone || 'Asia/Manila';
export const formatTime = (timestamp, zone) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(timestamp));

// A salted browser-side verifier avoids keeping plaintext passwords in demo storage.
// This does not replace the required server-side Argon2id/bcrypt implementation.
export async function passwordProof(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function makeOtp(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return { code: String(bytes[0] % 1000000).padStart(6, '0'), expiresAt: now + 300000, resendAt: now + 60000, attempts: 0, locked: false };
}

export async function createAccount(values, now = Date.now()) {
  const salt = token();
  return {
    id: crypto.randomUUID(), firstName: values.firstName.trim(), lastName: values.lastName.trim(),
    middleInitial: values.middleInitial.trim(), birthday: values.birthday, email: normalizeEmail(values.email),
    country: values.country, region: values.region, city: values.city, postal: values.postal,
    houseStreet: values.houseStreet.trim(), mobile: phoneDigits(values.mobile), salt,
    passwordProof: await passwordProof(values.password, salt), emailVerified: false, mobileVerified: false,
    emailToken: token(), emailExpiresAt: now + 86400000, failedAttempts: 0, locked: false,
    unlockToken: null, unlockAt: null, otp: null, createdAt: now,
  };
}

export async function initialDemo() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (saved?.version === 2 && Array.isArray(saved.accounts) && saved.accounts.length) return saved;
  } catch { /* Unavailable storage or an old demo is safely replaced. */ }
  const account = await createAccount({ ...DEMO_CREDENTIALS, firstName: 'Alex', lastName: 'Lopez', middleInitial: 'M.', birthday: '06/15/2000', country: 'PH', region: 'Metro Manila', city: 'Makati', postal: '1200', houseStreet: '24 Palm Street', mobile: '9171234567' });
  return { version: 2, accounts: [{ ...account, emailVerified: true, mobileVerified: true }], currentId: null, pendingId: null, settings: { showTime: true }, registrationRequests: [] };
}

export function verifyEmail(account, emailToken, now = Date.now()) {
  if (!account || !emailToken || account.emailToken !== emailToken) return { status: 'invalid' };
  if (now >= account.emailExpiresAt) return { status: 'expired' };
  return { status: 'success', account: { ...account, emailVerified: true, otp: account.otp || makeOtp(now) } };
}

export function verifyOtp(account, code, now = Date.now()) {
  if (!account?.emailVerified || !account.otp) return { status: 'missing' };
  if (account.otp.locked) return { status: 'locked', account };
  if (now >= account.otp.expiresAt) return { status: 'expired', account };
  if (!/^\d{6}$/.test(code)) return { status: 'format', account };
  if (account.otp.code === code) return { status: 'success', account: { ...account, mobileVerified: true } };
  const attempts = account.otp.attempts + 1;
  const locked = attempts >= 3;
  return { status: locked ? 'locked' : 'invalid', account: { ...account, otp: { ...account.otp, attempts, locked } } };
}

export function resendOtp(account, now = Date.now()) {
  if (!account?.otp || account.otp.locked || account.mobileVerified || now < account.otp.resendAt) return null;
  // Resending does not reset the three-attempt budget.
  return { ...account, otp: { ...makeOtp(now), attempts: account.otp.attempts } };
}

export async function attemptLogin(account, password, now = Date.now()) {
  if (!account || account.locked) return { status: 'invalid', account };
  if (await passwordProof(password, account.salt) !== account.passwordProof) {
    const failedAttempts = account.failedAttempts + 1;
    const locked = failedAttempts >= 3;
    return { status: 'invalid', account: { ...account, failedAttempts, locked, unlockToken: locked ? token() : null, unlockAt: locked ? now + 120000 : null } };
  }
  if (!account.emailVerified) return { status: 'email', account };
  if (!account.mobileVerified) return { status: 'mobile', account };
  return { status: 'success', account: { ...account, failedAttempts: 0 } };
}

export function unlockAccount(account, unlockToken, now = Date.now()) {
  if (!account?.locked || !unlockToken || unlockToken !== account.unlockToken) return { status: 'invalid' };
  if (now < account.unlockAt) return { status: 'waiting' };
  return { status: 'success', account: { ...account, locked: false, failedAttempts: 0, unlockToken: null, unlockAt: null } };
}
