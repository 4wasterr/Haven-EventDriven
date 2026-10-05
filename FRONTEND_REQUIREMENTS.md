# Frontend requirements clarified from the pasted blueprint

This document translates the supplied **Comprehensive Application Requirements & Blueprint**, sections 1–6, into implementation instructions. Sections 9–10 record the implementation and remaining configuration. Express/MariaDB handles accounts, Brevo sends email, iProg sends SMS OTPs, and Calendarific supplies Philippine holidays. [REQUIREMENTS_AUDIT.md](REQUIREMENTS_AUDIT.md) records the code and verification evidence.

Every source requirement is mapped individually in section 11. **Documentation coverage and implementation completion are separate:** that mapping confirms the instructions cover the source; section 10 distinguishes implemented behavior from remaining provider and deployment setup. Suggested routes, the recommended verification sequence, and additional usability behavior are implementation recommendations beyond the source's explicit wording.

## 1. Is the current frontend a 1:1 match?

**The frontend now implements the required screens and interactive UI. Full application compliance remains dependent on live services.** Registration, Login, email verification, mobile verification, account unlocking, Dashboard, Profile, and Settings are separate client routes. View More opens a real overlay modal with Accounts and Calendars/Holidays tabs.

Field validation, password suggestions, country-dependent dropdowns and phone prefixes, countdowns, attempt limits, hamburger navigation, profile dropdown, logout, calendar navigation, year selection, category filters, and display states are implemented. Verification, login, lockout and logout use local server APIs and database state. Brevo provides registration emails, email verification, unlock alerts, and a protected `/send-email` form. iProg delivers Haven's random six-digit OTPs. Calendarific supplies classified Philippine holidays when its server-side key is configured.

The source specifies fields, behavior, security, and some layout features. It provides no reference screenshot or exact visual design, so “1:1” should mean **each requirement has an implemented, verifiable counterpart**, rather than pixel matching. A numerical completion percentage would require a defined scoring method.

## 2. Which parts should be separate pages?

**Registration and login should be separate screens, followed by a protected post-login landing screen. Verification and account unlocking should appear at the relevant step in that flow. Accounts and Calendars/Holidays must be tabs inside an overlay modal on the landing page.**

The source calls these forms, workflows, and a post-login landing page; it does not prescribe URL paths, a router library, or separate HTML files. The routes below are an implementation recommendation. A React single-page application can still have separate routed pages.

| Screen / component | Suggested route or location | Required purpose |
| --- | --- | --- |
| Registration page | `/register` | Collect and validate the registration fields. Link to login. |
| Login page | `/login` | Submit credentials, show appropriate states, and redirect after successful authentication. Link to registration. |
| Email verification screen | `/verify-email` | Show the pending-email state after registration and the processing/success/invalid/expired states when the emailed link is opened. |
| Mobile verification screen | `/verify-mobile` | Accept a six-digit SMS OTP; show expiry, attempts, resend, and lockout states. |
| Account unlock screen | `/unlock-account` | Handle the emailed unlock link and its two-minute waiting period. |
| Post-login landing / dashboard | `/dashboard` | Show the hero image, navigation, profile dropdown, Logout, and View More button after authentication. |
| Workspace modal | Overlay on `/dashboard` | Contain the Accounts tab and the Calendars/Holidays tab. Display the selected tab's content. |
| Profile and Settings destinations | Routes or authenticated views chosen during implementation | Provide the navigation destinations named in the source. Their detailed contents are not specified. |

The **Philippine Holidays navigation link should open the workspace modal with Calendars/Holidays selected**. The source requires that navigation link and modal access; it does not require an additional standalone holidays page. Dashboard can be the landing page because the source does not define a second dashboard screen.

### Recommended sequence

1. Open Registration or Login as its own page.
2. Submit a valid registration. After the server creates the unverified account and sends its email, show the pending-email screen.
3. Open the emailed verification link. After the server confirms it, proceed to mobile verification.
4. Complete mobile verification, then proceed to Login.
5. On successful login, open the protected landing page.
6. Click View More to open the tabbed workspace modal. The navigation's holiday link opens the same modal on its holiday tab.
7. After three consecutive failed login attempts, follow the security email's unlock link. Unlocking becomes eligible after two minutes and still requires server verification.

