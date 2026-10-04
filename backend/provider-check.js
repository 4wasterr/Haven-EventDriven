const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { checkEmailAccess, sendEmail, getEmailDelivery } = require('./email');
const { checkSmsAccess } = require('./sms');
async function checkHolidays() {
    const response = await fetch('https://date.nager.at/api/v3/PublicHolidays/2026/PH', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Holiday provider: HTTP ${response.status}`);
    const holidays = await response.json();
    console.log(`Philippine holidays: HTTP ${response.status}, ${holidays.length} entries`);
}
async function main() {
    if (process.argv.includes('--holidays-only')) return checkHolidays();
    const checks = await Promise.allSettled([
        checkEmailAccess().then(result => {
            console.log(`Email provider: ${result.provider}`); console.log(result.message);
            if (!result.ready) process.exitCode = 1;
        }),
        checkSmsAccess().then(result => {
            console.log(`Infobip SMS 2FA: HTTP ${result.status}`); console.log(result.message);
            if (!result.accessible) process.exitCode = 1;
        }),
        checkHolidays()
    ]);
    for (const result of checks) if (result.status === 'rejected') { console.error(result.reason.diagnostic || result.reason.message); process.exitCode = 1; }
    if (process.argv.includes('--sandbox-email')) {
        const sent = await sendEmail({ to: 'delivered@resend.dev', subject: 'Haven Resend simulation', text: 'Simulated delivery only; this address has no inbox.' });
        console.log(`Resend simulated email: ${sent.status}`);
        try { console.log(`Resend simulated delivery: ${(await getEmailDelivery(sent.id)).status}`); }
        catch (error) { console.log(error.message); }
    }
}
main().catch(error => { console.error(error.message === 'fetch failed' ? 'Provider network connection failed.' : error.message); process.exitCode = 1; });
