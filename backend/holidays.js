const crypto = require('crypto');

class HolidayError extends Error {
  constructor(message = 'Holiday information is temporarily unavailable. Please try again later.', reason = 'holiday_provider_unavailable', status = 502) {
    super(message);
    this.reason = reason;
    this.status = status;
  }
}

const HOLIDAY_SOURCE = 'Nager.Date';
const HOLIDAY_SOURCE_URL = 'https://date.nager.at';

function getHolidayConfiguration(env = process.env) {
  const apiKey = env.CALENDARIFIC_API_KEY?.trim();
  if (apiKey && !/\s|REPLACE|YOUR_API_KEY|placeholder/i.test(apiKey)) {
    return { provider: 'calendarific', apiKey };
  }
  const provider = (env.HOLIDAY_PROVIDER || '').trim().toLowerCase();
  if (provider === 'nager' || provider === 'nager.date') {
    return { provider: 'nager', endpoint: 'https://date.nager.at/api/v3/PublicHolidays' };
  }
  throw new HolidayError('Philippine holiday data is not configured. Please try again later.', 'holiday_not_configured', 503);
}

function holidayDate(value, year) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HolidayError();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number(value.slice(0, 4)) !== year || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HolidayError();
  return value;
}

function normalizeHolidays(rows, year) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new HolidayError();
  const holidays = new Map();
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 255 ||
        !Array.isArray(row.type) || row.type.some(type => typeof type !== 'string') ||
        typeof row.primary_type !== 'string' || typeof row.country?.id !== 'string' || row.country.id.toLowerCase() !== 'ph') throw new HolidayError();
    const primaryType = row.primary_type.trim();
    if (row.locations !== 'All' || row.states !== 'All') continue;
    // The provider's classification is authoritative. Never call a working holiday
    // or a religious observance a regular / special non-working public holiday.
    const special = /special\s+(?:non[- ]?working|nonworking)/i.test(primaryType);
    const regular = /regular\s+holiday/i.test(primaryType);
    if (!regular && !special) {
      if (/special\s+working|observance|optional|season/i.test(primaryType) || !row.type.some(type => /national\s+holiday/i.test(type))) continue;
      throw new HolidayError('The holiday provider did not supply Philippine holiday classifications. Please try again later.', 'holiday_classification_unavailable');
    }
    const date = holidayDate(row.date?.iso, year);
    const islamic = row.type.some(type => /muslim|islamic/i.test(type)) || /\beid\b|\beidul\b|\beid['’ -]?l\b/i.test(row.name);
    const categories = [regular ? 'regular' : 'special', ...(islamic ? ['islamic'] : [])];
    const name = row.name.trim();
    const id = crypto.createHash('sha256').update(`${date}:${name.toLowerCase()}`).digest('hex').slice(0, 24);
    holidays.set(id, { id, name, date, categories, type: primaryType,
      description: typeof row.description === 'string' ? row.description.slice(0, 2000) : '' });
  }
  return [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function normalizeNagerHolidays(rows, year) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new HolidayError();
  const holidays = new Map();
  for (const row of rows) {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 255 ||
        typeof row.countryCode !== 'string' || row.countryCode.toUpperCase() !== 'PH') throw new HolidayError();
    const date = holidayDate(row.date, year);
    const name = row.name.trim();
    const localName = typeof row.localName === 'string' ? row.localName.trim() : '';
    const combined = `${name} ${localName}`.toLowerCase();
    const isIslamic = /\beid\b|\beidul\b|\beid['’ -]?l\b|ramadhan|ramadan|sacrifice/i.test(combined);
    // Official Philippine Regular Holidays (RA 9492 / Presidential Proclamations)
    const isRegular = /new year's day|maundy thursday|good friday|day of valor|kagitingan|labour day|labor day|paggawa|independence day|kalayaan|national heroes|bayani|bonifacio|christmas day|pasko|rizal day|ramadhan|sacrifice/i.test(combined);
    const categories = [isRegular ? 'regular' : 'special', ...(isIslamic ? ['islamic'] : [])];
    const primaryType = isRegular ? 'Regular Holiday' : 'Special Non-Working Holiday';
    const id = crypto.createHash('sha256').update(`${date}:${name.toLowerCase()}`).digest('hex').slice(0, 24);
    holidays.set(id, {
      id,
      name,
      date,
      categories,
      type: primaryType,
      description: localName ? `${localName} · Official Philippine public holiday` : 'Official Philippine public holiday'
    });
  }
  return [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

async function fetchHolidays(year, { env = process.env, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(year) || year < 2020 || year > 2027) throw new HolidayError('Choose a year from 2020 to 2027.', 'invalid_year', 400);
  const config = getHolidayConfiguration(env);
  if (config.provider === 'calendarific') {
    const url = new URL('https://calendarific.com/api/v2/holidays');
    url.search = new URLSearchParams({ api_key: config.apiKey, country: 'PH', year: String(year), type: 'national' });
    try {
      // Fetch on every year selection. Holiday records are never stored locally.
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok || data?.meta?.code !== 200) {
        const code = response.ok ? data?.meta?.code : response.status;
        if ([401, 403].includes(code)) throw new HolidayError('The holiday service could not authenticate. Please contact support.', 'holiday_invalid_credentials', 503);
        if (code === 429) throw new HolidayError('The holiday service has reached its request limit. Please try again later.', 'holiday_provider_rate_limit', 503);
        throw new HolidayError();
      }
      return normalizeHolidays(data.response?.holidays, year);
    } catch (error) {
      if (error instanceof HolidayError) throw error;
      throw new HolidayError();
    }
  }
  if (config.provider === 'nager') {
    const url = new URL(`https://date.nager.at/api/v3/PublicHolidays/${year}/PH`);
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        if (response.status === 404) return [];
        if (response.status === 429) throw new HolidayError('The holiday service has reached its request limit. Please try again later.', 'holiday_provider_rate_limit', 503);
        throw new HolidayError();
      }
      const data = await response.json();
      if (!Array.isArray(data)) throw new HolidayError();
      return normalizeNagerHolidays(data, year);
    } catch (error) {
      if (error instanceof HolidayError) throw error;
      throw new HolidayError();
    }
  }
  throw new HolidayError('Philippine holiday data is not configured. Please try again later.', 'holiday_not_configured', 503);
}

module.exports = { fetchHolidays, getHolidayConfiguration, normalizeHolidays, normalizeNagerHolidays, HolidayError, HOLIDAY_SOURCE, HOLIDAY_SOURCE_URL };