The source explicitly blocks login before **email verification**. Requiring **both email and mobile verification** before landing access is the recommended interpretation of the complete registration flow, but the source does not explicitly state that mobile verification is also a login prerequisite.

## 3. Registration page instructions

Source: section 1(a).

Use a real submission form. Mark required fields, associate labels with inputs, display field-specific validation errors, and preserve entered values when a correctable error occurs. Client validation provides feedback; the server must repeat the relevant checks before accepting registration.

| Field / control | Required rule |
| --- | --- |
| First name | Required; 2–50 characters; alphabetical characters, spaces, hyphens, and apostrophes only. |
| Last name | Same rules as first name. |
| Middle initial | Optional; maximum two characters, with an optional trailing period. Examples: `A`, `A.`. See the interpretation note below. |
| Birthday | Required **text input**, strictly `MM/DD/YYYY`; no date picker. Reject impossible calendar dates, future birthdays, and users younger than 13. Calculate actual age rather than comparing years alone. |
| Password | Required; minimum 12 characters, including at least one uppercase letter, lowercase letter, number, and special character. |
| Suggest a strong password | Working control that generates and suggests a password satisfying the required rules. |
| Confirm password | Required; exactly matches Password. |
| House & street | Required alphanumeric text with standard punctuation. |
| Country | Required dropdown or verified text field. Its selection determines phone prefix and postal validation. |
| City | Required dropdown or verified text field. A free-text placeholder alone does not implement verification. |
| State / province | Required dropdown or verified text field. |
| ZIP / postal code | Required dropdown or verified text field; must match the selected country's postal format. |
| Email | Required valid email address from a public provider; reject custom/corporate domains. Server checks database uniqueness. Gmail, Outlook, Yahoo, and iCloud are examples, not a complete provider list. |
| Mobile number | Required; update the displayed country-code prefix when Country changes and validate against that country's national numbering plan. Philippines uses `+63` followed by a ten-digit national number. |

**Unspecified details:** the source does not explicitly settle whether a two-letter middle initial is accepted; preserve its maximum-two-character rule and identify any more restrictive interpretation separately. Decide and document the supported public email providers, countries, address verification source, and permitted address punctuation; the source does not enumerate them.

During submission, display a pending state and prevent duplicate submissions. Show success only after the server accepts registration. Handle the server's duplicate-email, validation, and rate-limit responses. These interaction states make the source's submission workflow usable.

## 4. Email and mobile verification instructions

Source: section 2.

### Email verification

- After successful registration, the account is unverified and cannot log in until email verification succeeds.
- The server generates a cryptographically secure verification token valid for **24 hours** and dispatches the verification email.
- The frontend's pending screen tells the user to check their inbox. The actual verification action uses the emailed secure link and server validation.
- The link destination displays processing, success, invalid-link, and expired-link states, then provides the next step after successful verification.

The required email content, with the pasted formatting cleaned up, is:

> **Subject:** Action Required: Verify your email address for [Application Name]
>
> Dear: [First Name]
>
> Thank you for registering with [Application Name]. We are thrilled to welcome you to our community.
>
> To ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:
>
> **[Verify My Email Address]** — [Secure Link]
>
> If you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.
>
> Warm regards,
>
> The [Application Name] Security Team

### Mobile verification

- Trigger an SMS OTP to the provided mobile number immediately after email verification, following the recommended sequence. The source also permits it as a secondary step.
- Accept exactly **six numeric digits**. One input or six coordinated inputs can satisfy this; six separate boxes are not required.
- The OTP expires after **five minutes**.
- Allow at most **three entry attempts** before lockout. The server owns the attempt counter and lockout decision.
- Disable Resend OTP for **60 seconds**, then enable it. Use server-issued timing information so refreshing the page does not bypass the restriction.
- Show invalid-code, expired-code, locked, resend-pending, and success states.
- Format the SMS expiry and mobile-verification date/time displays for the selected country's time zone; use **Asia/Manila** for the Philippines. OTP expiry is five elapsed minutes. The source does not specify the exact display format or how to select a time zone for countries with multiple zones; document that selection policy separately.

The implemented SMS body is `Haven`, `Your OTP is <six random digits>`, followed by `Expires at <localized date/time> (<time zone>). Valid for 5 minutes.` The SMS and UI use the selected province/state's time zone when available, otherwise the registered country's default zone. Both use the same persisted UTC deadline. The sender name shown by the phone requires approval of Haven in the iProg account.

