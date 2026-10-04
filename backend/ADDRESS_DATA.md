# Address data

Snapshot added October 5, 2026. The country dropdown contains 250 countries and territories and 5,260 subdivision choices. The Philippine choices are 82 provinces plus Metro Manila. Cities and postal areas stay on the server and load only after the country/province/city is chosen.

## Caloocan

Select **Philippines → Metro Manila → Caloocan City**. There are 23 distinct ZIP choices: 1400–1413 and 1420–1428. Each choice includes the directory's postal-area name and a North/South Caloocan label. Multiple area names for the same code share one choice.

For example, 1400 is Caloocan City CPO, 1420 is Kaybiga/Deparo, 1421 is Bagumbong/Pag-asa, 1422 is Novaliches North (Camarin North), 1427 includes Tala Leprosarium and Victory Heights, and 1428 is Bagong Silang. The form does not assign 1400 to every Caloocan address. Choose the actual postal area and include the barangay/subdivision in House & street. No guessed barangay-number-to-ZIP mapping is used.

All 17 Metro Manila LGUs are listed explicitly because the upstream city file omitted some. The server rejects a city outside the chosen province and a ZIP outside the listed postal areas of a city when an exact mapping is available.

## Coverage and validation

- Country/state/city data: [Country State City](https://github.com/dr5hn/countrystatecity-npm), `@countrystatecity/countries` 1.0.9.
- Postal data: the same project's `@countrystatecity/postalcodes` 1.0.2, with directory records for 125 countries.
- US city/ZIP associations: [GeoNames postal data](https://download.geonames.org/export/zip/US.zip), 41,490 records. The postal package's US locality names were empty, so GeoNames supplies those associations.
- Postal formats and countries without postal codes: [Google libaddressinput metadata](https://github.com/google/libaddressinput/wiki/AddressValidationMetadata), fetched from `https://chromium-i18n.appspot.com/ssl-address/data/{country}`.
- National mobile-number validation: `libphonenumber-js/max`, including valid mobile or shared fixed/mobile number types. Phone prefixes follow the selected country. Unsupported/uninhabited territories can have no valid mobile numbering plan.

Full postal codes associated with a city become a dropdown. A country with only postal-area data, such as the UK's outward areas, requires the full postcode as text. Format validation is repeated on the server, together with directory membership and subdivision checks where records exist. A country with no postal scheme uses the explicit `N/A` value.

This is a geographic directory, not a postal carrier's live deliverability service. Country/subdivision/city names and coverage can differ from postal naming, some subdivisions have no city records, and the data cannot prove delivery to a particular house or street. Postal fallback checks sometimes establish only country/subdivision membership, not a city match. No invented cities or placeholder numeric ZIP codes are supplied. Update the datasets periodically and review local changes against the postal authority.

## Attribution and licences

Country State City data and the adapted country/subdivision snapshot are provided under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) and the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/). The adapted snapshot is available at `/api/addresses/countries` and in `frontend/src/data/countries.json`; the Caloocan/Metro Manila associations are in `backend/addresses.js`. Preserve attribution and provide the adapted database under ODbL when distributing it.

Google address metadata and GeoNames data are provided under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The country snapshot combines country/subdivision data, phone prefixes, and Google postal metadata; the US snapshot selects ZIP, locality, and state fields from GeoNames. Source attribution is also served publicly at `/address-data-sources.txt` and linked from registration.

## Refresh

Run from the project root after installing frontend and backend dependencies:

```powershell
node scripts/update-address-data.cjs
python scripts/update-us-postal-data.py
npm.cmd test
npm.cmd run build
```

The first command uses the installed Country State City version and retrieves Google metadata. Update the packages deliberately if newer city/postal records are needed. Review the generated snapshot and Caloocan associations before publishing; restarting the backend loads the new city/postal packages.
