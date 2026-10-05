const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { fetchHolidays, HolidayError } = require('./holidays');

async function main() {
  const year = Number(process.argv[2] || new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()));
  try {
    const rows = await fetchHolidays(year);
    console.log(`Calendarific reachable: ${rows.length} Philippine public holidays for ${year}.`);
    for (const category of ['regular', 'special', 'islamic']) console.log(`${category}: ${rows.filter(row => row.categories.includes(category)).length}`);
  } catch (error) {
    console.error(error instanceof HolidayError && error.reason === 'holiday_not_configured' ?
      'Set CALENDARIFIC_API_KEY in backend/.env and restart the backend.' : error instanceof HolidayError ? error.message : 'The holiday check failed.');
    process.exitCode = 1;
  }
}
main();
