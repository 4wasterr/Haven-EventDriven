const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const OTP_TTL = 5 * 60 * 1000;
const OTP_RESEND_DELAY = 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

// Bind the salted verifier to the account and its registered mobile number.
async function hashOtp(code, account) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(code, `${salt}:${account.id}:${account.mobile_number}`, 32);
  return `${salt}:${hash.toString('hex')}`;
}

async function matchesOtp(code, savedHash, account) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(savedHash || '')) return false;
  const [salt, hash] = savedHash.split(':');
  const actual = await scrypt(code, `${salt}:${account.id}:${account.mobile_number}`, 32);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

module.exports = { generateOtp, hashOtp, matchesOtp, OTP_TTL, OTP_RESEND_DELAY, OTP_MAX_ATTEMPTS };
