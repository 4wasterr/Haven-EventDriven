class HolidayError extends Error {}
async function fetchHolidays(year, { env = process.env, fetchImpl = fetch } = {}) {
  let url;
  if (env.CALENDARIFIC_API_KEY) {
    url = new URL('https://calendarific.com/api/v2/holidays');
    url.search = new URLSearchParams({ api_key: env.CALENDARIFIC_API_KEY, country: 'PH', year: String(year) }).toString();
  } else {
    url = new URL(`https://date.nager.at/api/v3/PublicHolidays/${year}/PH`);
  }
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
    if (response.status === 204) throw new HolidayError('The holiday provider has no Philippine dataset for this year. Set CALENDARIFIC_API_KEY in the backend to use Calendarific.');
    if (!response.ok) throw new HolidayError('The holiday provider could not return this year. Please try again later.');
    const data = await response.json();
    const entries = env.CALENDARIFIC_API_KEY ? data.response?.holidays : data;
    if (!Array.isArray(entries)) throw new HolidayError('The holiday provider returned an invalid dataset.');
    return entries.filter(item => !env.CALENDARIFIC_API_KEY || item.type?.includes('National holiday')).map((item, index) => {
      const name = item.name;
      const special = /special|non.working/i.test([item.description, ...(item.type || [])].join(' ')) || /chinese new year|lunar new year|holy saturday|black saturday|ninoy|all saints|all souls|immaculate conception|christmas eve|last day|new.year.s eve/i.test(name);
      const islamic = /eid|idul|fitr|adha|islam/i.test(name);
      return { id: `${year}-${index}`, date: item.date?.iso?.slice(0,10) || item.date,
        name, categories: [...(special ? ['special'] : ['regular']), ...(islamic ? ['islamic'] : [])] };
    }).sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    if (error instanceof HolidayError) throw error;
    throw new HolidayError('Could not reach the holiday provider. Please try again later.');
  }
}
module.exports = { fetchHolidays, HolidayError };
