import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayError, passwordRules, suggestPassword, validateLogin, validateRegistration } from './validation.mjs';
import { attemptLogin, countdown, createAccount, makeOtp, resendOtp, unlockAccount, verifyEmail, verifyOtp } from './demo.mjs';
import { YEARS, calendarCells, previewHolidays } from './holiday-preview.mjs';

const today = new Date(2026, 9, 2);
const valid = {
  firstName: 'Anne-Marie', lastName: "O'Neil", middleInitial: 'M.', birthday: '10/02/2013',
  email: 'sample@gmail.com', country: 'PH', region: 'Metro Manila', city: 'Makati', postal: '1200',
  houseStreet: '24 Palm Street, Unit #2', mobile: '917 123 4567', password: 'GoodPassword!2026', confirmPassword: 'GoodPassword!2026',
};

test('birthday uses a strict text format and the actual thirteenth birthday', () => {
  assert.equal(birthdayError('10/02/2013', today), '');
  assert.match(birthdayError('10/03/2013', today), /13/);
  assert.match(birthdayError('10/02/2027', today), /future/);
  for (const date of ['2/01/2000', '02/30/2000', '02/29/2001', '13/01/2000', '00/15/2000', '01/00/2000', '2000-01-01']) assert.notEqual(birthdayError(date, today), '', date);
  assert.equal(birthdayError('02/29/2000', today), '');
  assert.equal(birthdayError('01/01/1899', today), '');
});

test('registration validates names, initials, public provider, and exact password confirmation', () => {
  assert.deepEqual(validateRegistration(valid, today), {});
  for (const firstName of ['A', 'A'.repeat(51), 'Alex2', '---']) assert.ok(validateRegistration({ ...valid, firstName }, today).firstName);
  assert.deepEqual(validateRegistration({ ...valid, firstName: 'José', middleInitial: 'AB' }, today), {});
  assert.ok(validateRegistration({ ...valid, middleInitial: 'AB.' }, today).middleInitial);
  assert.ok(validateRegistration({ ...valid, email: 'employee@company.com' }, today).email);
  assert.ok(validateRegistration({ ...valid, password: 'short!', confirmPassword: 'short!' }, today).password);
  assert.ok(validateRegistration({ ...valid, confirmPassword: 'goodPassword!2026' }, today).confirmPassword);
});

test('country, province, city, postal code, and mobile number must agree', () => {
  assert.ok(validateRegistration({ ...valid, country: 'unknown' }, today).country);
  assert.ok(validateRegistration({ ...valid, mobile: '09171234567' }, today).mobile);
  assert.ok(validateRegistration({ ...valid, postal: '1100' }, today).postal);
  assert.ok(validateRegistration({ ...valid, city: 'Cebu City' }, today).city);
  assert.deepEqual(validateRegistration({ ...valid, country: 'US', region: 'California', city: 'San Francisco', postal: '94102', mobile: '4155550123' }, today), {});
  assert.deepEqual(validateRegistration({ ...valid, country: 'GB', region: 'England', city: 'London', postal: 'SW1A 1AA', mobile: '7400123456' }, today), {});
  assert.ok(validateRegistration({ ...valid, houseStreet: '<script>' }, today).houseStreet);
});

test('every generated password has all five required properties', () => {
  const passwords = new Set();
  for (let index = 0; index < 100; index++) {
    const password = suggestPassword(); passwords.add(password);
    assert.equal(password.length, 16);
    assert.ok(passwordRules(password).every((rule) => rule.valid));
  }
  assert.equal(passwords.size, 100);
});

test('login checks presence without reusing registration password-composition rules', () => {
  assert.deepEqual(validateLogin({ email: 'any@company.com', password: 'x' }), {});
  assert.ok(validateLogin({ email: 'bad', password: '' }).email);
  assert.ok(validateLogin({ email: 'good@gmail.com', password: '' }).password);
});

test('demo account creation never retains the entered plaintext password', async () => {
  const account = await createAccount(valid, 1000);
  assert.equal(account.emailVerified, false);
  assert.equal(account.emailExpiresAt, 86401000);
  assert.equal(account.password, undefined);
  assert.equal(account.confirmPassword, undefined);
  assert.ok(!JSON.stringify(account).includes(valid.password));
});

