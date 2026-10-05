# Comprehensive blueprint check

Audit date: **October 6, 2026 (Asia/Manila)**.

Source: the user's attached **Comprehensive Application Requirements & Blueprint**, covering sections 1–6. This report checks the current implementation directly rather than treating the earlier requirement documents as proof of completion.

## Verdict

**The system is not yet fully operational and verified against every requirement.** The registration, verification, login, database, dashboard and holiday integration code is present. Automated checks pass. The confirmed operational gaps are:

1. **The holiday API is unavailable:** `CALENDARIFIC_API_KEY` is missing. The calendar and holiday cards are hidden while the service is unavailable; the year/category controls and unavailable notice remain visible. Live datasets for 2020–2027 and their classifications have not been verified.
2. **Strict HTTPS/TLS 1.3 is not enabled in the current environment:** it uses development mode and an HTTP application origin, with no configured TLS certificate/key, trusted proxy or valid persistent production CSRF secret. Production enforcement exists in code, but that does not make this local HTTP setup compliant with requirement 1(b)(i).
3. **Actual message delivery remains unverified:** the Brevo sender and iProg account passed live read-only checks, but this audit did not send verification emails, unlock emails or SMS messages. Acceptance, receipt and completion using real delivered links/codes need an end-to-end check, including international delivery if non-Philippine registrations are in scope.
4. **Browser and device QA remains unverified:** the browser inventory returned no connected apps or browsers. Rendered contrast, responsive layout and interactive behavior cannot be certified from source code and unit tests alone.

The two requested wording adjustments are now implemented and tested: the SMS includes localized expiry, and login gates lock/email/active eligibility before stored-hash comparison. The [current one-to-one check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md) contains exactly one assessment for each of 75 recorded source items. It also flags the recorded expired_at versus implemented expires_at spelling for literal schema grading.

**Status key:**

- **Verified** — inspected code and passing automated checks, or live database metadata, support the required behavior. This does not imply external message delivery or browser QA.
- **Partial** — code exists, but the current configuration prevents the required operation.
- **Unverified** — implementation exists, but the relevant live or visual check was not performed.
- **Literal schema spelling** - expiry behavior is implemented, but the source transcription names expired_at while the implementation uses expires_at.

## Verification performed

| Check | Result | What it establishes |
| --- | --- | --- |
| Complete backend suite with `RUN_DATABASE_TESTS=1` | **67 passed, 0 failed, 0 skipped** | Authentication, rate limits, CSRF, transport enforcement, adapters and an actual MariaDB workflow. |
| Complete frontend suite | **16 passed, 0 failed, 0 skipped** | Validation, password suggestions, calendar calculations, localization and API behavior. These tests do not mount the React interface in a browser. |
| Production build | **Passed after the requested changes** | JSX/CSS/module compilation. |
| Live MariaDB metadata inspection | **Passed** | Required columns, lengths, nullability, defaults, keys and address cascading foreign key. No account contents were printed. |
| MariaDB integration test | **Passed** | Registration → email verification → mobile verification → login → accounts → lockout → timed unlock → logout, using actual SQL and injected message adapters. Test data was rolled back. |
| Live Brevo check | **Passed** | API access and configured sender active/verified. No email was sent. |
| Live iProg check | **Passed; 154 SMS credits** | API access and an available balance. No SMS was sent. |
| Live holiday check for 2026 | **Failed: missing configuration** | Reports that `CALENDARIFIC_API_KEY` must be set in `backend/.env`. |
| Current environment inspection | **Development / HTTP** | TLS certificates, trusted proxy and valid persistent production CSRF secret are not configured. Values of credentials were not printed. |
| Browser inventory | **Empty; native computer-use connection unavailable** | Visual, keyboard and multi-viewport QA remains pending. |

The database test calls the idempotent schema setup and tests account operations inside a transaction that is rolled back. It uses simulated delivery adapters, so its success is not evidence of real email or SMS receipt.

