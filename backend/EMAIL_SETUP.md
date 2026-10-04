# Resend email delivery

Resend sends Haven's registration verification and account-unlock emails. Recipients can use Gmail, Outlook, Yahoo, iCloud and the other public providers supported by the form. Email links keep the existing single-use, hashed-token verification flow and 24-hour expiry. Resend's API acceptance does not verify an account or guarantee Inbox placement.

## Configure

Create a key at [Resend API keys](https://resend.com/api-keys). Keep it only in the ignored `backend/.env`:

```env
RESEND_API_KEY=re_REPLACE_WITH_YOUR_REAL_KEY
RESEND_FROM=onboarding@resend.dev
PUBLIC_APP_URL=http://localhost:5173
```

The sender above is **test-only**: it can send to the email address associated with your Resend account. If your Resend account uses `arianefetalvo24@gmail.com`, use that recipient for the initial real-inbox test. Other registered addresses require your own verified sender domain. [Resend explains this restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

For registration emails to arbitrary supported public inboxes:

1. Add a domain you own at [Resend Domains](https://resend.com/domains).
2. Add the DNS records Resend provides and wait for the sending domain to be verified.
3. Set `RESEND_FROM` to an email address on that exact verified domain. You cannot claim `gmail.com`, `outlook.com` or `yahoo.com` as your own sender domain.
4. Disable click tracking for the verification sender domain to keep secure links direct.
5. Restart the backend after changing `.env`.

No recipient needs a Resend account once you use your verified sender domain. The app sends over Resend's HTTPS API using Bearer authentication and an Idempotency-Key derived from the token record ID. Infobip 2FA handles SMS separately with the four `INFOBIP_` settings in `backend/.env`.

## Check and send

From the project root:

```powershell
npm.cmd --prefix backend run email:check
npm.cmd --prefix backend run email:test -- arianefetalvo24@gmail.com
# Resend the real verification link for an existing, unverified Haven account:
npm.cmd --prefix backend run verify-email:test -- registered-address@gmail.com
```

`email:check` sends no email. It exits unsuccessfully for the test sender because that sender is not ready for arbitrary registrations; testing your Resend account inbox is still allowed. Checking domain readiness and retrieving delivery events require a **Full access** key. A **Sending access** key can send messages but cannot perform those read diagnostics; use [Resend Emails](https://resend.com/emails) to inspect delivery instead. Read-only checks do not make a send-only key unusable for registration.

`email:test` sends to the real recipient you supply, prints the message ID, and checks delivery events when permitted. An accepted API response means Resend queued the email; `delivered` means the recipient mail server accepted it. Inspect Inbox and Spam/Junk to confirm where it arrived. Simulation addresses such as `delivered@resend.dev` have no inbox.

`verify-email:test` uses the account's actual stored verification token flow, replaces its previous link, and sends the required professional template. It never marks the account verified. Open **Action Required: Verify your email address for Haven**, follow **Verify My Email Address**, and confirm in Haven to proceed to mobile verification.

## Errors

- Missing or placeholder `RESEND_API_KEY`: local configuration error, before account creation or dispatch.
- HTTP 401: invalid/missing key, or a Sending access key used for a read diagnostic.
- HTTP 403: test recipient restriction, unverified sender, or API-key permissions. Read the safe error hint and inspect the Resend dashboard.
- HTTP 429 or quota errors: check Resend's current sending quota; repeatedly requesting a message will not fix it.
- Network failure or an invalid response: the app reports that acceptance could not be confirmed.

Provider response bodies, API keys, email content and verification tokens are never printed in delivery diagnostics or returned in API errors. Account creation is preserved when delivery fails; use the existing Resend verification email button once the sender is configured. The email verification screen shows a delivery failure until a resend succeeds.

References: [send API](https://resend.com/docs/api-reference/emails/send-email), [sender domains](https://resend.com/docs/dashboard/domains/introduction), [delivery events](https://resend.com/docs/api-reference/emails/retrieve-email).