The source does not specify the duration or recovery process for an OTP lockout. Do not assume the login unlock email also handles OTP lockout.

## 5. Login and account unlock instructions

Source: section 3.

- Require an email with standard email formatting and a nonempty password.
- Keep the login password check limited to presence/nonempty length. The 12-character composition rule belongs to registration.
- The server checks whether the account is locked, confirms the email exists in the database and is verified, verifies active status, and compares the password hash.
- Show a generic credential failure such as **“Invalid email or password.”** Do not disclose whether an email exists or whether the password specifically was wrong.
- Track incorrect login attempts per account/email on the server. After **three consecutive failures**, lock access and immediately send an automated security alert to the user's registered email address containing an account unlock link.
- On the unlock screen, show the remaining **two-minute cooldown** and disable unlocking until the server says it is eligible.
- **Two minutes permits verification/unlocking; it does not automatically unlock the account.** The server must validate the unlock request/link.
- After successful login, the server issues a session token and the frontend redirects to the landing page.
- Logout must invalidate the session through the authentication system and return the user to Login.

Keep a pending login/verification state while requests run. Protected content must depend on server-confirmed authentication. A frontend route guard alone does not secure accounts or their data.

### Exact login process from the source

1. User enters credentials.
2. Client validates format and nonempty password length.
3. Server checks whether the account is locked.
4. Server verifies email and active status.
5. Server compares the password hash.
6. On failure, increment the failed-attempt counter.
7. At three consecutive failures, lock the account and dispatch the unlock email, enforcing the two-minute cooldown.
8. On success, issue the session token and redirect to the landing page.

## 6. Post-login landing page and modal instructions

Source: section 5.

### Landing page

- Use a high-resolution, responsive hero/background image with a semitransparent dark overlay so foreground text is readable.
- Provide a sticky or fixed floating top navigation bar containing the logo, Dashboard, Profile, Settings, Philippine Holidays, and a profile dropdown with a secure Logout action.
- Collapse the navigation into a working **hamburger menu** on smaller screens.
- Place prominent CTA buttons centrally or left-aligned, including a **primary View More** button. The source does not specify the other CTA labels or actions.
- Build mobile-first using Flexbox/Grid and fluid media queries. Verify smartphones, tablets, laptops, and ultra-wide desktop layouts.

### Workspace modal

- Clicking View More opens an actual overlay dialog on the landing page.
- Provide an **Accounts** tab showing accessible user accounts as a list or table.
- Provide a **Calendars/Holidays** tab showing the integrated calendar and Philippine holiday selector.
- Switching tabs changes the displayed panel; anchor links to two always-visible sections do not implement this behavior.
- Support closing the modal and returning to the landing page.
- As implementation usability requirements, provide a labelled dialog, keyboard-operable tabs, focus handling, Escape-to-close, and a visible close button.
- Show only accounts the authenticated user is authorized to access. The source does not define roles, permissions, account editing, or a requirement to expose all registered users.

## 7. Philippine holiday feature instructions

Source: section 6.

- Put the feature inside the workspace modal's Calendars/Holidays tab.
- Tailor this module to the Philippine jurisdiction, **Asia/Manila** time zone, and **+63** country-code context. Registration must still support its selected country's phone prefix and address rules.
- Provide a year dropdown containing **every year from 2020 through 2027 inclusive**.
- Fetch the **official Philippine holiday dataset for the selected year** asynchronously from an **external public holiday API** when that year changes. As an implementation recommendation, fetch the initial selected year when the feature is opened as well.
- Provide an integrated calendar plus a responsive holiday card or table display, consistent with sections 5(d) and 6(c).
- Categorize and clearly display **Regular Holidays**, **Special Non-Working Days**, and **Islamic Holidays**. If the API supplies overlapping categories, preserve the relevant labels instead of dropping the Islamic identification.
- Use distinct badges for Regular Holidays and Special Non-Working Days, and visibly identify Islamic holidays.
- Show loading, empty, request-error/retry, and success states. An older request must not replace the results for a newer year selection.
- Query the external API dynamically rather than storing holiday records in the local application database or using a hardcoded holiday list as the completed feature.