## 1. Registration form

Evidence: [validation](frontend/src/validation.mjs), [registration UI](frontend/src/App.jsx), [registration API](backend/app.js), [address validation](backend/addresses.js), [authentication security](backend/auth.js), [TLS server](backend/server.js), [persistent store](backend/store.js).

| Source | Requirement | Status | Finding |
| --- | --- | --- | --- |
| 1(a)(i) | Required first/last names; 2–50 letters, spaces, hyphens or apostrophes | Verified | Client and server share validation; names are trimmed, require a letter and reject other characters. |
| 1(a)(ii) | Optional middle initial; at most two characters; optional period | Verified | Empty value is accepted. One/two letters or one letter followed by a period are accepted; longer/invalid values are rejected. The blueprint does not explicitly forbid two letters. |
| 1(a)(iii) | Required birthday text, strict MM/DD/YYYY, real date, age 13+ | Verified | `type="text"`, not a date picker. Validation checks exact formatting, real dates, future dates and the thirteenth birthday using the Manila calendar date. |
| 1(a)(iv) | Password 12+ characters; uppercase/lowercase/number/special; suggestion | Verified | All required classes are checked on both sides. Web Crypto generates and shuffles a 16-character suggestion containing every class. A 72-byte maximum avoids bcrypt truncation. |
| 1(a)(v) | Confirmation exactly matches password | Verified | Nonempty confirmation and exact equality are required; suggestion populates both fields. |
| 1(a)(vi)(1) | Required alphanumeric house/street with standard punctuation | Verified | Requires at least a letter/number; permits standard punctuation and spaces; maximum 255 characters. |
| 1(a)(vi)(2) | Required country/city/state/ZIP selections or verified text; national ZIP format | Verified, with coverage limits | Dependent country/province/city choices and postcode dropdown/text validation are present. Server revalidates geographic membership and country format. Countries without postal codes use `N/A`. Some directory fallbacks verify country/subdivision rather than exact city; this is documented in `backend/ADDRESS_DATA.md`. |
| 1(a)(vii) | Required public-provider email; corporate/custom domains blocked; unique | Verified | Email syntax and a public-domain allowlist are enforced. Email is normalized; the actual database has a unique email index, and duplicate submissions are rejected. The allowlist covers supported public providers, not every public provider worldwide. |
| 1(a)(viii) | Required mobile; dynamic country prefix; national numbering validation | Verified | Prefix follows country selection. `libphonenumber-js/max` validates national mobile/shared mobile plans; PH requires ten national digits beginning with 9 after +63. This validates the number format, not whether the owner receives SMS. |
| 1(b)(i) | Strict HTTPS/TLS 1.3 for payloads | **Partial** | Production rejects HTTP and other TLS versions before payload parsing. Direct TLS is restricted to 1.3; a trusted proxy must report 1.3. The current configuration is HTTP development mode, so this operational requirement is not met. |
| 1(b)(ii) | Server Argon2id/bcrypt, high work factor, no plaintext password storage | Verified | bcrypt work factor 12, server-generated hashes. Registration rejects client-supplied password hashes; persistence stores only the hash. |
| 1(b)(iii) | At most five registration requests per IP per hour | Verified | Database-backed quota, separate from account-write transactions. Invalid, duplicate, malformed and rolled-back attempts consume quota; concurrency and retained quotas are tested. |
| 1(b)(iv) | Anti-CSRF token on registration | Verified | Signed cookie/header token and origin checks apply before registration. Client obtains and sends the token. Production requires a strong persistent CSRF secret. |

## 2. Email and mobile verification

Evidence: [verification endpoints](backend/app.js), [token persistence](backend/store.js), [email templates](backend/email.js), [SMS adapter](backend/sms.js), [OTP generation/verification](backend/otp.js), [verification UI and time formatting](frontend/src/App.jsx), [country time zones](frontend/src/format.mjs).

