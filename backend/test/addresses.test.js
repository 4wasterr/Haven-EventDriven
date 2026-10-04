const test = require('node:test');
const assert = require('node:assert/strict');
const { getCities, getPostalChoices, validateAddress } = require('../addresses');

test('Metro Manila has all 17 LGUs and Caloocan has 23 distinct, labeled ZIP codes', async () => {
  const cities = await getCities('PH', 'Metro Manila');
  assert.equal(cities.length, 17);
  for (const city of ['Caloocan City', 'Malabon', 'Navotas', 'San Juan', 'Pasay']) assert.ok(cities.some(row => row.name === city));
  const result = await getPostalChoices('PH', 'Metro Manila', 'Caloocan City');
  assert.equal(result.mode, 'select');
  assert.equal(result.options.length, 23);
  for (const [code, area] of [['1400', 'South Caloocan'], ['1420', 'Deparo'], ['1421', 'Bagumbong'], ['1422', 'Camarin North'], ['1428', 'Bagong Silang']]) {
    assert.ok(result.options.some(row => row.value === code && row.label.includes(area)));
    assert.deepEqual(await validateAddress({ country: 'PH', region: 'Metro Manila', city: 'Caloocan City', postal: code }), {});
  }
  assert.ok((await validateAddress({ country: 'PH', region: 'Metro Manila', city: 'Caloocan City', postal: '1100' })).postal);
  assert.ok((await validateAddress({ country: 'PH', region: 'Cavite', city: 'Caloocan City', postal: '1428' })).city);
});

test('US ZIP codes match the selected city, and UK full postcodes remain text entries', async () => {
  const california = await getCities('US', 'California');
  assert.ok(california.some(row => row.name === 'San Francisco'));
  const sf = await getPostalChoices('US', 'California', 'San Francisco');
  assert.ok(sf.options.some(row => row.value === '94102'));
  assert.ok(!sf.options.some(row => row.value === '90012'));
  assert.deepEqual(await validateAddress({ country: 'US', region: 'California', city: 'San Francisco', postal: '94102' }), {});
  assert.ok((await validateAddress({ country: 'US', region: 'California', city: 'San Francisco', postal: '90012' })).postal);
  const london = await getPostalChoices('GB', 'England', 'London');
  assert.equal(london.mode, 'input');
  assert.deepEqual(await validateAddress({ country: 'GB', region: 'England', city: 'London', postal: 'SW1A 1AA' }), {});
});

test('worldwide cities are lazy-loaded and invalid city queries never invent postal choices', async () => {
  assert.ok((await getCities('IN', 'Maharashtra')).some(row => row.name === 'Mumbai'));
  assert.ok((await getCities('AU', 'New South Wales')).some(row => row.name === 'Sydney'));
  assert.deepEqual(await getCities('ZZ', 'Fake state'), []);
  assert.equal((await getPostalChoices('PH', 'Metro Manila', 'Fake city')).invalidCity, true);
});
