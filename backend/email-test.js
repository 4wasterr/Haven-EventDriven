const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { isEmail, sendEmail, getEmailDelivery } = require('./email');

async function main() {
    const to = (process.argv[2] || '').trim();
    if (!isEmail(to) || /@(?:resend|messagebird)\.dev$/i.test(to)) {
        throw new Error('Usage: npm.cmd --prefix backend run email:test -- your-real-inbox@gmail.com. Choose a real inbox; simulation addresses cannot receive mail.');
    }
    const result = await sendEmail({ to, subject: 'Haven email delivery test',
        html: '<p>This is a real email sent by Haven through Resend to test inbox delivery.</p>',
        text: 'This is a real email sent by Haven through Resend to test inbox delivery.' });
    console.log(`Resend accepted the email. Message ID: ${result.id}`);
    for (let attempt = 0; attempt < 4; attempt++) {
        let delivery;
        try { delivery = await getEmailDelivery(result.id); }
        catch (error) { console.log(`Submission succeeded; delivery status could not be read. ${error.message}`); break; }
        console.log(`Delivery status: ${delivery.status}`);
        if (['bounced', 'failed', 'suppressed', 'complained'].includes(delivery.status)) {
            process.exitCode = 1; console.error('The email was not successfully delivered. Check its event log at https://resend.com/emails.'); break;
        }
        if (['delivered', 'opened', 'clicked'].includes(delivery.status)) {
            console.log('The recipient mail server accepted this message.'); break;
        }
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log('Check the recipient Inbox and Spam/Junk. API acceptance alone does not confirm inbox placement.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