| Source | Requirement | Status | Finding |
| --- | --- | --- | --- |
| 2(a)(i) | New account unverified and restricted from login | Verified | Registration stores null email verification and false mobile verification. Correct credentials before email verification return 403 without an authenticated session. Verification sessions cannot access protected accounts/holidays. |
| 2(a)(ii) | Cryptographically secure token, 24-hour expiry, verification email dispatch | Verified code; delivery unverified | Random 32-byte token, hashed persistence, expiry and single use. Registration invokes the Brevo verification email automatically. Actual receipt was not tested. |
| 2(b), subject | `Action Required: Verify your email address for [Application Name]` | Verified | Template substitutes Haven. |
| 2(b), greeting | `Dear: [First Name]` | Verified | Text/HTML templates include the recipient's first name, escaped in HTML. |
| 2(b), welcome | Thank-you and welcome text | Verified | Required text is present. |
| 2(b), explanation | Security/registration explanation | Verified | Required explanation is present. |
| 2(b), action | `Verify My Email Address` and a secure link | Verified template; transport partial | Required labeled action links to the application with the token. Production requires HTTPS; the current local application origin is HTTP. |
| 2(b), notice | Disregard if unsolicited; expires in 24 hours | Verified | Both required notices appear in text and HTML. |
| 2(b), sign-off | Warm regards / application security team | Verified | Warm regards and Haven Security Team appear in the template. |
| 2(c)(i), trigger | SMS after email verification, to registered mobile | Verified code; delivery unverified | Successful email verification calls `sendOtp` for the account's stored number. Delivery failures retain email verification and allow a retry. |
| 2(c)(i), localization | Country time-zone format | Verified code; delivery unverified | The SMS now includes expiry in the account country/state zone; PH uses Asia/Manila. SMS, persisted verifier and UI share one UTC deadline. PH, California DST/date rollover, India and provider-delay cases pass tests; real receipt remains unverified. |
| 2(c)(i)(1), code | Six numeric digits | Verified | `crypto.randomInt(100000, 1000000)`; frontend/server enforce six numeric digits. Only salted account/phone-bound verifiers are stored. |
| 2(c)(i)(1), expiry | Valid for five minutes | Verified | Server enforces 300,000 ms, and the UI shows expiry/countdown. |
| 2(c)(i)(1), attempts | Maximum three attempts before lockout | Verified | Third wrong six-digit code locks mobile verification. Lock survives resends; concurrent attempts cannot bypass it. Malformed code submissions are rejected without consuming a guess. |
| 2(c)(i)(1), resend | Resend OTP available after 60 seconds | Verified | UI disables resend until the deadline and server enforces 60 seconds. A successful resend replaces the code while retaining the attempt budget; failed resend preserves the earlier code. |

The expiry and lockout tests pass. Receiving the messages, opening a delivered verification link and using a delivered OTP remain live acceptance checks. SMS delivery for non-Philippine numbers is also unverified.

## 3. Login, lockout and unlock

Evidence: [login UI](frontend/src/App.jsx), [login validation](frontend/src/validation.mjs), [login/unlock API](backend/app.js), [bcrypt/session security](backend/auth.js), [unlock email](backend/email.js).

