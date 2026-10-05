const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchHolidays, normalizeHolidays, HolidayError } = require('../holidays');
const env = { CALENDARIFIC_API_KEY: 'private-test-key' };
const holiday = (name, iso, primary_type = 'Regular Holiday', extra = {}) => ({
  name, date: { iso }, primary_type, country: { id: 'ph' }, type: ['National holiday'], locations: 'All', states: 'All', ...extra
});

test('Calendarific queries PH over HTTPS for each selected year without storing or inventing records', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json({ meta: { code: 200 }, response: { holidays: [holiday("New Year's Day", `${url.searchParams.get('year')}-01-01`)] } });
  };
  for (const year of [2020, 2026, 2027, 2020]) {
    const rows = await fetchHolidays(year, { env, fetchImpl });
    assert.equal(rows[0].date, `${year}-01-01`);
    assert.ok(!JSON.stringify(rows).includes(env.CALENDARIFIC_API_KEY));
  }
  assert.equal(requests.length, 4);
  for (const { url, options } of requests) {
    assert.equal(url.origin + url.pathname, 'https://calendarific.com/api/v2/holidays');
    assert.equal(url.searchParams.get('country'), 'PH');
    assert.equal(url.searchParams.get('type'), 'national');
    assert.equal(url.searchParams.get('api_key'), env.CALENDARIFIC_API_KEY);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('provider types distinguish regular, special non-working and Islamic holidays and exclude working/local/observance days', () => {
  const rows = normalizeHolidays([
    holiday("All Saints' Day", '2026-11-01', 'Special Non-working Holiday'),
    holiday('Eid al-Fitr', '2026-03-20', 'Regular Holiday', { type: ['National holiday', 'Muslim'] }),
    holiday('EDSA Revolution Anniversary', '2026-02-25', 'Special Working Holiday'),
    holiday('Ramadan Start', '2026-02-18', 'Observance'),
    holiday('Regional holiday', '2026-02-01', 'Regular Holiday', { locations: 'Some provinces', states: [{ name: 'Example' }] }),
    holiday("New Year's Day", '2026-01-01'), holiday("New Year's Day", '2026-01-01')
  ], 2026);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.categories), [['regular'], ['regular', 'islamic'], ['special']]);
  assert.deepEqual(rows.map(row => row.date), ['2026-01-01', '2026-03-20', '2026-11-01']);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
});

test('invalid years and absent keys fail before contacting the holiday provider', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Unexpected call'); };
  for (const year of [2019, 2028, 2026.5, '2026']) await assert.rejects(fetchHolidays(year, { env, fetchImpl }), error => error.reason === 'invalid_year');
  await assert.rejects(fetchHolidays(2026, { env: {}, fetchImpl }), error => error.reason === 'holiday_not_configured' && error.status === 503);
  assert.equal(calls, 0);
});

test('empty responses remain empty; malformed provider records fail instead of presenting bad dates', async () => {
  assert.deepEqual(normalizeHolidays([], 2026), []);
  for (const rows of [null, [holiday('Impossible', '2026-02-30')], [holiday('Other year', '2025-01-01')],
    [holiday('Other country', '2026-01-01', 'Regular Holiday', { country: { id: 'us' } })],
    [holiday('Missing types', '2026-01-01', 'Regular Holiday', { type: undefined })]]) {
    assert.throws(() => normalizeHolidays(rows, 2026), HolidayError);
  }
  assert.throws(() => normalizeHolidays([holiday('Missing legal category', '2026-01-01', 'National holiday')], 2026), error => error.reason === 'holiday_classification_unavailable');
  await assert.rejects(fetchHolidays(2026, { env, fetchImpl: async () => Response.json({ meta: { code: 200 }, response: {} }) }), HolidayError);
});

test('holiday auth, quotas, malformed JSON and network failures never expose the key or raw provider errors', async () => {
  for (const [status, reason] of [[401, 'holiday_invalid_credentials'], [403, 'holiday_invalid_credentials'], [429, 'holiday_provider_rate_limit'], [500, 'holiday_provider_unavailable']]) {
    await assert.rejects(fetchHolidays(2026, { env, fetchImpl: async () => Response.json({ error: env.CALENDARIFIC_API_KEY }, { status }) }), error =>
      error instanceof HolidayError && error.reason === reason && !error.message.includes(env.CALENDARIFIC_API_KEY));
  }
  for (const fetchImpl of [async () => { throw new Error(env.CALENDARIFIC_API_KEY); }, async () => new Response('<html>error</html>')]) {
    await assert.rejects(fetchHolidays(2026, { env, fetchImpl }), error => error instanceof HolidayError && !error.message.includes(env.CALENDARIFIC_API_KEY));
  }
});
