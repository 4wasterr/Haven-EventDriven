const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const backendRequire = createRequire(path.join(__dirname, '../backend/package.json'));
const frontendRequire = createRequire(path.join(__dirname, '../frontend/package.json'));
const directory = backendRequire('@countrystatecity/countries');
const { getCountryCallingCode, isSupportedCountry } = frontendRequire('libphonenumber-js/max');

async function main() {
  const countries = await directory.getCountries();
  const output = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < countries.length) {
      const country = countries[cursor++];
      const code = country.iso2;
      const [countryMeta, states, response] = await Promise.all([
        directory.getCountryByCode(code), directory.getStatesOfCountry(code),
        fetch(`https://chromium-i18n.appspot.com/ssl-address/data/${code}`, { signal: AbortSignal.timeout(15000) }),
      ]);
      const meta = countryMeta || country;
      if (!response.ok) throw new Error(`Address metadata unavailable for ${code}: HTTP ${response.status}`);
      const postal = await response.json();
      const regions = {};
      for (const state of states) {
        if (code === 'PH' && state.type !== 'province' && state.iso2 !== '00') continue;
        const name = code === 'PH' && state.iso2 === '00' ? 'Metro Manila' : state.name;
        regions[name] = { code: state.iso2, zone: state.timezone || meta.timezones?.[0]?.zoneName || 'UTC' };
      }
      if (!Object.keys(regions).length) regions['Not applicable'] = { code: '', zone: meta.timezones?.[0]?.zoneName || 'UTC' };
      const phonecode = isSupportedCountry(code) ? getCountryCallingCode(code) : String(meta.phonecode || '').replace(/\D/g, '');
      output[code] = { name: country.name, prefix: phonecode ? `+${phonecode}` : '+',
        phoneHint: code === 'PH' ? '10 mobile digits beginning with 9, without the leading 0.' :
          `Enter the national mobile number, without ${phonecode ? `+${phonecode}` : 'the country code'}.`,
        postalPattern: postal.zip || null, postalExample: postal.zipex?.split(',')[0] || '',
        postalApplicable: Boolean(postal.zip || postal.fmt?.includes('%Z')),
        zone: meta.timezones?.[0]?.zoneName || 'UTC', capital: meta.capital || '',
        regions: Object.fromEntries(Object.entries(regions).sort(([a], [b]) => a.localeCompare(b, 'en'))) };
    }
  }));
  const sorted = Object.fromEntries(Object.entries(output).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en')));
  const target = path.join(__dirname, '../frontend/src/data');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'countries.json'), JSON.stringify(sorted) + '\n');
  console.log(`Updated ${countries.length} countries and territories, ${Object.values(output).reduce((n, c) => n + Object.keys(c.regions).length, 0)} subdivisions.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