| Source | Requirement | Status | Finding |
| --- | --- | --- | --- |
| 3(a)(i) | Required valid email, database existence, verified | Verified | Client checks syntax; server finds the normalized email and prevents email-unverified accounts from authenticating. Dashboard requires both email and mobile verification. |
| 3(a)(ii) | Required nonempty password; client-side length/presence only | Verified | Login checks presence without repeating registration composition rules. Server performs bcrypt comparison; invalid/locked accounts use a dummy comparison. |
| 3(b)(i) | Track incorrect logins per account/email | Verified | Account counter is persisted and transactionally updated. |
| 3(b)(ii) | Lock at three consecutive failures | Verified | Third wrong password sets lock state and revokes sessions. Successful login resets the failure count. Oversized incorrect passwords count as failures. |
| 3(b)(iii)(1) | Immediately trigger security email with unlock link | Verified code; delivery unverified | Third failure creates a hashed single-use unlock token and invokes the Brevo security email. Actual receipt was not tested. |
| 3(b)(iii)(2) | Server-enforced two-minute unlock cooldown | Verified | Server rejects early unlock with 429; UI countdown uses server timing. Whole-second database storage cannot shorten the two minutes. |
| 3(b)(iv) | Generic credential failure messages | Verified | Unknown email, wrong password and locked account use Invalid email or password. Email-unverified accounts receive a verification-required status before password comparison and do not consume password guesses. |
| 3(c)(1) | User enters credentials | Verified | Required email and password inputs present. |
| 3(c)(2) | Client validates format | Verified | Form calls `validateLogin` before submitting. |
| 3(c)(3-5) | Check lock, then verification/active status, then compare hash | Verified | Handler checks lock/existence, then email eligibility and mobile access status, then the stored bcrypt hash. Unverified-email regression tests forbid password comparison and confirm unchanged counters/sessions. Locked/unknown gates use only a dummy hash after their rejection decision. Active eligibility uses lock/verification state; the source schema has no is_active field. |
| 3(c)(6) | Increment counter on credential failure | Verified | Incorrect passwords increment the known account's counter; unknown accounts reveal no existence information. |
| 3(c)(7) | At three, lock/send unlock email/enforce two minutes | Verified code; delivery unverified | Lock, token, notification request and server cooldown are tested together. |
| 3(c)(8) | Success issues session token and redirects to landing | Verified | Random session token is stored hashed and sent in an HttpOnly/SameSite cookie. Fully verified login returns `/dashboard`; client navigates there. Production cookies are Secure. Logout revokes the token, including replay checks. |

## 4. Live database schema

Evidence: live `information_schema` metadata and foreign-key inspection, [schema startup](backend/schema.js), [SQL schema](backend/registration_system.sql), [MariaDB integration test](backend/test/database.test.js).

| Source | Required field/constraint | Live result |
| --- | --- | --- |
| 4(a)(i)(1) | `users.id`: UUID primary key | Verified — `CHAR(36)` primary key; registration generates `crypto.randomUUID()`. |
| 4(a)(i)(2) | `first_name`: VARCHAR(50), not null | Verified. |
| 4(a)(i)(3) | `last_name`: VARCHAR(50), not null | Verified. |
| 4(a)(i)(4) | `middle_initial`: VARCHAR(2), nullable | Verified. |
| 4(a)(i)(5) | `birthday`: DATE, not null | Verified. |
| 4(a)(i)(6) | `password_hash`: VARCHAR(255), not null | Verified. |
| 4(a)(i)(7) | `email`: VARCHAR(255), unique/indexed, not null | Verified — actual unique email index. |
| 4(a)(i)(8) | `email_verified_at`: TIMESTAMP, nullable | Verified. |
| 4(a)(i)(9) | `mobile_number`: VARCHAR(20), not null | Verified. |
| 4(a)(i)(10) | `mobile_verified`: BOOLEAN, false default | Verified — MariaDB `TINYINT(1)`, default 0. |
| 4(a)(i)(11) | `failed_login_attempts`: INT, zero default | Verified. |
| 4(a)(i)(12) | `is_locked`: BOOLEAN, false default | Verified — MariaDB `TINYINT(1)`, default 0. |
| 4(a)(i)(13) | `lockout_until`: TIMESTAMP, nullable | Verified. |
| 4(a)(i)(14) | `created_at`, `updated_at`: TIMESTAMP | Verified — both exist with current-timestamp defaults. Application updates `updated_at` in user mutations. |
| 4(a)(ii)(1) | `addresses.id`: UUID primary key | Verified — `CHAR(36)` primary key, generated UUID. |
| 4(a)(ii)(2) | `user_id`: UUID FK to users, cascading delete | Verified — `CHAR(36)` not null; actual FK to `users.id`, `ON DELETE CASCADE`. |
| 4(a)(ii)(3) | `house_street`: VARCHAR(255), not null | Verified. |
| 4(a)(ii)(4) | `country`: VARCHAR(100), not null | Verified. |
| 4(a)(ii)(5) | `city`: VARCHAR(100), not null | Verified. |
| 4(a)(ii)(6) | `state`: VARCHAR(100), not null | Verified. |
| 4(a)(ii)(7) | `zip_code`: VARCHAR(20), not null | Verified. |
| 4(a)(iii)(1) | `verification_tokens.id`: UUID primary key | Verified — `CHAR(36)` primary key, generated UUID. |
| 4(a)(iii)(2) | `user_id`: UUID foreign key | Verified — FK to `users.id`; live delete rule is RESTRICT, which the blueprint permits for this table. |
| 4(a)(iii)(3) | `token_hash`: VARCHAR(255), not null | Verified. |
| 4(a)(iii)(4) | `type`: required four-value enum | Verified — `email_verify`, `mobile_otp`, `password_reset`, `account_unlock`. |
| 4(a)(iii)(5) | Required expiry TIMESTAMP | Verified — field is named `expires_at`, not the blueprint's `expired_at`. |

