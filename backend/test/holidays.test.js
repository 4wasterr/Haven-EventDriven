const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchHolidays, HolidayError } = require('../holidays');

test('Nager.Date is fetched for the requested year and provider names classify holidays', async () => {
  let requested;
  const holidays = await fetchHolidays(2024, { env: {}, fetchImpl: async url => {
    requested = url.href;
    return Response.json([
      { date: '2024-03-30', name: 'Holy Saturday', types: ['Public'] },
      { date: '2024-01-01', name: "New Year's Day", types: ['Public'] },
      { date: '2024-04-10', name: 'Eid al-Fitr', types: ['Public'] }
    ]);
  } });
  assert.equal(requested, 'https://date.nager.at/api/v3/PublicHolidays/2024/PH');
  assert.deepEqual(holidays.map(item => item.categories), [['regular'], ['special'], ['regular','islamic']]);
});
test('Calendarific credentials stay server-side and non-national observances are excluded', async () => {
  const holidays = await fetchHolidays(2027, { env: { CALENDARIFIC_API_KEY: 'test-only-key' }, fetchImpl: async url => {
    assert.equal(url.searchParams.get('country'), 'PH'); assert.equal(url.searchParams.get('year'), '2027'); assert.equal(url.searchParams.get('api_key'), 'test-only-key');
    return Response.json({ response: { holidays: [
      { name: 'Eid al-Adha', date: { iso: '2027-05-17' }, type: ['National holiday'], description: 'National holiday' },
      { name: 'Equinox', date: { iso: '2027-03-20' }, type: ['Season'] }
    ] } });
  } });
  assert.equal(holidays.length, 1); assert.deepEqual(holidays[0].categories, ['regular','islamic']); assert.ok(!JSON.stringify(holidays).includes('test-only-key'));
});
test('provider failures and missing datasets do not fall back to hardcoded holidays', async () => {
  for (const fetchImpl of [async () => new Response(null, { status: 204 }), async () => new Response(null, { status: 503 }), async () => Response.json({ unexpected: true }), async () => { throw new Error('private-url-with-api-key'); }]) {
    await assert.rejects(fetchHolidays(2026, { env: {}, fetchImpl }), error => error instanceof HolidayError && !error.message.includes('private-url'));
  }
});