The source does not name an API provider. Select one that covers the required years and Philippine classifications, or document a reliable mapping from its metadata. Do not silently guess legal holiday categories when the provider's data is insufficient.

## 8. Backend, infrastructure, and database dependencies

Source: sections 1(b), 2, 3, and 4. These belong in the full application requirements, but these must be enforced by the backend as well as represented in the frontend.

| Responsibility | Required implementation |
| --- | --- |
| Transport / deployment | Enforce HTTPS with TLS 1.3 for payload submission. |
| Password storage | Hash on the server using Argon2id or bcrypt with a high work factor; never store plaintext passwords. |
| Registration rate limit | Enforce at most five registration requests per IP address per hour. Count invalid fields, malformed JSON, duplicates, configuration failures and rolled-back writes. Persist the quota separately from account creation. Reject missing/invalid CSRF before consuming the quota. |
| CSRF protection | Supply and validate anti-CSRF tokens for registration; the frontend submits the token using the server's contract. |
| Email and uniqueness | Validate public-provider eligibility and uniqueness against the database. |
| Verification | Generate and validate email/unlock tokens and SMS OTPs; enforce expiry, attempts, and resend restrictions; dispatch email and SMS. |
| Authentication | Enforce account status/lockout, compare password hashes, issue sessions, and securely invalidate them on Logout. |
| Account access | Authorize access to the accounts displayed in the modal. |

### Database schema from the source

Preserve the supplied data requirements. The spellings below correct obvious transcription errors such as `ysers`, `VACHAR`, `mobile_verfied`, and `bycrypt`; they do not add new user-facing features.

- **users:** `id` UUID primary key; required `first_name` and `last_name` VARCHAR(50); nullable `middle_initial` VARCHAR(2); required `birthday` DATE, `password_hash` VARCHAR(255), unique/indexed `email` VARCHAR(255), and `mobile_number` VARCHAR(20); nullable `email_verified_at` TIMESTAMP; `mobile_verified` BOOLEAN default false; `failed_login_attempts` INT default 0; `is_locked` BOOLEAN default false; nullable `lockout_until` TIMESTAMP; `created_at` and `updated_at` TIMESTAMP.
- **addresses:** `id` UUID primary key; `user_id` UUID foreign key to `users.id` with cascading delete; required `house_street` VARCHAR(255), `country`, `city`, and `state` VARCHAR(100), and `zip_code` VARCHAR(20).
- **verification_tokens:** `id` UUID primary key; `user_id` UUID foreign key; required `token_hash` VARCHAR(255); `type` enum containing `email_verify`, `mobile_otp`, `password_reset`, and `account_unlock`; required `expired_at` TIMESTAMP.

The schema alone does not describe storage for every OTP attempt/resend or unlock timing state. Add the server-side state needed to enforce the workflows. The `password_reset` enum value does not by itself specify a password-reset screen or workflow.

## 9. Current implementation audit

Current verification passes: 67 backend tests including the rolled-back actual MariaDB workflow, 16 frontend tests and the production build. Outbound message delivery is simulated in tests. Native computer-use is unavailable and browser inventory is empty, so browser/device QA remains pending. The [one-to-one check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md) records one assessment for each of the 75 source items.

