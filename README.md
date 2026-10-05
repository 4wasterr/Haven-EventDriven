# Haven

React and Express application with MariaDB accounts, local address data, Brevo transactional emails, iProg SMS OTP verification, and Calendarific Philippine public holidays. See [the one-to-one requirement check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md) for all 75 recorded source items and current verification results, and [the implementation audit](REQUIREMENTS_AUDIT.md) for the overview.

## Current behavior

- Existing verified accounts can sign in, view their dashboard/profile and sign out.
- Brevo sends email verification links and account unlock alerts when its credentials and sender are configured. Pending account details remain in the database.
- New accounts can register and verify their email when Brevo is configured. Email confirmation automatically requests an iProg SMS OTP when configured; full dashboard access requires both verifications.
- Haven generates cryptographically random six-digit SMS codes, stores only salted account/phone-bound hashes, and verifies them locally. Codes expire after five minutes. Resends require 60 seconds, invalidate the previous code, and retain the three-attempt budget; three incorrect codes lock mobile verification until support intervenes.
- Registration sends the professional Haven verification email automatically. Accounts start unverified; sign-in returns 403 until the emailed token is confirmed. Tokens are generated from 32 cryptographically random bytes, stored only as hashes, expire after 24 hours, and can be used once.
- Signed-in, fully verified users can open **Send email** (`/send-email`) to send a message through Brevo. Submissions require the existing session and CSRF token and are limited to ten send attempts per account per hour.
- Account lockout remains enforced. Unlock links retain their two-minute cooldown, expiry, and single-use token checks.
- Registration accepts at most **five requests per IP per hour**, including invalid fields, malformed JSON, duplicate emails, unavailable delivery configuration and rolled-back account writes. CSRF failures are rejected before consuming the quota. A 429 response supplies `Retry-After`; the registration form shows a countdown.
- The Calendars/Holidays modal fetches Calendarific asynchronously for the selected year, **2020–2027**. Its national Philippine records are classified using the provider's `primary_type`; regular, special non-working and Islamic holidays have distinct badges. Working holidays, observances and regional-only holidays are excluded. No dates or holiday datasets are stored in MariaDB or substituted from local samples. Missing keys and provider failures show an unavailable state with the year selector retained.
- Country, city and postal choices use installed geographic packages and bundled snapshots through the local backend. They do not contact external address APIs. See [address data](backend/ADDRESS_DATA.md) for coverage and attribution.
- The dashboard image is bundled locally, so displaying it makes no external image request.

Passwords, sessions, verification tokens, rate limits and existing account data remain in MariaDB. The local `/api` routes still connect the React frontend to Express.

## Run

Use Node.js 22.12+ and start MariaDB. Set database connection values in `backend/.env`; `backend/.env.example` lists the supported settings. The configured database must exist. Startup creates missing application tables and preserves existing rows.

```powershell
npm.cmd --prefix backend install
npm.cmd --prefix frontend install
npm.cmd run dev
```

