"""Refresh US city/ZIP associations from GeoNames (CC BY 4.0)."""
import io
import json
from pathlib import Path
import urllib.request
import zipfile

source = 'https://download.geonames.org/export/zip/US.zip'
with urllib.request.urlopen(source, timeout=30) as response:
    archive = zipfile.ZipFile(io.BytesIO(response.read()))
rows = []
for line in archive.read('US.txt').decode('utf-8').splitlines():
    columns = line.split('\t')
    if len(columns) >= 11:
        rows.append({'code': columns[1], 'city': columns[2], 'state': columns[4]})
target = Path(__file__).resolve().parent.parent / 'backend' / 'data'
target.mkdir(parents=True, exist_ok=True)
(target / 'us-postal.json').write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Updated {len(rows)} US city/ZIP records from GeoNames.')
