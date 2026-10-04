const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { isEmail, getEmailConfiguration, sendVerificationEmail } = require('./email');

async function main() {
    const to = (process.argv[2] || '').trim().toLowerCase();
    if (!isEmail(to)) throw new Error('Usage: npm.cmd --prefix backend run verify-email:test -- registered-address@gmail.com');
    getEmailConfiguration();
    const db = require('./db');
    const { Store } = require('./store');
    try {
        const store = new Store(db);
        const { user, token } = await store.transaction(async tx => {
            const user = await tx.userByEmail(to, true);
            if (!user) throw new Error('Register this address in Haven first. This command resends a real verification link for an existing account.');
            if (user.email_verified_at) throw new Error('This account email is already verified.');
            if (user.is_locked) throw new Error('Unlock this account before resending verification.');
            return { user, token: await tx.replaceToken(user.id, 'email_verify', Date.now()) };
        });
        const result = await sendVerificationEmail({ to, firstName: user.first_name, ...token });
        console.log(`Resend accepted the real 24-hour verification email. Message ID: ${result.id}`);
        console.log('Check Inbox/Spam and follow Verify My Email Address. Delivery events: https://resend.com/emails.');
    } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