| Requirement | Current implementation | Remaining setup or limitation |
| --- | --- | --- |
| Registration and validation | Forms call the API; the server repeats validation, hashes passwords with bcrypt work factor 12 and enforces email uniqueness. Address choices include 250 countries/territories and 5,260 subdivisions; cities and postal codes load by selection. Caloocan has 23 labeled ZIP codes. | Postal directories cover 125 countries; other locations use country-format validation. Some subdivisions lack city records. Individual street delivery is not verified. See `backend/ADDRESS_DATA.md`. |
| Registration security | Signed CSRF tokens, database-backed five-request-per-IP hourly limit that retains failed attempts, countdown feedback, and production TLS 1.3 enforcement before payload parsing. | Production needs certificates or a trusted TLS 1.3 proxy, HTTPS origin and persistent strong CSRF secret. Loopback development uses HTTP. |
| Email verification | Brevo sends 24-hour verification links; confirmation requires the emailed token and then requests SMS OTP delivery. | Configure a Brevo API key and verified sender, plus iProg SMS credentials. |
| Mobile verification | Haven generates six random digits, stores a salted hash and validates locally; iProg sends SMS. Five-minute expiry, three incorrect attempts and 60-second resend are enforced in MariaDB. | Configure `IPROG_API_TOKEN` and approve the Haven sender name in iProg. Philippine delivery is documented by iProg; international delivery remains unverified. |
| Login and unlock | Lock and email/active eligibility checks precede stored-hash comparison; unverified-email rejections leave failure counters and sessions unchanged. Generic credential errors, three-failure lockout, Brevo unlock alerts, two-minute cooldown and one-use tokens. | Live alert receipt remains unverified; active eligibility uses lock/verification state because no separate is_active field is specified. |
| Sessions and logout | Database-backed tokens in HttpOnly cookies; server logout invalidates the token. | Authenticated sessions last eight hours; pending verification sessions 24 hours. |
| Landing and navigation | Responsive hero, dark overlay, floating menu, profile dropdown, hamburger and View More modal. | Visual and keyboard browser QA remains pending. |
| Accounts | API-authorized account data; users see their own accessible account. | No administrator or cross-account permission model is specified. |
| Holidays | Authenticated Calendarific requests for 2020–2027, provider-based regular/special classification, Islamic badges, responsive calendar/cards, attribution and unavailable/retry states. No local holiday datasets. | `CALENDARIFIC_API_KEY` is not configured locally, so live fetching and current dataset coverage remain unverified. Future dates depend on official announcements and provider updates. |

The system has no seeded sign-in credentials, browser authentication store, exposed verification codes, email/SMS previews or hardcoded holiday fixtures. Browser storage contains display preferences only. The original browser account store is removed once when upgrading.

## 10. Completion checklist

- [x] Keep local account routes, server validation, password hashing and MariaDB state.
- [x] Repeat validation and hash passwords on the server.
- [x] Store sessions, verification tokens, attempt budgets, cooldowns and registration rate limits in MariaDB.
- [x] Require signed CSRF tokens and protect authenticated account/holiday endpoints.
- [x] Connect Brevo for verification links, unlock alerts and the protected Send email form.
- [x] Connect iProg SMS to the random six-digit OTP flow and enforce expiry, attempts, resend cooldown and single use locally.
- [x] Show unavailable states when an integration is unconfigured or fails.
- [x] Keep address snapshots and the dashboard image local.
- [x] Remove sample credentials and verification/holiday preview controls.
- [x] Connect Calendarific Philippine holidays and test year requests, classifications and failure handling.
- [ ] Configure `CALENDARIFIC_API_KEY` and verify live 2020–2027 datasets.
- [ ] Configure production HTTPS/TLS 1.3 and conduct browser/device QA.
- [x] Check the live Brevo verified sender and iProg account without sending messages.
- [ ] Verify real email/SMS delivery and iProg sender approval in the user's own registration flow.

See README.md for configuration and checks. Email and SMS account checks passed; no real messages were sent. Holiday code is implemented, but its key is still needed. No browser is connected for device and keyboard QA.

## 11. One-to-one source coverage

Current implementation assessment: [75-item one-to-one check](REQUIREMENTS_1_TO_1_CHECK_2026-10-06.md). All 75 recorded IDs have exactly one assessment; partial/unverified rows remain open. The recorded expired_at spelling is normalized to expires_at in the implementation and is flagged for literal grading.

**Every source entry containing a substantive requirement is covered below.** Parent entries are included when they contain instructions in addition to their numbered children, and section 2(b)'s complete email template has its own row. This is a documentation coverage check, not a claim that the application passes implementation checks. Section references point to this document. Backend-only items are retained as dependencies rather than silently omitted from the frontend instructions.

