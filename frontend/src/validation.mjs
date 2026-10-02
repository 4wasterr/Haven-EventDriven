// These are supported dropdown choices, not a live address-verification service.
export const COUNTRIES = {
  PH: { name: 'Philippines', prefix: '+63', phone: /^9\d{9}$/, phoneHint: '10 digits beginning with 9, without the leading 0.', postal: /^\d{4}$/, regions: {
    'Metro Manila': { zone: 'Asia/Manila', cities: { Manila: ['1000', '1004', '1008'], 'Quezon City': ['1100', '1101', '1104'], Makati: ['1200', '1210'], Pasig: ['1600', '1605'], Taguig: ['1630', '1634'] } },
    Cebu: { zone: 'Asia/Manila', cities: { 'Cebu City': ['6000'], Mandaue: ['6014'], 'Lapu-Lapu City': ['6015'] } },
    Cavite: { zone: 'Asia/Manila', cities: { Bacoor: ['4102'], Imus: ['4103'], Dasmarinas: ['4114'] } },
    Laguna: { zone: 'Asia/Manila', cities: { Calamba: ['4027'], 'Santa Rosa': ['4026'], 'San Pablo': ['4000'] } },
    'Davao del Sur': { zone: 'Asia/Manila', cities: { 'Davao City': ['8000'], Digos: ['8002'] } },
  } },
  US: { name: 'United States', prefix: '+1', phone: /^[2-9]\d{2}[2-9]\d{6}$/, phoneHint: '10 digits, including the area code.', postal: /^\d{5}(?:-\d{4})?$/, regions: {
    California: { zone: 'America/Los_Angeles', cities: { 'San Francisco': ['94102', '94103'], 'Los Angeles': ['90012', '90013'] } },
    'New York': { zone: 'America/New_York', cities: { 'New York City': ['10001', '10002'], Buffalo: ['14201'] } },
  } },
  GB: { name: 'United Kingdom', prefix: '+44', phone: /^7\d{9}$/, phoneHint: '10 mobile digits beginning with 7, without the leading 0.', postal: /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/, regions: {
    England: { zone: 'Europe/London', cities: { London: ['SW1A 1AA', 'EC1A 1BB'], Manchester: ['M1 1AE'] } },
    Scotland: { zone: 'Europe/London', cities: { Edinburgh: ['EH1 1YZ'], Glasgow: ['G1 1XW'] } },
  } },
};

export const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.ph',
  'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'mail.com',
]);

export const normalizeEmail = (value = '') => value.trim().toLowerCase();
export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255;
export const phoneDigits = (value = '') => value.replace(/[\s()-]/g, '');
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

export function validateRegistration(values, now = new Date()) {
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
  if (!country?.phone.test(phoneDigits(values.mobile))) errors.mobile = country?.phoneHint || 'Select a country and enter a valid mobile number.';
  const street = (values.houseStreet || '').trim();
  if (!street || street.length > 255 || !/^[\p{L}\p{N}\s.,'\u2019/#()&-]+$/u.test(street) || !/[\p{L}\p{N}]/u.test(street)) errors.houseStreet = 'Enter a house and street using letters, numbers, and standard punctuation (maximum 255 characters).';
  const region = country?.regions[values.region];
  if (!region) errors.region = 'Select a province or state.';
  const postcodes = region?.cities[values.city];
  if (!postcodes) errors.city = 'Select a city in the chosen province or state.';
  if (!country?.postal.test(values.postal || '') || !postcodes?.includes(values.postal)) errors.postal = 'Select a supported postal code for this city.';
  if (!passwordRules(values.password).every((rule) => rule.valid)) errors.password = 'Use at least 12 characters with uppercase, lowercase, a number, and a special character.';
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
