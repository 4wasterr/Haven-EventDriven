const directory = require('@countrystatecity/countries');
const postal = require('@countrystatecity/postalcodes');
const countries = require('../frontend/src/data/countries.json');
const usPostal = require('./data/us-postal.json');
const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\bcity\b|\bmunicipality\b|[^\p{L}\p{N}]/gu, '').replace(/city$/, '');
const cache = new Map();
function cached(key, work) {
  if (!cache.has(key)) cache.set(key, Promise.resolve().then(work).catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
}
const metroCities = ['Caloocan City', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila', 'Marikina',
  'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig', 'Pateros', 'Quezon City', 'San Juan', 'Taguig', 'Valenzuela'];
// Match actual directory records to the city, including named postal areas.
const metroRanges = { CaloocanCity: [[1400, 1413], [1420, 1428]], LasPinas: [[1740, 1752]], Makati: [[1200, 1235]],
  Malabon: [[1470, 1480]], Mandaluyong: [[1550, 1556]], Manila: [[1000, 1018]], Marikina: [[1800, 1811]],
  Muntinlupa: [[1770, 1781]], Navotas: [[1485, 1490]], Paranaque: [[1700, 1720]], Pasay: [[1300, 1309]],
  Pasig: [[1600, 1612]], Pateros: [[1620, 1621]], QuezonCity: [[1100, 1128]], SanJuan: [[1500, 1504]],
  Taguig: [[1630, 1639]], Valenzuela: [[1440, 1448]] };
const regionInfo = (country, region) => Object.hasOwn(countries, country) && Object.hasOwn(countries[country].regions, region) ? countries[country].regions[region] : undefined;

async function getCities(country, region) {
  if (!regionInfo(country, region)) return [];
  return cached(`cities:${country}:${region}`, async () => {
    if (country === 'PH' && region === 'Metro Manila') return metroCities.map(name => ({ name }));
    const code = regionInfo(country, region).code;
    const rows = code ? await directory.getCitiesOfState(country, code) : await directory.getAllCitiesOfCountry(country);
    const names = rows.map(row => row.name);
    // Retain the existing UK nation selections alongside the complete county/borough list.
    if (country === 'GB' && region === 'England') names.push('London', 'Manchester');
    if (country === 'GB' && region === 'Scotland') names.push('Edinburgh', 'Glasgow');
    if (!names.length && countries[country].capital && !code) names.push(countries[country].capital);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'en')).map(name => ({ name }));
  });
}

async function getPostalChoices(country, region, city) {
  const meta = countries[country];
  if (!meta || !regionInfo(country, region)) return { mode: 'input', options: [] };
  const selected = (await getCities(country, region)).find(row => normalize(row.name) === normalize(city));
  if (!selected) return { mode: 'input', options: [], invalidCity: true };
  city = selected.name;
  if (!meta.postalApplicable) return { mode: 'none', options: [{ value: 'N/A', label: 'Not used in this country' }] };
  return cached(`postal:${country}:${region}:${city}`, async () => {
    const stateCode = regionInfo(country, region).code;
    const all = country === 'US' ? usPostal.map(row => ({ code: row.code, state_code: row.state, locality_name: row.city, type: 'full' })) : await postal.getAllPostalCodesOfCountry(country);
    const stateRows = all.filter(row => row.state_code === stateCode || !row.state_code);
    let matches = stateRows.filter(row => row.locality_name && normalize(row.locality_name).startsWith(normalize(city)));
    if (country === 'PH' && region === 'Metro Manila') {
      const ranges = Object.entries(metroRanges).find(([name]) => normalize(name) === normalize(city))?.[1] || [];
      matches = stateRows.filter(row => ranges.some(([low, high]) => Number(row.code) >= low && Number(row.code) <= high));
    }
    const full = matches.filter(row => row.type === 'full');
    const grouped = new Map();
    for (const row of full) {
      if (!grouped.has(row.code)) grouped.set(row.code, new Set());
      if (row.locality_name) grouped.get(row.code).add(row.locality_name);
    }
    const options = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([value, names]) => {
      const area = [...names].join(' / ');
      const district = country === 'PH' && normalize(city) === 'caloocan' ? (Number(value) < 1420 ? 'South Caloocan' : 'North Caloocan') : '';
      return { value, label: `${value}${area ? ` — ${area}` : ''}${district ? ` (${district})` : ''}` };
    });
    // Area-only datasets (such as GB) need the full postcode entered, never an area code selected as a complete postcode.
    return { mode: options.length ? 'select' : 'input', options,
      hint: meta.postalExample ? `For example ${meta.postalExample}. Enter the code for your complete address.` : 'Enter the postal code for your complete address.' };
  });
}

async function validateAddress(values) {
  const errors = {}, meta = countries[values.country], region = regionInfo(values.country, values.region);
  if (!meta) return { country: 'Select a country.' };
  if (!region) return { region: 'Select a province or state in the chosen country.' };
  const cities = await getCities(values.country, values.region);
  const selected = cities.find(row => normalize(row.name) === normalize(values.city));
  if (!selected) return { city: 'Select a city or municipality in the chosen province or state.' };
  const choices = await getPostalChoices(values.country, values.region, selected.name);
  const code = String(values.postal || '').trim().toUpperCase();
  if (choices.mode === 'none') {
    if (code !== 'N/A') errors.postal = 'This country does not use postal codes.';
  } else if (choices.mode === 'select') {
    if (!choices.options.some(option => option.value.toUpperCase() === code)) errors.postal = 'Select the postal code for an area in this city.';
  } else if (await postal.isCountrySupported(values.country)) {
    const records = await postal.getAllPostalCodesOfCountry(values.country);
    const lookup = values.country === 'US' ? code.slice(0, 5) : code;
    const matches = records.filter(row => row.type === 'area' ? lookup.startsWith(row.code.toUpperCase()) : row.code.toUpperCase() === lookup);
    if (!matches.length) errors.postal = 'This postal code is not in the selected country’s directory.';
    else if (matches.every(row => row.state_code && row.state_code !== region.code) && values.country !== 'GB') {
      errors.postal = 'This postal code belongs to a different province or state.';
    }
  }
  return errors;
}

module.exports = { getCities, getPostalChoices, validateAddress, countries };