You can also run `npm run dev` from the frontend folder in Command Prompt. The launcher starts or reuses the backend, waits for the database and local API, then starts Vite. Open its printed Local URL (normally **http://localhost:5173**). Press Ctrl+C to stop it. `npm run dev:frontend` starts Vite alone if you manage the backend separately.

Vite forwards `/api` requests to the local backend, normally port 5000. Set `PUBLIC_APP_URL` to the application origin used in the browser. Restart the backend after changing its environment settings.

## Brevo email setup

Set these values in `backend/.env` and restart the backend:

```dotenv
BREVO_API_KEY=your_brevo_api_key
SENDER_NAME=Haven
SENDER_EMAIL=your_verified_sender@example.com
PUBLIC_APP_URL=http://localhost:5173
```

Use a sender verified in your Brevo account and set `PUBLIC_APP_URL` to the actual frontend origin so verification and unlock links open the correct application. Keep the API key in the backend environment only. The implementation uses the modern [`BrevoClient` SDK](https://github.com/getbrevo/brevo-node) and `transactionalEmails.sendTransacEmail`.

`POST /api/send-email` accepts `recipientEmail`, optional `recipientName`, optional `subject`, and `message`. It returns `{ "success": true, "messageId": "..." }` after Brevo accepts the email. Invalid input returns 400, missing configuration returns 503, and provider delivery failures return 502. Messages preserve line breaks and escape HTML. An acceptance ID confirms submission to Brevo; delivery status can be checked in Brevo's transactional email logs.

## iProg SMS OTP setup

Set these values in `backend/.env` and restart the backend:

```dotenv
IPROG_API_URL=https://www.iprogsms.com/api/v1
IPROG_API_TOKEN=your_iprog_api_token
```

Validate the token and available credits without sending an SMS:

```powershell
npm.cmd --prefix backend run sms:check
```

If this reports that iProg rejected `IPROG_API_TOKEN`, replace it with the current API token from your iProg account in `backend/.env`, restart the backend, and run the check again. iProg can return HTTP 200 with `status: 500` and `message: "Invalid Token"`; Haven treats this as unavailable SMS authentication (HTTP 503, `reason: "sms_invalid_credentials"`) rather than a retryable delivery error. Credentials and raw provider bodies are never returned to the browser or printed by the check.

`backend/sms.js` sends Axios requests to iProg's documented `POST /api/v1/sms_messages` endpoint with `api_token`, `phone_number` (country code and digits), and `message`. `IPROG_API_URL` is the API base URL; the adapter appends `/sms_messages`. See the [iProg API documentation](https://www.iprogsms.com/api/v1/documentation). Haven owns OTP generation, storage, expiry, attempts and verification instead of using iProg's provider-generated OTP endpoint.

The SMS body includes the localized expiry; an example is:

```text
Haven
Your OTP is 482719
Expires at Oct 4, 2026, 8:05 AM (Asia/Manila). Valid for 5 minutes.
```

The digits and timestamp above are illustrative; each send generates a new six-digit code and a five-minute expiry. The phone's actual **sender name** is controlled by iProg. Request and approve **Haven** in your iProg account to display it as the sender; adding Haven to the body does not set the sender ID. iProg documents Philippine network coverage and sender approval requirements in its [FAQ](https://www.iprogsms.com/faqs); international delivery is not verified by this project.

After email verification, the existing verification session can call `POST /api/send-otp` with `{ "phoneNumber": "09171234567" }`. The phone must match the account's registered mobile number. Existing `POST /api/send-mobile-otp` and `/api/resend-mobile-otp` routes use the stored number without requiring a body field. All routes require the session cookie and signed `X-CSRF-Token` from `/api/csrf`; they share the resend cooldown and send limit. Sending returns `{ success: true, message, otp: { sent, expiresAt, resendAt, attemptsRemaining, locked } }`, without exposing the code or raw provider response. Missing/invalid input returns 400, early resends 429 with `Retry-After`, locked verification 423, missing configuration 503, and provider failures 502.

`POST /api/verify-mobile` accepts `{ "code": "482719" }` and compares it against the persisted salted verifier. Successful verification clears the code and verification session; sign in to continue. Expired codes return 410, incorrect codes return 400, and the third incorrect code returns 423. A delivered code can still be checked locally if SMS settings become unavailable. Failed SMS resends roll back changes to the previous code and cooldown. Startup adds the nullable `otp_hash` column to existing `mobile_verifications` tables without replacing account rows.

Deadlines are stored in UTC and returned to the browser as epoch milliseconds. The SMS and UI format the same expiry using the registered country's default time zone, overridden by the selected province/state's zone when available (Philippines: Asia/Manila). The five-minute deadline is calculated before provider submission and persisted unchanged, so provider latency cannot shift the timestamp printed in the SMS.

## Philippine holiday API

Set `CALENDARIFIC_API_KEY` in `backend/.env` and restart the backend. Keep the key server-side. [Calendarific's documentation](https://calendarific.com/api-documentation) describes free account/key creation, the HTTPS `/api/v2/holidays` endpoint, `country=PH`, `year`, and returned classifications. Your email and SMS keys cannot authenticate the holiday service.

```dotenv
CALENDARIFIC_API_KEY=your_calendarific_api_key
```

```powershell
npm.cmd --prefix backend run holidays:check -- 2020
npm.cmd --prefix backend run holidays:check -- 2027
```

`GET /api/holidays/:year` requires a fully verified authenticated session and fetches that year from the provider on every request. It returns sorted, deduplicated records, provider attribution and `Asia/Manila`. Islamic public holidays retain their regular/special classification plus an Islamic badge. Dates may change with official proclamations, particularly future Islamic holidays. Check the provider's current data rather than treating predictions as final announcements.

Unknown legal classifications and malformed dates fail explicitly; they are never guessed or generated locally. Provider authentication, quota and network errors do not expose the key or raw response. `createApp` still accepts injectable holiday, email and SMS services for tests; health/session checks validate configuration without sending messages or fetching holidays.

## Checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd --prefix backend run db:check
npm.cmd --prefix backend run email:check
```

Tests exercise the real Brevo SDK with a mocked HTTP transport, iProg request/response handling with a mocked Axios client, and authentication workflows with injected delivery adapters. They check local OTP persistence, expiry, cooldowns, concurrent requests, lockout, failed resend recovery and removal of the direct-verification bypass. No real emails or SMS are sent by the tests. To check the actual MariaDB workflow inside a transaction rolled back after testing (including the idempotent startup schema additions):

```powershell
$env:RUN_DATABASE_TESTS='1'
npm.cmd --prefix backend test
Remove-Item Env:RUN_DATABASE_TESTS
```

## Production

Run `npm.cmd run build`, then `npm.cmd start` to serve the frontend and local API together on port 5000. Set `NODE_ENV=production`, an HTTPS `PUBLIC_APP_URL`, and a random `CSRF_SECRET` of at least 32 characters. Supply `TLS_CERT_FILE` and `TLS_KEY_FILE` for TLS 1.3 directly, or set `TRUST_PROXY=1` behind a trusted reverse proxy. Production rejects HTTP and any negotiated TLS version other than 1.3 before parsing payloads; cookies are Secure and HttpOnly.

For a trusted Nginx proxy, configure TLS 1.3 and overwrite both transport headers:

```nginx
ssl_protocols TLSv1.3;
# Inside the location proxying to the private Haven backend:
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-TLS-Version $ssl_protocol;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_pass http://127.0.0.1:5000;
```

Keep the backend accessible only to the trusted proxy. A missing or older `X-TLS-Version` is rejected. Local development continues on loopback HTTP; it is not a TLS-compliant production deployment.

The original schema is in `backend/registration_system.sql`; startup additions are in `backend/schema.js`. Existing rows are preserved. Legacy client-supplied password hashes require password recovery before those accounts can sign in.

The bundled dashboard photograph comes from [the original Unsplash image](https://images.unsplash.com/photo-1472396961693-142e6e269027).
