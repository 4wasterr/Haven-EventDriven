const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { checkSmsAccount } = require('./sms');

checkSmsAccount().then(({ credits }) => {
  console.log(`iProg account connected. Available SMS credits: ${credits}.`);
  if (credits === 0) {
    console.error('The iProg account needs SMS credits before it can send verification codes.');
    process.exitCode = 1;
  }
}).catch(error => {
  console.error(error.diagnostic || 'Could not check the iProg account.');
  process.exitCode = 1;
});