The spelling errors `ysers`, `VACHAR`, `mobile_verfied` and `VARCHAR255)` are normalized to valid names/types. UUID values use canonical string storage rather than a native UUID SQL type. The blueprint specifies the `password_reset` enum value but no password-reset feature, so an absent password-reset screen is not counted as a missing requirement. Mobile OTP persistence uses the additional `mobile_verifications` table; the required enum still exists.

## 5. Post-login landing and modal

Evidence: [navigation, dashboard, accounts and workspace components](frontend/src/App.jsx), [responsive styles](frontend/src/styles.css), [bundled hero](frontend/public/hero-forest.jpg), [logout/session backend](backend/auth.js).

| Source | Requirement | Status | Finding |
| --- | --- | --- | --- |
| 5(a) | High-resolution responsive hero, dark overlay, readable foreground | Verified code; visual QA unverified | Bundled 2400 × 3961 image, CSS `cover`, semitransparent rgba gradient and light text. Actual contrast/cropping across viewports was not measured. |
| 5(b), position/logo | Sticky/fixed floating bar and logo | Verified code | Fixed top bar with Haven brand/logo mark, blur and fluid width. |
| 5(b), navigation | Dashboard, Profile, Settings destinations | Verified code | All three routes and navigation controls exist. |
| 5(b), holidays | Standard Philippine Holidays Module link | Verified code; service partial | Control is labeled `Philippine Holidays` and opens the holiday tab, including from other protected routes. The required full phrase is not its visible label. Live data is unavailable without the key. |
| 5(b), profile/logout | Profile dropdown with secure Logout | Verified code/API | Dropdown shows the signed-in user and profile/settings actions. Logout uses CSRF-protected POST, deletes the server session and clears the cookie. |
| 5(b), collapse | Hamburger on smaller screens | Verified code; visual QA unverified | Mobile nav hidden by default, expandable by hamburger; desktop nav displayed at 960 px. |
| 5(c) | Prominent centered/left CTA including View More | Verified code | Left-aligned high-contrast `View More` button in the hero. |
| 5(d)(i) | View More opens overlay modal | Verified code; browser interaction unverified | Opens the workspace overlay over the dashboard. Close button, outside-click dismissal, Escape, focus trap/restoration and body scroll locking exist. |
| 5(d)(ii) | Tabbed interface switching views | Verified code; browser interaction unverified | Accounts and Calendars/Holidays tabs, selected state, associated panel and arrow/Home/End keyboard handling. |
| 5(d)(ii)(1) | Accounts tab with accessible-account list/table | Verified API/code | Table has name, email, status and role. API exposes the signed-in user's own account, rather than an admin list of every user; this satisfies the stated accessible-account scope. |
| 5(d)(ii)(2) | Integrated calendar and API-driven holiday selector | **Partial** | Both are implemented, but the calendar/cards are hidden until holidays are configured and a fetch succeeds. Current environment cannot display the required live view. |
| 5(e) | Mobile-first Flexbox/Grid and responsive media queries through ultrawide | Verified code; **device QA unverified** | Fluid sizing, `clamp`, Flexbox/Grid, mobile defaults and 540/800/960/1600 px breakpoints; narrow-screen adjustments at 400 px. Accounts table scrolls within its container. No actual device/viewport layout certification. |

