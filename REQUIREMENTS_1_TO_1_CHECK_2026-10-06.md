# One-to-one requirements check

Audit date: **October 6, 2026 (Asia/Manila)**.

**Every one of the 75 recorded source items has one assessment row below: 75/75 coverage, with no duplicate or omitted IDs. Full compliance is not yet established.**

Scope: the source-item transcription preserved in [FRONTEND_REQUIREMENTS.md, section 11](FRONTEND_REQUIREMENTS.md#11-one-to-one-source-coverage). The original blueprint attachment is not stored in this workspace, so this verifies the recorded requirements rather than independently validating the transcription against the attachment. Parent and child requirements remain separate wherever the preserved mapping does so.

## Results

| Assessment | Source items | Meaning |
| --- | ---: | --- |
| PASS | 54 | Required behavior or schema is supported by inspected implementation and passing tests/live metadata within the stated scope. |
| PARTIAL | 8 | Code exists but current operation is incomplete, or a literal source spelling differs. |
| UNVERIFIED | 13 | Code exists, but delivery, browser or device checks are still needed. |
| Total reviewed | 75 | Exactly one row per recorded requirement item. |

These counts measure source-item assessments, not test counts. One source item can include several constraints and several tests can support one item.

## Verification completed

| Check | Current result |
| --- | --- |
| Backend suite with RUN_DATABASE_TESTS=1 | **67 passed, 0 failed, 0 skipped**. Actual MariaDB workflow uses rollback and simulated message delivery. |
| Frontend suite | **16 passed, 0 failed, 0 skipped**. Validation/calendar/API tests; no React browser rendering. |
| Production frontend build | **Passed**. |
| Live database metadata | **27/27 required columns checked**, plus primary keys, unique email index, enum values, zero defaults and foreign keys including address delete cascade. There are 26 source schema items because one item names both timestamps. |
| Brevo readiness | **Passed**: API reachable, configured sender active and verified; no email sent. |
| iProg readiness | **Passed**: account reachable and 154 credits available; no SMS sent. |
| Live holidays | **Failed**: CALENDARIFIC_API_KEY is missing. |
| Environment | Development mode, HTTP origin, no TLS certificate/key, no trusted proxy and no strong persistent production CSRF secret configured. |
| Native computer/browser availability | Native computer-use connection unavailable; browser inventory empty. Rendered/device/keyboard QA could not run. |
| Whitespace check for changed code | Passed git diff --check. |

## Requested adjustments

- SMS now includes the localized expiry and zone, plus five-minute validity. It uses the same account-country/state formatting as the UI and the same persisted UTC deadline. Regression checks cover PH, California summer/winter offsets, India, date rollover, delayed submission, resends and server expiry.
- Login now checks lock and email/active eligibility before the stored password hash. Email-unverified rejection does not change the attempt counter or session. Unknown/locked accounts use a dummy hash after the lock/existence gate; three incorrect eligible-account passwords still lock and trigger the alert workflow.

## Evidence references

| Reference | Inspected implementation and verification |
| --- | --- |
| R | [Registration validation](frontend/src/validation.mjs), [forms](frontend/src/App.jsx), [API](backend/app.js), [address service](backend/addresses.js), [security](backend/auth.js), [TLS server](backend/server.js), [frontend tests](frontend/src/frontend.test.mjs), [API tests](backend/test/app.test.js), [address tests](backend/test/addresses.test.js), [security tests](backend/test/security.test.js). |
| V | [Email templates](backend/email.js), [SMS adapter](backend/sms.js), [OTP](backend/otp.js), [shared localization](frontend/src/format.mjs), [verification API](backend/app.js), [email tests](backend/test/email.test.js), [SMS tests](backend/test/iprog-sms.test.js), [workflow tests](backend/test/app.test.js), live readiness checks. |
| L | [Login/unlock/session API](backend/app.js), [authentication](backend/auth.js), [store](backend/store.js), [login client](frontend/src/App.jsx), [workflow tests](backend/test/app.test.js), [SQL integration](backend/test/database.test.js). |
| D | [Startup schema](backend/schema.js), [SQL schema](backend/registration_system.sql), [persistence](backend/store.js), live information_schema columns/indexes/foreign keys, [real SQL integration](backend/test/database.test.js). |
| U | [React screens/modal](frontend/src/App.jsx), [CSS](frontend/src/styles.css), bundled frontend/public/hero-forest.jpg, production build; browser inventory has no connected browser. |
| H | [Holiday provider](backend/holidays.js), [API](backend/app.js), [calendar](frontend/src/calendar.mjs), [holiday UI](frontend/src/App.jsx), [provider tests](backend/test/holidays.test.js), [frontend tests](frontend/src/frontend.test.mjs), failed live holiday configuration check. |

## 1. Registration

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 1(a)(i) | Required first/last names; allowed characters; 2–50 characters. | PASS | R | Required names are trimmed; 2-50 characters, permitted punctuation and a letter are enforced on client and server. |
| 1(a)(ii) | Optional middle initial; maximum two characters; optional trailing period. | PASS | R | Optional; one/two letters or one letter and a period, with maximum length two. |
| 1(a)(iii) | Required birthday text; MM/DD/YYYY; no date picker; valid date; age at least 13. | PASS | R | Text input; strict format, calendar validity, future-date rejection and the thirteenth birthday boundary are tested using Manila dates. |
| 1(a)(iv) | Required password; 12+ characters; uppercase, lowercase, number, special character; strong password suggestion. | PASS | R | All four character classes and 12-character minimum; cryptographic 16-character suggestions. A 72-byte bcrypt limit is also enforced. |
| 1(a)(v) | Confirm Password exactly matches Password. | PASS | R | Nonempty confirmation must exactly equal the password on client and server. |
| 1(a)(vi)(1) | Required alphanumeric house/street with standard punctuation. | PASS | R | Required house/street includes a letter or number; allowed standard punctuation and maximum 255 characters. |
| 1(a)(vi)(2) | Required country/city/state/ZIP dropdowns or verified text; country-specific postal format. | PASS | R | Dependent country/subdivision/city selections and country-specific postal checks. Caloocan, US and UK combinations are tested. Directory coverage limits are documented in backend/ADDRESS_DATA.md; individual street delivery is outside this check. |
| 1(a)(vii) | Required public-provider email; reject custom/corporate domains; database uniqueness. | PASS | R | Syntax, normalized public-provider allowlist and uniqueness are enforced; the live email index is unique. The allowlist supports the documented providers. |
| 1(a)(viii) | Required mobile; selected-country prefix; national numbering validation; Philippine +63 and ten digits. | PASS | R | Country-driven prefix and libphonenumber national validation; PH requires +63 plus ten digits beginning with 9. Number ownership requires live delivery. |
| 1(b)(i) | Strict HTTPS/TLS 1.3 for payload submission. | PARTIAL | R | Production rejects HTTP and non-TLS-1.3 requests before payload parsing; direct TLS is restricted to 1.3. Current configuration is development/HTTP with no certificates or trusted TLS proxy. |
| 1(b)(ii) | Server-side Argon2id or bcrypt with high work factor; no plaintext password storage. | PASS | R | Server bcrypt work factor 12; only a hash is stored. Client-supplied hash injection is rejected. |
| 1(b)(iii) | At most five registration requests per IP per hour. | PASS | R | At most five requests per IP/hour; persistent quota counts malformed, invalid, duplicate and rolled-back requests. Concurrent requests cannot bypass it. |
| 1(b)(iv) | Registration anti-CSRF token. | PASS | R | Signed anti-CSRF cookie/header and origin validation; rejected submissions have no registration side effects. |

## 2. Email and mobile verification

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 2(a)(i) | Registered account unverified; login restricted before email verification. | PASS | V | Null email verification and false mobile verification at registration. Email-unverified accounts are rejected before password comparison; verification sessions cannot access the dashboard APIs. |
| 2(a)(ii) | Cryptographically secure email token; 24-hour expiry; verification email delivery. | UNVERIFIED | V | Random 32-byte hashed token, 24-hour expiry, single use and automatic Brevo submission pass tests. Sender/API checks pass; actual receipt and use of a delivered link are unverified. |
| 2(b) | Complete professional email: subject, greeting, welcome, explanation, secure Verify My Email Address link, disregard/expiry notice, sign-off. | PARTIAL | V | Required subject, greeting, welcome, explanation, button/link, disregard/expiry notice and sign-off are checked in text/HTML. Current local application links use HTTP; real receipt and production HTTPS remain pending. |
| 2(c)(i) | SMS OTP after email verification or as secondary step; provided mobile number; country time-zone formatting. | UNVERIFIED | V | Email confirmation submits SMS to the stored phone. The SMS now includes expiry in the account state/country zone, with Asia/Manila for PH. Same deadline is persisted and displayed; transport, delay, resend, DST and date-rollover tests pass. Actual receipt/international delivery remain unverified. |
| 2(c)(i)(1) | Six numeric digits; five-minute validity; three attempts before lockout; Resend OTP after 60 seconds. | PASS | V | Six random numeric digits, 300,000-ms validity, three incorrect guesses and 60-second resend. Resends replace the code, retain attempts and preserve the old state on failed delivery. |

## 3. Login, lockout and unlock

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 3(a)(i) | Required standard-format email; database existence; verified account. | PASS | L | Email syntax and normalized database lookup; locked/email-unverified accounts are rejected. Full workspace access requires mobile verification too. |
| 3(a)(ii) | Required nonempty password; client-side length check only. | PASS | L | Login requires a nonempty password without registration composition checks. bcrypt verifies eligible accounts; oversized passwords cannot bypass lockout. |
| 3(b)(i) | Track incorrect login attempts per account/email. | PASS | L | Incorrect passwords increment a persistent account counter transactionally. Status rejections do not consume password guesses. |
| 3(b)(ii) | Lock account/system access at three consecutive failed logins. | PASS | L | Third consecutive incorrect password locks access and revokes sessions. Successful eligible login resets the counter. |
| 3(b)(iii)(1) | Immediately send automated security alert to registered email with unlock link. | UNVERIFIED | L | Third failure creates a hashed unlock token and immediately invokes the security email adapter. Mocked submission and live sender readiness pass; actual alert receipt is unverified. |
| 3(b)(iii)(2) | Enforce two-minute cooldown before verification/unlock is permitted. | PASS | L | Server rejects early unlock; eligibility begins after two minutes without automatically unlocking. Whole-second timestamp rounding cannot shorten the cooldown. |
| 3(b)(iv) | Generic failure messages to prevent email/password disclosure. | PASS | L | Unknown-email, locked-account and incorrect-password failures use Invalid email or password. Email-unverified accounts receive the verification-required status before any password check, as a status rejection. |
| 3(c)(1) | User enters credentials. | PASS | L | Email/password inputs and form submission are present in the login screen. |
| 3(c)(2) | Client validates format. | PASS | L | Client calls validateLogin for email format and nonempty password before submitting. |
| 3(c)(3) | Server checks account lock. | PASS | L | Account existence/lock gate now runs before credential comparison. Locked/unknown accounts use only a dummy comparison after that decision. |
| 3(c)(4) | Server verifies email and active status. | PASS | L | Unlocked existing account must have verified email before stored-hash comparison; mobile verification determines session access. The supplied schema has no separate is_active field. Active eligibility uses lock and verification state. |
| 3(c)(5) | Server compares password hash. | PASS | L | Stored bcrypt comparison occurs only after the account gates. A regression test forbids comparison for email-unverified accounts and confirms no counter/session changes. |
| 3(c)(6) | Increment failed-attempt counter on failure. | PASS | L | Failed eligible-account password comparisons increment the counter; unknown accounts do not expose existence through credential errors. |
| 3(c)(7) | At three failures, lock, send unlock email, enforce two-minute cooldown. | UNVERIFIED | L | Three failures, lock, session revocation, unlock-token creation and two-minute cooldown pass tests and real SQL integration. Real security-email receipt is unverified. |
| 3(c)(8) | Successful login issues session token and redirects to landing. | PASS | L | Random session token stored hashed; HttpOnly/SameSite cookie and dashboard next route. Secure in production; logout revokes the token. Mobile-pending accounts receive a restricted verification session. |

## 4. Database

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 4(a)(i)(1) | users.id: UUID primary key. | PASS | D | Live CHAR(36) primary key; registration generates canonical crypto.randomUUID identifiers. |
| 4(a)(i)(2) | users.first_name: VARCHAR(50), not null. | PASS | D | Live VARCHAR(50), NOT NULL. |
| 4(a)(i)(3) | users.last_name: VARCHAR(50), not null. | PASS | D | Live VARCHAR(50), NOT NULL. |
| 4(a)(i)(4) | users.middle_initial: VARCHAR(2), nullable. | PASS | D | Live VARCHAR(2), nullable. |
| 4(a)(i)(5) | users.birthday: DATE, not null. | PASS | D | Live DATE, NOT NULL. |
| 4(a)(i)(6) | users.password_hash: VARCHAR(255), not null. | PASS | D | Live VARCHAR(255), NOT NULL; registration persists bcrypt hashes. |
| 4(a)(i)(7) | users.email: VARCHAR(255), unique, indexed, not null. | PASS | D | Live VARCHAR(255), NOT NULL, with a single-column unique email index. |
| 4(a)(i)(8) | users.email_verified_at: TIMESTAMP, nullable. | PASS | D | Live TIMESTAMP, nullable. |
| 4(a)(i)(9) | users.mobile_number: VARCHAR(20), not null. | PASS | D | Live VARCHAR(20), NOT NULL. |
| 4(a)(i)(10) | users.mobile_verified: BOOLEAN, default false; spelling corrected. | PASS | D | Live BOOLEAN representation TINYINT(1), default 0; normalized spelling mobile_verified. |
| 4(a)(i)(11) | users.failed_login_attempts: INT, default 0. | PASS | D | Live INT, default 0. |
| 4(a)(i)(12) | users.is_locked: BOOLEAN, default false. | PASS | D | Live BOOLEAN representation TINYINT(1), default 0. |
| 4(a)(i)(13) | users.lockout_until: TIMESTAMP, nullable. | PASS | D | Live TIMESTAMP, nullable. |
| 4(a)(i)(14) | users.created_at and updated_at: TIMESTAMP. | PASS | D | Both live created_at and updated_at are TIMESTAMP, NOT NULL. |
| 4(a)(ii)(1) | addresses.id: UUID primary key. | PASS | D | Live CHAR(36) primary key; registration generates a UUID. |
| 4(a)(ii)(2) | addresses.user_id: UUID foreign key to users.id, cascading delete; reference typo corrected. | PASS | D | Live CHAR(36), NOT NULL, foreign key to users.id with ON DELETE CASCADE. Source reference spelling is normalized to users. |
| 4(a)(ii)(3) | addresses.house_street: VARCHAR(255), not null. | PASS | D | Live VARCHAR(255), NOT NULL. |
| 4(a)(ii)(4) | addresses.country: VARCHAR(100), not null. | PASS | D | Live VARCHAR(100), NOT NULL. |
| 4(a)(ii)(5) | addresses.city: VARCHAR(100), not null. | PASS | D | Live VARCHAR(100), NOT NULL. |
| 4(a)(ii)(6) | addresses.state: VARCHAR(100), not null. | PASS | D | Live VARCHAR(100), NOT NULL. |
| 4(a)(ii)(7) | addresses.zip_code: VARCHAR(20), not null. | PASS | D | Live VARCHAR(20), NOT NULL. |
| 4(a)(iii)(1) | verification_tokens.id: UUID primary key. | PASS | D | Live CHAR(36) primary key; token creation generates a UUID. |
| 4(a)(iii)(2) | verification_tokens.user_id: UUID foreign key. | PASS | D | Live CHAR(36), NOT NULL, foreign key to users.id. |
| 4(a)(iii)(3) | verification_tokens.token_hash: VARCHAR(255), not null. | PASS | D | Live VARCHAR(255), NOT NULL; secure token hashes are persisted. |
| 4(a)(iii)(4) | verification_tokens.type: email_verify, mobile_otp, password_reset, account_unlock enum. | PASS | D | Live required enum exactly contains email_verify, mobile_otp, password_reset and account_unlock. A reset workflow is not specified merely by this enum. |
| 4(a)(iii)(5) | verification_tokens.expired_at: TIMESTAMP, not null. | PARTIAL | D | Live expires_at is TIMESTAMP, NOT NULL and enforces expiry. The preserved source calls this expired_at; implementation normalizes it to expires_at. Semantic behavior passes, but literal column-name matching differs. |

## 5. Landing page and modal

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 5(a) | High-resolution responsive image background; semitransparent dark overlay; readable foreground across viewports. | UNVERIFIED | U | Bundled forest hero, cover background and semitransparent dark gradient are implemented. Readability/cropping across device viewports need browser QA. |
| 5(b) | Floating sticky/fixed nav; logo; Dashboard, Profile, Settings, Philippine Holidays; profile dropdown; secure Logout; mobile hamburger. | UNVERIFIED | U | Fixed floating logo/nav, named routes, holiday control, profile dropdown, logout and mobile hamburger exist. Server logout/session invalidation pass tests; visible menu/device operation is unverified. |
| 5(c) | Prominent centered or left-aligned CTAs including primary View More. | UNVERIFIED | U | Prominent left-aligned View More CTA exists and opens workspace state. Actual rendered prominence and positioning need browser QA. |
| 5(d)(i) | View More opens an overlay modal on the landing page. | UNVERIFIED | U | Fixed overlay/dialog with close controls, focus handling and scroll lock is implemented. Opening/closing in a browser is unverified. |
| 5(d)(ii) | Clean tabbed interface allowing users to switch between views. | UNVERIFIED | U | Accounts and Calendars/Holidays tabs switch the mounted panel; keyboard tab controls exist. Actual browser interaction is unverified. |
| 5(d)(ii)(1) | Accounts tab lists/tables accessible user accounts. | UNVERIFIED | U | Accounts table requests authorized account data; endpoint/session tests pass. Actual rendered table/tab interaction is unverified. |
| 5(d)(ii)(2) | Calendars/Holidays tab includes integrated calendar and API-driven Philippine holiday selector. | PARTIAL | H/U | Calendar/holiday tab, selector and integration code exist. The missing Calendarific key prevents live calendar/holiday content; browser interaction is also unverified. |
| 5(e) | Mobile-first Flexbox/Grid and fluid media queries for smartphones, tablets, laptops, ultra-wide monitors. | UNVERIFIED | U | Mobile-first Flexbox/Grid, fluid clamp widths and 400/540/800/960/1600-pixel rules exist. Phone, tablet, laptop and ultrawide rendering remain unverified. |

## 6. Philippine holidays

| Source item | Recorded requirement | Status | Evidence | Finding |
| --- | --- | --- | --- | --- |
| 6(a)(i) | Philippine jurisdiction, Asia/Manila, +63 context. | PASS | H | PH country request, Asia/Manila timestamps and +63 Philippine context are explicit in the holiday module and tests. |
| 6(a)(ii) | Selectable historical/near-future years 2020–2027. | PASS | H | Selectable 2020-2027 range; calendar/API boundary tests pass, including leap years. Selector remains available while service is offline. |
| 6(b)(i) | Query external public holiday API dynamically; no local holiday database storage. | PARTIAL | H | Dynamic Calendarific HTTPS request per year; no local holiday storage or fallback dataset. Live operation fails because CALENDARIFIC_API_KEY is missing. |
| 6(b)(ii) | Modal year change asynchronously fetches that year's official Philippine holiday dataset. | PARTIAL | H | Year-change effect asynchronously requests the selected year and aborts obsolete requests. Mocked tests pass; live official datasets for all eight years are unavailable without the key. |
| 6(b)(iii) | Categorize/display Regular, Special Non-Working, and Islamic Holidays clearly. | PARTIAL | H | Provider primary_type classification and Islamic categories pass mocked tests; working/local/observance records are excluded. Real provider classifications have not been verified. |
| 6(c)(i) | Easily accessible through landing View More modal's calendar/holiday tab. | PARTIAL | H/U | View More and holiday navigation target the same calendar tab. Missing key prevents live holiday content; visible access needs browser QA. |
| 6(c)(ii) | Visually distinct Regular versus Special Non-Working badges. | UNVERIFIED | H/U | Distinct green regular, amber special and purple Islamic badge classes exist. Real-record presentation and rendered contrast are unverified. |
| 6(c)(iii) | Responsive holiday cards or table across device types. | UNVERIFIED | H/U | Holiday cards use responsive one/two/three-column grids. Real holiday content and device layout checks remain unverified. |

## Items preventing a full compliance verdict

1. Configure Calendarific and verify actual Philippine datasets/classification for 2020-2027.
2. Configure production HTTPS/TLS 1.3, HTTPS links and a persistent strong CSRF secret; verify the deployed transport.
3. Verify received registration emails, SMS codes and third-failure security/unlock emails in an actual registration/login cycle, including relevant international numbers. Provider readiness is not delivery confirmation.
4. Complete browser checks for navigation, CTA, modal/tab operation, hero readability, badges and all required device widths.
5. Confirm whether literal schema spelling is graded: the source transcription names verification_tokens.expired_at while the implementation uses expires_at. Earlier documentation normalizes source typos such as ysers/users, VACHAR/VARCHAR and mobile_verfied/mobile_verified; those corrections are documented rather than hidden.

Active status is modeled using lock and verification state because the supplied schema specifies no separate is_active field. Requiring mobile verification for full workspace access is the documented registration-flow interpretation; correct email-verified credentials can resume mobile verification in a restricted session.

The two requested code adjustments are complete. All recorded items were assessed; the outstanding operation and verification items above remain open.