| Source item | Requirement covered | Instruction location |
| --- | --- | --- |
| 1(a)(i) | Required first/last names; allowed characters; 2–50 characters. | Section 3, name fields. |
| 1(a)(ii) | Optional middle initial; maximum two characters; optional trailing period. | Section 3, middle initial and unspecified details. |
| 1(a)(iii) | Required birthday text; MM/DD/YYYY; no date picker; valid date; age at least 13. | Section 3, birthday. |
| 1(a)(iv) | Required password; 12+ characters; uppercase, lowercase, number, special character; strong password suggestion. | Section 3, password and suggestion. |
| 1(a)(v) | Confirm Password exactly matches Password. | Section 3, confirm password. |
| 1(a)(vi)(1) | Required alphanumeric house/street with standard punctuation. | Section 3, house/street. |
| 1(a)(vi)(2) | Required country/city/state/ZIP dropdowns or verified text; country-specific postal format. | Section 3, address fields. |
| 1(a)(vii) | Required public-provider email; reject custom/corporate domains; database uniqueness. | Sections 3 and 8. |
| 1(a)(viii) | Required mobile; selected-country prefix; national numbering validation; Philippine +63 and ten digits. | Section 3, mobile. |
| 1(b)(i) | Strict HTTPS/TLS 1.3 for payload submission. | Section 8, transport/deployment dependency. |
| 1(b)(ii) | Server-side Argon2id or bcrypt with high work factor; no plaintext password storage. | Section 8, password-storage dependency. |
| 1(b)(iii) | At most five registration requests per IP per hour. | Sections 3 and 8, rate-limit response and enforcement. |
| 1(b)(iv) | Registration anti-CSRF token. | Section 8, frontend submission and server validation. |
| 2(a)(i) | Registered account unverified; login restricted before email verification. | Section 4, email verification. |
| 2(a)(ii) | Cryptographically secure email token; 24-hour expiry; verification email delivery. | Sections 4 and 8. |
| 2(b) | Complete professional email: subject, greeting, welcome, explanation, secure Verify My Email Address link, disregard/expiry notice, sign-off. | Section 4, email template. |
| 2(c)(i) | SMS OTP after email verification or as secondary step; provided mobile number; country time-zone formatting. | Section 4, mobile verification; section 2, recommended sequence. |
| 2(c)(i)(1) | Six numeric digits; five-minute validity; three attempts before lockout; Resend OTP after 60 seconds. | Section 4, mobile verification. |
| 3(a)(i) | Required standard-format email; database existence; verified account. | Section 5, login validation and server checks. |
| 3(a)(ii) | Required nonempty password; client-side length check only. | Section 5, login password validation. |
| 3(b)(i) | Track incorrect login attempts per account/email. | Section 5, server attempt counter. |
| 3(b)(ii) | Lock account/system access at three consecutive failed logins. | Section 5, lockout threshold. |
| 3(b)(iii)(1) | Immediately send automated security alert to registered email with unlock link. | Section 5, security email. |
| 3(b)(iii)(2) | Enforce two-minute cooldown before verification/unlock is permitted. | Section 5, unlock screen and server enforcement. |
| 3(b)(iv) | Generic failure messages to prevent email/password disclosure. | Section 5, credential error. |
| 3(c)(1) | User enters credentials. | Section 5, exact login process step 1. |
| 3(c)(2) | Client validates format. | Section 5, exact login process step 2. |
| 3(c)(3) | Server checks account lock. | Section 5, exact login process step 3. |
| 3(c)(4) | Server verifies email and active status. | Section 5, exact login process step 4. |
| 3(c)(5) | Server compares password hash. | Section 5, exact login process step 5. |
| 3(c)(6) | Increment failed-attempt counter on failure. | Section 5, exact login process step 6. |
| 3(c)(7) | At three failures, lock, send unlock email, enforce two-minute cooldown. | Section 5, exact login process step 7. |
| 3(c)(8) | Successful login issues session token and redirects to landing. | Section 5, exact login process step 8. |
| 4(a)(i)(1) | users.id: UUID primary key. | Section 8, users schema. |
| 4(a)(i)(2) | users.first_name: VARCHAR(50), not null. | Section 8, users schema. |
| 4(a)(i)(3) | users.last_name: VARCHAR(50), not null. | Section 8, users schema. |
| 4(a)(i)(4) | users.middle_initial: VARCHAR(2), nullable. | Section 8, users schema. |
| 4(a)(i)(5) | users.birthday: DATE, not null. | Section 8, users schema. |
| 4(a)(i)(6) | users.password_hash: VARCHAR(255), not null. | Section 8, users schema. |
| 4(a)(i)(7) | users.email: VARCHAR(255), unique, indexed, not null. | Section 8, users schema. |
| 4(a)(i)(8) | users.email_verified_at: TIMESTAMP, nullable. | Section 8, users schema. |
| 4(a)(i)(9) | users.mobile_number: VARCHAR(20), not null. | Section 8, users schema. |
| 4(a)(i)(10) | users.mobile_verified: BOOLEAN, default false; spelling corrected. | Section 8, users schema. |
| 4(a)(i)(11) | users.failed_login_attempts: INT, default 0. | Section 8, users schema. |
| 4(a)(i)(12) | users.is_locked: BOOLEAN, default false. | Section 8, users schema. |
| 4(a)(i)(13) | users.lockout_until: TIMESTAMP, nullable. | Section 8, users schema. |
| 4(a)(i)(14) | users.created_at and updated_at: TIMESTAMP. | Section 8, users schema. |
| 4(a)(ii)(1) | addresses.id: UUID primary key. | Section 8, addresses schema. |
| 4(a)(ii)(2) | addresses.user_id: UUID foreign key to users.id, cascading delete; reference typo corrected. | Section 8, addresses schema. |
| 4(a)(ii)(3) | addresses.house_street: VARCHAR(255), not null. | Section 8, addresses schema. |
| 4(a)(ii)(4) | addresses.country: VARCHAR(100), not null. | Section 8, addresses schema. |
| 4(a)(ii)(5) | addresses.city: VARCHAR(100), not null. | Section 8, addresses schema. |
| 4(a)(ii)(6) | addresses.state: VARCHAR(100), not null. | Section 8, addresses schema. |
| 4(a)(ii)(7) | addresses.zip_code: VARCHAR(20), not null. | Section 8, addresses schema. |
| 4(a)(iii)(1) | verification_tokens.id: UUID primary key. | Section 8, verification_tokens schema. |
| 4(a)(iii)(2) | verification_tokens.user_id: UUID foreign key. | Section 8, verification_tokens schema. |
| 4(a)(iii)(3) | verification_tokens.token_hash: VARCHAR(255), not null. | Section 8, verification_tokens schema. |
| 4(a)(iii)(4) | verification_tokens.type: email_verify, mobile_otp, password_reset, account_unlock enum. | Section 8, verification_tokens schema. |
| 4(a)(iii)(5) | verification_tokens.expired_at: TIMESTAMP, not null. | Section 8, verification_tokens schema. |
| 5(a) | High-resolution responsive image background; semitransparent dark overlay; readable foreground across viewports. | Section 6, landing page. |
| 5(b) | Floating sticky/fixed nav; logo; Dashboard, Profile, Settings, Philippine Holidays; profile dropdown; secure Logout; mobile hamburger. | Section 6, navigation; section 5, Logout. |
| 5(c) | Prominent centered or left-aligned CTAs including primary View More. | Section 6, landing CTA. |
| 5(d)(i) | View More opens an overlay modal on the landing page. | Section 6, workspace modal. |
| 5(d)(ii) | Clean tabbed interface allowing users to switch between views. | Section 6, selected-panel switching. |
| 5(d)(ii)(1) | Accounts tab lists/tables accessible user accounts. | Section 6, Accounts tab. |
| 5(d)(ii)(2) | Calendars/Holidays tab includes integrated calendar and API-driven Philippine holiday selector. | Sections 6 and 7. |
| 5(e) | Mobile-first Flexbox/Grid and fluid media queries for smartphones, tablets, laptops, ultra-wide monitors. | Section 6, responsive layout. |
| 6(a)(i) | Philippine jurisdiction, Asia/Manila, +63 context. | Section 7, localization. |
| 6(a)(ii) | Selectable historical/near-future years 2020–2027. | Section 7, year dropdown. |
| 6(b)(i) | Query external public holiday API dynamically; no local holiday database storage. | Section 7, data source. |
| 6(b)(ii) | Modal year change asynchronously fetches that year's official Philippine holiday dataset. | Section 7, year fetching. |
| 6(b)(iii) | Categorize/display Regular, Special Non-Working, and Islamic Holidays clearly. | Section 7, classifications. |
| 6(c)(i) | Easily accessible through landing View More modal's calendar/holiday tab. | Sections 2, 6, and 7. |
| 6(c)(ii) | Visually distinct Regular versus Special Non-Working badges. | Section 7, badges. |
| 6(c)(iii) | Responsive holiday cards or table across device types. | Section 7, holiday layout; section 6, device verification. |
