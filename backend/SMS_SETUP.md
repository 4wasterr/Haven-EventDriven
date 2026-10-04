# Infobip 2FA SMS OTP

The app uses [Infobip 2FA](https://www.infobip.com/docs/2fa-service/using-2fa-api) for SMS and Resend for email. It calls Infobip's HTTPS API directly. Bird and Twilio are no longer used.

## Philippines and free trial

Checked on October 5, 2026: Infobip's [SMS self-sign-up guide](https://www.infobip.com/docs/sms/get-started) includes the Philippines in worldwide coverage, with specific excluded countries listed separately. It lists **15 free SMS messages in a 60-day trial**. [Sign-up requires no credit card](https://www.infobip.com/docs/essentials/getting-started/create-an-account).

Trial messages only reach verified recipients through the provided test sender. Infobip's documentation varies: its general trial page says up to 100 messages per channel and one verified phone, while its SMS guide lists 15 SMS and up to five phones. **Check your actual allowance and recipient limits in Infobip Portal** before testing. This is a limited trial, not permanently free SMS. General registrations with arbitrary recipients require a paid account and sender/channel approval.

## Configure the project

1. [Create an Infobip account](https://signup.infobip.com/). Verify your email and your **+63 mobile number**, choose **SMS** and the **Developer** experience.
2. In the SMS onboarding page, choose **2FA with SMS**. Use the trial sender supplied by the portal; examples include `InfoSMS` or `ServiceSMS`, but the permitted sender depends on your account and location.
3. Create an enabled **2FA application** with these settings. Keep the returned `applicationId`:

```json
{
  "name": "Haven mobile verification",
  "enabled": true,
  "configuration": {
    "pinAttempts": 3,
    "allowMultiplePinVerifications": false,
    "pinTimeToLive": "5m",
    "verifyPinLimit": "1/3s",
    "sendPinPerApplicationLimit": "10000/1d",
    "sendPinPerPhoneNumberLimit": "1/1m"
  }
}
```

4. Create an SMS message template **inside that application**. Set `pinLength` to **6** and `pinType` to **NUMERIC**; the portal's example may default to four digits. Use the allowed trial sender as `senderId`. Keep the returned `messageId`:

```json
{
  "pinType": "NUMERIC",
  "pinLength": 6,
  "pinPlaceholder": "{{pin}}",
  "messageText": "Your Haven verification code is {{pin}}. It expires in 5 minutes.",
  "senderId": "YOUR_ALLOWED_TRIAL_SENDER"
}
```

The onboarding API request editor or Infobip's API explorer can create these resources. Endpoints: `POST /2fa/2/applications`, then `POST /2fa/2/applications/{applicationId}/messages`. See the [official 2FA workflow](https://www.infobip.com/docs/2fa-service/using-2fa-api).

5. Copy your account's **API base URL** and create an **API key with `2fa:manage` scope**. This scope covers reading the configuration, sending and checking PINs. See [API authorization](https://www.infobip.com/docs/essentials/api-essentials/api-authorization). Put these values in `backend/.env`:

```dotenv
INFOBIP_API_KEY=your_real_api_key
INFOBIP_BASE_URL=https://YOUR_ACCOUNT.api.infobip.com
INFOBIP_2FA_APPLICATION_ID=your_application_id
INFOBIP_2FA_MESSAGE_ID=your_message_template_id
```

Use the base URL from your own account. Keep the key in the backend only. Bird and Twilio environment variables are ignored.

The portal's **Onboarding SMS**, **Onboarding 2FA** and **Auto generated** entries are API keys. Use the **Onboarding 2FA** key for `INFOBIP_API_KEY`. They are not application or template IDs: those two IDs are returned by the resource-creation requests in steps 3 and 4. The backend rejects API keys entered in the ID fields without printing them.

6. Restart the backend and check the application/template **without sending SMS**:

```powershell
npm.cmd --prefix backend run sms:check
```

The check requires an enabled application, three PIN attempts, single-use verification, five-minute expiry and a matching six-digit numeric template. It never sends a message, changes provider settings or prints credentials. Passing confirms API access and configuration; it does not confirm remaining trial units or handset delivery.

## Verification and recovery

After email confirmation, the app automatically requests SMS for the account's registered number. Retry through **Send SMS code**, or sign in to resume an existing account's verification. Philippine numbers use **+63 plus the ten-digit national mobile number**, dropping the leading `0` from `09...`.

Old Bird/Twilio challenges cannot be checked through Infobip. Request a new SMS after the resend cooldown; the email verification and account remain saved. New challenges replace the provider ID while preserving remaining attempts and lockout state.

The backend independently enforces **five minutes**, **three entry attempts** and a **60-second resend delay** in MariaDB. It saves the Infobip PIN ID as `infobip:PIN_ID`, checks that exact challenge and requires the provider's verified result for the same recipient. Provider PINs are never returned or displayed by the application. OTP lockout requires support recovery.

If delivery fails, email stays verified and no new challenge is saved. The user sees a readable failure and can retry manually. Backend logs and the CLI explain missing configuration, invalid template settings, API permission failures, exhausted trial units and rate limits without exposing provider responses or credentials. Ambiguous sends are never retried automatically.

For an optional direct delivery test to your verified trial recipient:

```powershell
npm.cmd --prefix backend run sms:test -- send +639171234567
# Use the verification ID printed by the send command and the received code:
npm.cmd --prefix backend run sms:test -- check +639171234567 123456 infobip:PIN_ID_FROM_SEND
```

Replace the examples with your intended phone, received code and printed verification ID. The CLI calls Infobip directly; use the app to exercise session authorization and database-backed limits. Real delivery remains untested until credentials are configured and a recipient receives and enters a code.
