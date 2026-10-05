const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { BrevoClient } = require('@getbrevo/brevo');
const { getEmailConfiguration, EmailConfigurationError } = require('./email');

async function main() {
  try {
    const config = getEmailConfiguration();
    const client = new BrevoClient({ apiKey: config.apiKey, timeoutInSeconds: 10,
      maxRetries: 0, logging: { silent: true } });
    const result = await client.senders.getSenders();
    console.log('Brevo API reachable. No email was sent.');
    const sender = result.senders?.find(item => item.email?.toLowerCase() === config.sender.email.toLowerCase());
    if (!sender?.active) {
      console.error('The configured SENDER_EMAIL is not an active verified Brevo sender. Verify it in Brevo and try again.');
      process.exitCode = 1;
    } else console.log('Configured Brevo sender is verified and active.');
  } catch (error) {
    console.error(error instanceof EmailConfigurationError ?
      'Set BREVO_API_KEY, SENDER_NAME and a verified SENDER_EMAIL in backend/.env.' :
      Number.isInteger(error.statusCode) ? `Brevo configuration check failed (HTTP ${error.statusCode}). Check API access and sender settings.` :
        'Could not check the Brevo configuration. Check the connection and try again.');
    process.exitCode = 1;
  }
}
main();