test('email links distinguish invalid, expired, and success; revisiting does not reset OTP timers', async () => {
  const account = await createAccount(valid, 1000);
  assert.equal(verifyEmail(account, 'wrong', 1001).status, 'invalid');
  assert.equal(verifyEmail(account, account.emailToken, account.emailExpiresAt).status, 'expired');
  const result = verifyEmail(account, account.emailToken, 2000);
  assert.equal(result.status, 'success'); assert.equal(result.account.emailVerified, true);
  assert.equal(result.account.otp.expiresAt, 302000); assert.equal(result.account.otp.resendAt, 62000);
  assert.deepEqual(verifyEmail(result.account, account.emailToken, 3000).account.otp, result.account.otp);
});

test('OTP expiry, six-digit format, resend cooldown, and three-attempt lockout are independent', () => {
  let account = { emailVerified: true, mobileVerified: false, otp: { ...makeOtp(1000), code: '123456' } };
  assert.equal(verifyOtp(account, '12345', 2000).status, 'format');
  assert.equal(verifyOtp(account, 'abcdef', 2000).status, 'format');
  assert.equal(verifyOtp(account, '123456', 301000).status, 'expired');
  assert.equal(resendOtp(account, 60999), null);
  const resend = resendOtp(account, 61000);
  assert.equal(resend.otp.expiresAt, 361000); assert.equal(resend.otp.resendAt, 121000);
  account = verifyOtp(account, '000000', 2000).account;
  assert.equal(account.otp.attempts, 1);
  assert.equal(resendOtp(account, 61000).otp.attempts, 1);
  account = verifyOtp(account, '000000', 2000).account;
  const locked = verifyOtp(account, '000000', 2000);
  assert.equal(locked.status, 'locked'); assert.equal(locked.account.otp.attempts, 3);
  assert.equal(verifyOtp(locked.account, '123456', 2001).status, 'locked');
  assert.equal(resendOtp(locked.account, 61000), null);
  assert.equal(verifyOtp({ emailVerified: true, otp: { ...makeOtp(1000), code: '000001' } }, '000001', 2000).status, 'success');
});

test('three failed demo logins require an unlock link after two minutes; time alone never unlocks', async () => {
  let account = { ...await createAccount(valid, 1000), emailVerified: true, mobileVerified: true };
  account = (await attemptLogin(account, 'wrong', 2000)).account;
  assert.equal(account.failedAttempts, 1);
  const success = await attemptLogin(account, valid.password, 2001);
  assert.equal(success.status, 'success'); assert.equal(success.account.failedAttempts, 0);
  account = success.account;
  for (let index = 0; index < 3; index++) account = (await attemptLogin(account, 'wrong', 3000)).account;
  assert.equal(account.locked, true); assert.equal(account.unlockAt, 123000);
  assert.equal((await attemptLogin(account, valid.password, 123001)).status, 'invalid');
  assert.equal(unlockAccount(account, 'wrong', 123001).status, 'invalid');
  assert.equal(unlockAccount(account, account.unlockToken, 122999).status, 'waiting');
  const unlocked = unlockAccount(account, account.unlockToken, 123000);
  assert.equal(unlocked.status, 'success'); assert.equal(unlocked.account.locked, false);
  assert.equal(unlocked.account.failedAttempts, 0); assert.equal(unlocked.account.unlockToken, null);
  assert.equal((await attemptLogin(unlocked.account, valid.password, 123001)).status, 'success');
});

test('unverified demo accounts cannot enter the landing screen', async () => {
  const account = await createAccount(valid, 1000);
  assert.equal((await attemptLogin(account, valid.password)).status, 'email');
  assert.equal((await attemptLogin({ ...account, emailVerified: true }, valid.password)).status, 'mobile');
});

test('calendar covers all eight years, real month layouts, and Islamic entries without invented dates', () => {
  assert.deepEqual(YEARS, [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
  for (const year of YEARS) for (let month = 0; month < 12; month++) {
    const cells = calendarCells(year, month);
    assert.equal(cells.length % 7, 0);
    assert.equal(cells.filter(Boolean).length, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    assert.equal(cells.indexOf(`${year}-${String(month + 1).padStart(2, '0')}-01`), new Date(Date.UTC(year, month, 1)).getUTCDay());
  }
  assert.ok(previewHolidays(2027).filter((entry) => entry.date).every((entry) => entry.date.startsWith('2027-')));
  const islamic = previewHolidays(2026).filter((entry) => entry.categories.includes('islamic'));
  assert.equal(islamic.length, 2); assert.ok(islamic.every((entry) => entry.date === null && entry.categories.includes('regular')));
  assert.equal(countdown(61000, 1000), '01:00'); assert.equal(countdown(1000, 2000), '00:00');
});
