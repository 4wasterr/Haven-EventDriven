# Blueprint implementation audit

The recorded **Comprehensive Application Requirements & Blueprint** is mapped to the React/Express/MariaDB implementation. Full operational compliance is not yet established. The [current one-to-one check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md) assesses all 75 recorded source items individually; [FRONTEND_REQUIREMENTS.md, section 11](FRONTEND_REQUIREMENTS.md#11-one-to-one-source-coverage) preserves the source-item transcription.

## Registration — section 1

| Source | Implemented behavior | Evidence |
| --- | --- | --- |
| 1(a)(i–ii) | First/last names require 2–50 letters, spaces, hyphens or apostrophes. Middle initial is optional, at most two characters: one/two letters or one letter and a period. | Shared `frontend/src/validation.mjs`, frontend tests and server validation tests. The source does not explicitly forbid two letters. |
| 1(a)(iii) | Text birthday input, strict MM/DD/YYYY, real calendar date, no future birthdays, age 13+. Client and server use the Asia/Manila calendar date. | Birthday edge cases, leap-year tests and a midnight UTC/Manila boundary test. |
| 1(a)(iv–v) | Passwords require 12+ characters and all four character classes; confirmation matches exactly. Suggestions use Web Crypto and produce 16-character passwords. | Password generation and validation tests. bcrypt requires a 72-byte maximum to avoid silently truncated passwords. |
| 1(a)(vi) | Required house/street with allowed punctuation; country/province/city selections; postal choices or verified country-format input. | Address service and national postal-format tests, including mismatched city/province/postal combinations. Directory coverage limits are documented in `backend/ADDRESS_DATA.md`. |
| 1(a)(vii–viii) | Public email domain allowlist, email syntax and database uniqueness; country-controlled phone prefix and national mobile numbering validation, including +63 plus ten Philippine digits. | Validation, address and registration tests. Supported public domains are listed in `PUBLIC_EMAIL_PROVIDERS`. |
| 1(b)(i) | Production rejects HTTP and TLS versions other than 1.3 before parsing payloads. Direct HTTPS server permits TLS 1.3 only; trusted proxies must report the negotiated version. | `backend/auth.js`, `backend/server.js`, production transport tests. Local development intentionally uses loopback HTTP. Production certificates/proxy are still deployment setup. |
| 1(b)(ii) | Server-side bcrypt with work factor 12; no plaintext/client-provided hashes stored. | Registration hash verification and injected-hash rejection tests. |
| 1(b)(iii) | Five requests per IP per hour in shared database storage. Invalid, duplicate, malformed, unavailable-provider and rolled-back requests count. Quota commits separately from account writes. | Quota, concurrent-request, malformed-JSON and database tests. HTTP 429 includes Retry-After; the form shows a countdown. |
| 1(b)(iv) | Signed CSRF cookie/header tokens and request-origin checks on every mutation. Production requires a persistent strong signing secret. | CSRF/origin and production-secret tests. |

## Email and mobile verification — section 2

| Source | Implemented behavior | Evidence |
| --- | --- | --- |
| 2(a)(i–ii) | Accounts start unverified and cannot authenticate. Random 32-byte verification tokens are hashed in the database, expire in 24 hours and are consumed once. | Registration, restricted-session, expired-token and replay tests. |
| 2(b) | Required professional subject, greeting, welcome, secure Verify My Email Address button/link, 24-hour/disregard notice and Haven Security Team sign-off in text and HTML email. | Tests exercise the existing Brevo SDK with mocked transport and check the template and secure link. |
| 2(c)(i) | Email confirmation requests an SMS code for the registered mobile. The SMS and UI include expiry formatted in the account country/state zone, including Asia/Manila, using the same persisted UTC deadline. | Real-adapter payload, state-zone fallback, delayed-send, resend, daylight-saving and date-rollover tests. Actual receipt remains unverified. |
| 2(c)(i)(1) | Random numeric six-digit OTP, five-minute validity, three incorrect entries before lockout, 60-second resend cooldown. Resends replace the code while retaining the attempt budget. OTPs are salted and account/phone-bound hashes. | Expiry, attempts, resend, concurrent requests, failed resend rollback and hash-binding tests. The code and keys are not exposed to the browser. |

Brevo's configured sender and the iProg account passed live read-only checks. No real verification emails, unlock emails or SMS messages were sent during this work. The user can confirm end-to-end delivery through their own registration; approval of the Haven SMS sender name is managed in iProg.

## Login, lockout and unlock — section 3

| Source | Implemented behavior | Evidence |
| --- | --- | --- |
| 3(a)(i-ii), 3(c)(1-5) | Client checks email syntax/password presence. Server checks lock and email/active eligibility before bcrypt comparison; mobile status determines full or restricted access. Unknown/locked accounts use only a dummy comparison after the gate. | Login, normalized-email and hash tests; regression checks show unverified-email rejection performs no comparison, counter update or session issuance. Active eligibility uses lock/verification state; no separate is_active field is specified. |
| 3(b)(i–ii), 3(c)(6–7) | Incorrect passwords increment the account's counter. The third consecutive failure locks the account, invalidates its sessions and requests one security alert email. Successful login resets the counter. Oversized wrong passwords also count. | Counter reset, lockout, generic errors, session revocation and oversized-password tests. |
| 3(b)(iii–iv) | Unlock email contains a secure hashed single-use token. Unlock requires a server-enforced two-minute cooldown. Incorrect/unknown/locked credential failures use “Invalid email or password.” | Early unlock, timed unlock, locked-login, unknown-email and token-replay tests. |
| 3(c)(8) | Success creates a hashed database session token in an HttpOnly/SameSite cookie and redirects to /dashboard. Secure logout revokes the server token. | Session, account authorization and logout replay tests. |

## Database — section 4

| Source | Implementation |
| --- | --- |
| 4(a)(i)(1–14) | `users` includes every required identity, password, verification, attempt/lock and timestamp field. UUIDs use canonical CHAR(36) storage; email has a unique index. |
| 4(a)(ii)(1–7) | `addresses` includes each required field and a user foreign key with cascading delete. |
| 4(a)(iii)(1–5) | `verification_tokens` includes UUID, user foreign key, hash, all four enum values and a required expiry timestamp; lookup index is added idempotently. |
| Additional enforcement state | `sessions`, `mobile_verifications` and `api_rate_limits` persist authentication, salted OTPs, deadlines, attempts, resend timing and quotas. |

`backend/schema.js` makes additive startup changes; `backend/registration_system.sql` supplies the core schema. Blueprint spelling mistakes are normalized to `users`, `VARCHAR`, `mobile_verified` and `expires_at`. The enum's `password_reset` value is present; the blueprint does not specify a password-reset workflow. The real MariaDB registration/verification/login/lockout/unlock/logout integration test passed inside a transaction that was rolled back, preserving existing accounts.

## Landing page and modal — section 5

| Source | Implementation |
| --- | --- |
| 5(a) | Bundled responsive forest hero with a semitransparent CSS gradient overlay and readable foreground text. |
| 5(b) | Fixed floating logo/navigation, Dashboard/Profile/Settings destinations, Philippine Holidays control, profile dropdown, CSRF-protected Logout and mobile hamburger. |
| 5(c–d) | Prominent View More opens an overlay dialog with Accounts and Calendars/Holidays tabs. Accounts are authorized by the API and show the signed-in user's accessible account. |
| 5(e) | Mobile-first Flexbox/Grid, fluid widths, responsive breakpoints and ultra-wide rules. Modal includes focus trapping, Escape, focus restoration, scroll locking and keyboard tab navigation. |

The production build passes. Native computer-use is unavailable and browser inventory is empty, so rendered layout, keyboard behavior and device viewport QA remain unverified.

## Philippine holidays — section 6

| Source | Implemented behavior | Evidence / remaining configuration |
| --- | --- | --- |
| 6(a)(i–ii) | Philippine jurisdiction, Asia/Manila and +63 context; all selectable years 2020–2027, including when the provider is unavailable. | Calendar year and time-zone tests. |
| 6(b)(i–ii) | Authenticated server fetches Calendarific country=PH/year asynchronously on opening/year selection. No holiday rows or hardcoded dates are stored locally. Aborted old requests cannot replace the new year's results. | Mocked upstream request tests and selected-year API tests. Live fetching needs `CALENDARIFIC_API_KEY` in `backend/.env`. |
| 6(b)(iii), 6(c)(ii) | Provider `primary_type` distinguishes Regular Holidays and Special Non-Working Days; Islamic public holidays get an additional distinct badge/filter. Working days, observances and region-only records are excluded. Unknown legal classifications fail explicitly. | Classification, filtering, malformed date, deduplication and provider-failure tests. |
| 6(c)(i), 6(c)(iii) | View More calendar tab and navigation link open the same responsive calendar/cards with year/month/category selection, date filtering, retry, unavailable states and source attribution. | Frontend build and calendar/API tests; browser device QA remains pending. |

The provider is implemented according to [Calendarific's API documentation](https://calendarific.com/api-documentation). Its key is absent from the current environment, so live 2020–2027 dataset coverage cannot yet be verified. Future holiday dates, particularly Islamic holidays, may change after official proclamations; the application fetches provider updates instead of calculating dates locally.

## Verification commands

Current verification passed: **67 backend tests (including real MariaDB), 16 frontend tests, and the production build**, with no failures or skipped tests. Live metadata checks passed for all 27 required columns, keys, enum values, defaults and foreign keys. Brevo sender and iProg account checks passed; the holiday check reported the missing Calendarific key.

```powershell
npm.cmd test
npm.cmd run build
$env:RUN_DATABASE_TESTS='1'
node --test backend/test/database.test.js
Remove-Item Env:RUN_DATABASE_TESTS
npm.cmd --prefix backend run db:check
npm.cmd --prefix backend run email:check
npm.cmd --prefix backend run sms:check
# After adding CALENDARIFIC_API_KEY:
npm.cmd --prefix backend run holidays:check -- 2020
npm.cmd --prefix backend run holidays:check -- 2027
```

All 75 recorded source items have an assessment. Full running-system compliance still requires the holiday key, production TLS 1.3, real message delivery checks and browser/device QA. Literal naming also needs review: the recorded verification_tokens.expired_at is implemented as expires_at. The [one-to-one check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md) records these boundaries explicitly.
