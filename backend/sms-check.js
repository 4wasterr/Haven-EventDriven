const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { checkSmsAccess } = require('./sms');

async function main() {
    const result = await checkSmsAccess();
    console.log(`SMS provider: ${result.provider}`);
    console.log(`Infobip 2FA access: HTTP ${result.status}`);
    console.log(result.message);
    if (!result.accessible) process.exitCode = 1;
}

main().catch(error => { console.error(error.diagnostic || error.message); process.exitCode = 1; });
