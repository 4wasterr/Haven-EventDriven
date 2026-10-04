import countryData from './data/countries.json' with { type: 'json' };
import { parsePhoneNumberFromString, isSupportedCountry } from 'libphonenumber-js/max';
export const COUNTRIES = countryData;

export const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.ph',
  'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com',
]);

export const normalizeEmail = (value = '') => value.trim().toLowerCase();
export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255;
export const phoneDigits = (value = '') => value.replace(/[\s()-]/g, '');
export function internationalMobileNumber(value, countryCode) {
  const country = COUNTRIES[countryCode], digits = phoneDigits(value);
  if (!country || !/^\d+$/.test(digits) || (countryCode === 'PH' && !/^9\d{9}$/.test(digits))) return '';
  const number = parsePhoneNumberFromString(country.prefix + digits);
  if (!number?.isValid() || !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(number.getType())) return '';
  if (isSupportedCountry(countryCode) && number.country && number.country !== countryCode) return '';
  return number.number;
}
export function postalCodeValid(countryCode, value) {
  const country = COUNTRIES[countryCode], code = String(value || '').trim().toUpperCase();
  if (!country) return false;
  if (!country.postalApplicable) return code === 'N/A';
  return country.postalPattern ? new RegExp(`^(?:${country.postalPattern})$`, 'i').test(code) : /^[\p{L}\p{N}][\p{L}\p{N} -]{0,19}$/u.test(code);
}
export const passwordRules = (value = '') => [
  { label: '12 or more characters', valid: value.length >= 12 },
  { label: 'Uppercase letter', valid: /[A-Z]/.test(value) },
  { label: 'Lowercase letter', valid: /[a-z]/.test(value) },
  { label: 'Number', valid: /\d/.test(value) },
  { label: 'Special character', valid: /[^A-Za-z0-9\s]/.test(value) },
];

export function birthdayError(value, now = new Date()) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return 'Use MM/DD/YYYY, for example 06/15/2000.';
  const [month, day, year] = value.split('/').map(Number);
  const birthday = new Date(0);
  birthday.setUTCFullYear(year, month - 1, day);
  if (year < 1 || birthday.getUTCFullYear() !== year || birthday.getUTCMonth() !== month - 1 || birthday.getUTCDate() !== day) return 'Enter a valid calendar date.';
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (birthday > today) return 'Your birthday cannot be in the future.';
  const age = today.getUTCFullYear() - year - ((today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) ? 1 : 0);
  return age < 13 ? 'You must be at least 13 years old to register.' : '';
}

export function validateRegistration(values, now = new Date(), addressChoices) {
  const errors = {};
  for (const key of ['firstName', 'lastName']) {
    const name = (values[key] || '').trim();
    if (name.length < 2 || name.length > 50 || !/^[\p{L} '\u2019-]+$/u.test(name) || !/\p{L}/u.test(name)) errors[key] = 'Use 2–50 letters, spaces, hyphens, or apostrophes.';
  }
  if (values.middleInitial && !/^(?:\p{L}{1,2}|\p{L}\.)$/u.test(values.middleInitial)) errors.middleInitial = 'Use up to two letters, or one letter with a period.';
  const birthday = birthdayError(values.birthday || '', now);
  if (birthday) errors.birthday = birthday;
  const email = normalizeEmail(values.email);
  if (!validEmail(email)) errors.email = 'Enter a valid email address.';
  else if (!PUBLIC_EMAIL_PROVIDERS.has(email.split('@')[1])) errors.email = 'Use a supported public email provider, such as Gmail, Outlook, Yahoo, iCloud, or Proton.';
  const country = COUNTRIES[values.country];
  if (!country) errors.country = 'Select a supported country.';
  if (!internationalMobileNumber(values.mobile, values.country)) errors.mobile = country?.phoneHint || 'Select a country and enter a valid mobile number.';
  const street = (values.houseStreet || '').trim();
  if (!street || street.length > 255 || !/^[\p{L}\p{N}\s.,'\u2019/#()&-]+$/u.test(street) || !/[\p{L}\p{N}]/u.test(street)) errors.houseStreet = 'Enter a house and street using letters, numbers, and standard punctuation (maximum 255 characters).';
  const region = country?.regions[values.region];
  if (!region) errors.region = 'Select a province or state.';
  if (!values.city?.trim() || values.city.length > 100 || (addressChoices?.cities && !addressChoices.cities.some(city => city.name === values.city))) errors.city = 'Select a city in the chosen province or state.';
  const postalValid = addressChoices?.postalMode === 'select' ? addressChoices.postalCodes.some(option => option.value === values.postal) : postalCodeValid(values.country, values.postal);
  if (!postalValid) errors.postal = 'Enter or select a valid postal code for this address.';
  if (!passwordRules(values.password).every((rule) => rule.valid)) errors.password = 'Use at least 12 characters with uppercase, lowercase, a number, and a special character.';
  if (new TextEncoder().encode(values.password || '').length > 72) errors.password = 'Use a password of at most 72 UTF-8 bytes.';
  if (!values.confirmPassword || values.confirmPassword !== values.password) errors.confirmPassword = 'Passwords must match exactly.';
  return errors;
}

export function validateLogin({ email, password }) {
  const errors = {};
  if (!validEmail(normalizeEmail(email))) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

function randomIndex(length) {
  const limit = Math.floor(0x100000000 / length) * length;
  const number = new Uint32Array(1);
  do { crypto.getRandomValues(number); } while (number[0] >= limit);
  return number[0] % length;
}

export function suggestPassword() {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?'];
  const pool = groups.join('');
  const chars = groups.map((group) => group[randomIndex(group.length)]);
  while (chars.length < 16) chars.push(pool[randomIndex(pool.length)]);
  for (let index = chars.length - 1; index > 0; index--) {
    const swap = randomIndex(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join('');
}
