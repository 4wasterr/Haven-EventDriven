const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { createVerification, checkVerification, parseRecipient } = require("./sms");

async function main() {
    const args = process.argv.slice(2);
    if (!args.length) {
        console.log("Usage:");
        console.log("  To send SMS verification:");
        console.log("    npm.cmd run sms:test -- +639171234567");
        console.log("    or: node sms-test.js send +639171234567");
        console.log("  To check verification code:");
        console.log("    node sms-test.js check +639171234567 123456 infobip:PIN_ID_FROM_SEND");
        process.exitCode = 1;
        return;
    }

    let command = "send";
    let target = args[0];
    let code = args[1];
    let verificationId = args[2];

    if (args[0] === "send" || args[0] === "check") {
        command = args[0];
        target = args[1];
        code = args[2];
        verificationId = args[3];
    }

    if (!target) {
        console.error("Please provide the complete phone number, including +63 and the ten-digit Philippine mobile number.");
        process.exitCode = 1;
        return;
    }

    try {
        const recipient = parseRecipient(target);
        if (!recipient.phone_number) throw new Error("SMS verification requires a phone number, not an email address.");
        target = recipient.phone_number;
        if (command === "check") {
            if (!code || !verificationId) {
                console.error("Please provide the code and verification ID: node sms-test.js check <recipient> <code> <infobip:PIN_ID>");
                process.exitCode = 1;
                return;
            }
            console.log(`Checking verification code for ${target}...`);
            const result = await checkVerification({ to: target, code, id: verificationId });
            if (result.success) {
                console.log("Verification SUCCESSFUL! The code is correct.");
            } else {
                process.exitCode = 1;
                console.log(`Verification failed. Reason: ${result.reason || "invalid"}`);
                if (result.attemptsRemaining !== null) {
                    console.log(`Attempts remaining: ${result.attemptsRemaining}`);
                }
            }
        } else {
            console.log(`Sending verification to ${target}...`);
            const verification = await createVerification({ to: target });
            console.log(verification.id, verification.status);
            console.log("\nInfobip accepted the SMS verification request.");
            console.log(`Recipient: ${JSON.stringify(verification.to)}`);
            console.log(`Once the recipient receives the passcode, verify it with:`);
            console.log(`  node sms-test.js check "${target}" <CODE> "${verification.id}"`);
        }
    } catch (error) {
        console.error(`Error: ${error.diagnostic || error.message}`);
        process.exitCode = 1;
    }
}

main();