## 6. Standard Philippine holidays

Evidence: [holiday API adapter](backend/holidays.js), [authenticated holiday endpoint](backend/app.js), [calendar/year helpers](frontend/src/calendar.mjs), [holiday UI](frontend/src/App.jsx), [holiday classification/styles](frontend/src/styles.css).

| Source | Requirement | Status | Finding |
| --- | --- | --- | --- |
| 6(a)(i) | Philippines, Asia/Manila and +63 context | Verified code | API uses PH and returns Asia/Manila; dashboard/modal display Philippine localization and +63 context. |
| 6(a)(ii) | Selectable years 2020–2027 | Verified code | Eight explicit generated year options; calendar calculations and server range checks agree. The selector remains present when data is unavailable. |
| 6(b)(i) | Dynamic external holiday API, no local holiday database | Verified code; **operation partial** | Server requests Calendarific's HTTPS API with country PH and selected year. No local holiday rows/dataset fallback. Current key is missing. |
| 6(b)(ii) | Async fetch of selected year's official dataset | **Partial** | React effect fetches on selected-year change and aborts superseded requests. Mocked request tests pass, but no live dataset has been fetched or checked against official announcements. |
| 6(b)(iii) | Regular, Special Non-Working and Islamic categories | Verified code; **live data unverified** | Provider `primary_type` determines regular/special non-working classification. Islamic public holidays get an extra badge/category. Unknown classification fails explicitly; working/local/observance entries are excluded. Real provider shape and coverage for all eight years remain unverified. |
| 6(c)(i) | Available in View More calendar/holiday tab | Verified code; **operation partial** | CTA, overview card and holiday navigation open the same view; the actual calendar cannot render live holidays in the current environment. |
| 6(c)(ii) | Distinct Regular vs Special Non-Working badges | Verified code; visual/live QA unverified | Green Regular and amber Special Non-Working badges; purple Islamic badges. |
| 6(c)(iii) | Responsive cards/table on all devices | Verified code; **device QA unverified** | Holiday cards use one/two/three-column grid at different widths. Actual responsive rendering is unverified. |

## Remaining acceptance work

1. Configure the Calendarific key server-side, restart the backend, and verify successful fetching for each year **2020 through 2027**, including correct classification of real provider records. Compare the returned dataset with the official announcements relevant to the application's scope.
2. Configure an HTTPS application origin, production CSRF secret and TLS 1.3 certificates or trusted proxy. Test a real TLS 1.3 request and rejection of HTTP/older TLS. The local development HTTP configuration cannot satisfy the strict transport item.
3. Complete an actual registration and verification cycle with received email/SMS; exercise the third-login-failure alert and received unlock link after the two-minute cooldown. Check relevant international numbers if supported users include other countries.
4. Connect a browser and verify phone, tablet, laptop and ultrawide layouts, hero contrast/cropping, hamburger/profile dropdown, tab switching, modal scrolling, focus behavior and logout.
5. Confirm literal schema naming if required: the recorded verification_tokens.expired_at is implemented as expires_at; behavior and TIMESTAMP constraints pass. Other source typo normalizations are documented.

Updated after the two requested code adjustments, the full automated run and current live read-only checks. All recorded source items are assessed in the [75-row report](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md); incomplete operation, delivery and browser verification are still open.
