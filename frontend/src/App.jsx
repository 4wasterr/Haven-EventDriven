import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { COUNTRIES, normalizeEmail, passwordRules, suggestPassword, validateLogin, validateRegistration } from './validation.mjs';
import { DEMO_CREDENTIALS, STORAGE_KEY, attemptLogin, countdown, createAccount, formatTime, initialDemo, resendOtp, timeZoneFor, unlockAccount, verifyEmail, verifyOtp } from './demo.mjs';
import { CATEGORIES, YEARS, calendarCells, previewHolidays } from './holiday-preview.mjs';

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);
const pause = (milliseconds = 450) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const initials = (account) => `${account.firstName[0]}${account.lastName[0]}`;
const fullName = (account) => `${account.firstName} ${account.middleInitial ? `${account.middleInitial} ` : ''}${account.lastName}`;

function useRoute() {
  const [location, setLocation] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const update = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const navigate = (path, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setLocation(path);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return { location, navigate, path: location.split('?')[0], query: new URLSearchParams(location.split('?')[1] || '') };
}

function Link({ to, children, onClick, ...props }) {
  const { navigate } = useApp();
  return <a href={to} {...props} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); navigate(to);
    }
  }}>{children}</a>;
}

function Brand() { return <Link className="brand" to="/dashboard"><span className="brand-mark" aria-hidden="true">h.</span>haven<span className="brand-dot">.</span></Link>; }
function Notice({ children, type = 'error' }) { return children ? <div className={`notice ${type}`} role={type === 'error' ? 'alert' : 'status'}>{children}</div> : null; }
function DemoNote() { return <span className="demo-label">Frontend demo · use sample details</span>; }
function Footer() { return <footer><span className="brand">haven.</span><p>A little space for your everyday.</p><span>PHILIPPINES · ASIA / MANILA</span></footer>; }
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}

function Field({ name, label, value, onChange, error, hint, required = true, options, prefix, ...props }) {
  const description = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean).join(' ') || undefined;
  const inputProps = { id: name, name, value, onChange: (event) => onChange(event.target.value), required, 'aria-invalid': Boolean(error), 'aria-describedby': description, ...props };
  return <div className={`field ${error ? 'has-error' : ''}`}>
    <label htmlFor={name}>{label} {required ? <span aria-hidden="true">*</span> : <small>(optional)</small>}</label>
    {options ? <select {...inputProps}><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value || option} value={option.value || option}>{option.label || option}</option>)}</select>
      : prefix ? <div className="phone-input"><span aria-hidden="true">{prefix}</span><input {...inputProps} aria-label={`${label}, country code ${prefix}`} /></div>
        : <input {...inputProps} />}
    {hint && <small className="field-hint" id={`${name}-hint`}>{hint}</small>}
    {error && <small className="field-error" id={`${name}-error`}>{error}</small>}
  </div>;
}

function focusError(errors) { requestAnimationFrame(() => document.getElementById(Object.keys(errors)[0])?.focus()); }

function AuthShell({ children, step, wide = false }) {
  return <div className="public-layout"><header className="public-header"><Brand /><DemoNote /><Link className="text-link" to="/login">Sign in ↗</Link></header>
    <main id="main-content" className={`auth-main ${wide ? 'wide' : ''}`}>
      {step && <ol className="steps" aria-label="Registration progress">{['Your details', 'Verify email', 'Verify mobile'].map((title, index) => <li key={title} className={step === index + 1 ? 'current' : step > index + 1 ? 'complete' : ''} aria-current={step === index + 1 ? 'step' : undefined}><span>{step > index + 1 ? '✓' : `0${index + 1}`}</span>{title}</li>)}</ol>}
      {children}
    </main><div className="footer-wrap"><Footer /></div></div>;
}

function Registration() {
  const { demo, setDemo, navigate } = useApp();
  const [values, setValues] = useState({ firstName: '', lastName: '', middleInitial: '', birthday: '', email: '', mobile: '', houseStreet: '', country: 'PH', region: '', city: '', postal: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [generated, setGenerated] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const country = COUNTRIES[values.country];
  const region = country?.regions[values.region];
  function change(name, value) {
    const resets = name === 'country' ? { region: '', city: '', postal: '', mobile: '' } : name === 'region' ? { city: '', postal: '' } : name === 'city' ? { postal: '' } : {};
    setValues((previous) => ({ ...previous, ...resets, [name]: value }));
    setErrors((previous) => { const next = { ...previous }; for (const key of [name, ...Object.keys(resets)]) delete next[key]; return next; });
    setMessage('');
    if (name === 'password') setGenerated('');
  }
  const field = (name, label, props = {}) => <Field name={name} label={label} value={values[name]} onChange={(value) => change(name, value)} error={errors[name]} {...props} />;
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateRegistration(values);
    if (demo.accounts.some((account) => account.email === normalizeEmail(values.email))) nextErrors.email = 'This email is already registered in this demo. Sign in or use another sample address.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setMessage('Please correct the highlighted fields.'); focusError(nextErrors); return; }
    const recentRequests = demo.registrationRequests.filter((timestamp) => timestamp > Date.now() - 3600000);
    if (recentRequests.length >= 5) { setMessage('Demo registration limit reached: five submissions per hour. Please try again later.'); return; }
    setBusy(true); setMessage('');
    try {
      const account = await createAccount(values);
      await pause();
      setDemo((previous) => ({ ...previous, accounts: [...previous.accounts, account], pendingId: account.id, registrationRequests: [...recentRequests, Date.now()] }));
      navigate('/verify-email');
    } catch { setMessage('The demo could not create your account. Please try again.'); }
    finally { setBusy(false); }
  }
  function suggest() {
    const password = suggestPassword();
    setValues((previous) => ({ ...previous, password, confirmPassword: password }));
    setErrors((previous) => ({ ...previous, password: '', confirmPassword: '' }));
    setGenerated(password);
  }
  return <AuthShell step={1} wide><section className="registration-layout"><div className="section-intro"><p className="eyebrow">MAKE YOURSELF AT HOME</p><h1>A new beginning<br />starts here.</h1><p>One account for a more organized everyday.</p><div className="intro-note"><span>01 /</span><p>Your details<br /><small>Then verify your email and mobile.</small></p></div><Link className="text-link" to="/login">Already have an account? Sign in ↗</Link></div>
    <div className="form-card"><div className="form-title"><h2>Create your account</h2><span className="small-note">* Required fields</span></div><p className="form-description">A few details, and you’re on your way.</p><Notice>{message}</Notice>
      <form onSubmit={submit} noValidate aria-label="Registration"><fieldset disabled={busy}><legend className="sr-only">Registration details</legend>
        <h3 className="form-section-title">About you</h3><div className="form-grid">{field('firstName', 'First name', { autoComplete: 'given-name', maxLength: 50, placeholder: 'Alex' })}{field('lastName', 'Last name', { autoComplete: 'family-name', maxLength: 50, placeholder: 'Lopez' })}{field('middleInitial', 'Middle initial', { required: false, maxLength: 2, placeholder: 'M.', autoComplete: 'additional-name' })}{field('birthday', 'Birthday', { type: 'text', inputMode: 'numeric', maxLength: 10, placeholder: 'MM/DD/YYYY', hint: 'MM/DD/YYYY · You must be 13 or older.' })}</div>
        <h3 className="form-section-title">Your address</h3>{field('houseStreet', 'House & street', { autoComplete: 'street-address', maxLength: 255, placeholder: '24 Palm Street, Barangay San Antonio' })}<div className="form-grid address-grid">{field('country', 'Country', { autoComplete: 'country', options: Object.entries(COUNTRIES).map(([value, item]) => ({ value, label: item.name })) })}{field('region', 'Province / state', { autoComplete: 'address-level1', options: Object.keys(country?.regions || {}) })}{field('city', 'City', { autoComplete: 'address-level2', disabled: !region, options: Object.keys(region?.cities || {}) })}{field('postal', 'ZIP / postal code', { autoComplete: 'postal-code', disabled: !values.city, options: region?.cities[values.city] || [] })}</div><p className="field-hint">Choose from the supported locations. City and postal choices follow your province or state.</p>
        <h3 className="form-section-title">Contact details</h3><div className="form-grid">{field('email', 'Email address', { type: 'email', autoComplete: 'email', maxLength: 255, placeholder: 'you@gmail.com', hint: 'Public email providers only; company domains are not accepted.' })}{field('mobile', 'Mobile number', { type: 'tel', autoComplete: 'tel-national', inputMode: 'tel', prefix: country?.prefix, placeholder: values.country === 'PH' ? '917 123 4567' : values.country === 'GB' ? '7400 123456' : '415 555 0123', hint: country?.phoneHint })}</div>
        <h3 className="form-section-title">Keep it secure</h3><div className="form-grid">{field('password', 'Password', { type: showPassword ? 'text' : 'password', autoComplete: 'new-password', placeholder: 'Create a password' })}{field('confirmPassword', 'Confirm password', { type: showPassword ? 'text' : 'password', autoComplete: 'new-password', placeholder: 'Re-enter your password' })}</div>
        <ul className="password-rules" aria-label="Password requirements">{passwordRules(values.password).map((rule) => <li key={rule.label} className={rule.valid ? 'met' : ''}><span aria-hidden="true">{rule.valid ? '✓' : '○'}</span><span className="sr-only">{rule.valid ? 'Met: ' : 'Required: '}</span>{rule.label}</li>)}</ul>
        <div className="password-tools"><button type="button" className="text-button" onClick={suggest}>Suggest a strong password ↗</button><label className="checkbox-label"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show passwords</label></div>
        {generated && <p className="suggested-password" role="status">Suggested password: <strong>{generated}</strong><br />Both password fields have been filled.</p>}
        <button className="button primary full" type="submit">{busy ? 'Creating account…' : 'Create account'}<span aria-hidden="true">↗</span></button>
      </fieldset></form><p className="sample-note centered">Demo details stay in this browser tab. No email or SMS is sent.</p>
    </div></section></AuthShell>;
}

function Login() {
  const { demo, setDemo, updateAccount, navigate } = useApp();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alertAccount, setAlertAccount] = useState(null);
  function change(name, value) { setValues((previous) => ({ ...previous, [name]: value })); setErrors((previous) => ({ ...previous, [name]: '' })); setMessage(''); setAlertAccount(null); }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    const nextErrors = validateLogin(values); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { focusError(nextErrors); return; }
    setBusy(true); setMessage(''); setAlertAccount(null);
    try {
      const account = demo.accounts.find((item) => item.email === normalizeEmail(values.email));
      const result = await attemptLogin(account, values.password); await pause();
      if (result.account) updateAccount(result.account);
      if (result.status === 'success') { setDemo((previous) => ({ ...previous, currentId: account.id, pendingId: null })); navigate('/dashboard'); }
      else if (result.status === 'email' || result.status === 'mobile') { setDemo((previous) => ({ ...previous, pendingId: account.id })); navigate(result.status === 'email' ? '/verify-email' : '/verify-mobile'); }
      else { setMessage('Invalid email or password.'); if (result.account?.locked) setAlertAccount(result.account); }
    } catch { setMessage('The demo could not sign you in. Please try again.'); }
    finally { setBusy(false); }
  }
  return <AuthShell><section className="login-section"><div className="login-copy"><p className="eyebrow">GOOD TO SEE YOU AGAIN</p><h1>Welcome back.</h1><p>Your account, your calendar,<br />and a little room to breathe.</p><span className="decorative-orbit" aria-hidden="true">h.</span></div><div className="form-card"><h2>Sign in to Haven</h2><p className="form-description">Your everyday starts here.</p><Notice>{message}</Notice><form onSubmit={submit} noValidate aria-label="Sign in"><fieldset disabled={busy}><legend className="sr-only">Sign-in credentials</legend><Field name="email" label="Email address" type="email" autoComplete="username" value={values.email} onChange={(value) => change('email', value)} error={errors.email} placeholder="you@gmail.com" /><Field name="password" label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={values.password} onChange={(value) => change('password', value)} error={errors.password} placeholder="Enter your password" /><div className="login-options"><label className="checkbox-label"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show password</label></div><button className="button primary full" type="submit">{busy ? 'Signing in…' : 'Sign in'}<span aria-hidden="true">↗</span></button></fieldset></form><p className="sample-note centered">New around here? <Link to="/register">Create an account ↗</Link></p>
      <details className="demo-preview"><summary>Try the frontend demo</summary><p>Sample email: <strong>{DEMO_CREDENTIALS.email}</strong><br />Sample password: <strong>{DEMO_CREDENTIALS.password}</strong></p><button className="text-button" type="button" disabled={busy} onClick={() => { setValues({ ...DEMO_CREDENTIALS }); setErrors({}); setMessage(''); }}>Fill sample credentials</button><p className="sample-note">Sign-in and account protection are simulated in this tab.</p></details>
      {alertAccount && <details className="demo-preview" open><summary>Demo security email preview</summary><p><strong>Subject: Security alert — your Haven account is locked</strong></p><p>Dear {alertAccount.firstName}, your account was locked after three unsuccessful sign-in attempts. Wait two minutes, then follow this link to unlock your account.</p><Link className="button outline full" to={`/unlock-account?token=${alertAccount.unlockToken}`}>Open demo unlock link ↗</Link></details>}
    </div></section></AuthShell>;
}

function EmailVerification() {
  const { demo, query, updateAccount, setDemo, navigate } = useApp();
  const emailToken = query.get('token');
  const pending = demo.accounts.find((account) => account.id === demo.pendingId);
  const [status, setStatus] = useState(emailToken ? 'processing' : 'pending');
  const [verifiedAccount, setVerifiedAccount] = useState(null);
  useEffect(() => {
    if (!emailToken) { setStatus('pending'); return; }
    let active = true; setStatus('processing');
    const timer = setTimeout(() => {
      if (!active) return;
      const account = demo.accounts.find((item) => item.emailToken === emailToken);
      const result = verifyEmail(account, emailToken);
      if (result.account) { updateAccount(result.account); setDemo((previous) => ({ ...previous, pendingId: account.id })); setVerifiedAccount(result.account); }
      setStatus(result.status);
    }, 500);
    return () => { active = false; clearTimeout(timer); };
    // The link is processed once per token; changing demo state must not process it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailToken]);
  const account = verifiedAccount || pending;
  return <AuthShell step={2}><section className="verification-card form-card"><span className="icon" aria-hidden="true">✉</span><p className="eyebrow">EMAIL VERIFICATION</p>
    {status === 'processing' ? <><h1>Checking your link.</h1><Notice type="info">Verifying the demo email link…</Notice><div className="loader" aria-hidden="true" /></>
      : status === 'success' ? <><h1>Email verified.</h1><Notice type="success">Your email address is confirmed in this demo.</Notice><p>Next, verify the six-digit code for your mobile number.</p><button className="button primary full" onClick={() => navigate(account.mobileVerified ? '/login' : '/verify-mobile')}>{account.mobileVerified ? 'Continue to sign in' : 'Continue to mobile verification'} ↗</button></>
        : status === 'invalid' || status === 'expired' ? <><h1>{status === 'expired' ? 'This link has expired.' : 'This link is invalid.'}</h1><Notice>{status === 'expired' ? 'Email verification links are valid for 24 hours.' : 'The verification link could not be recognized.'}</Notice><Link className="button outline full" to={pending ? '/verify-email' : '/register'}>{pending ? 'Back to email details' : 'Create an account'} ↗</Link></>
          : !pending ? <><h1>No email to verify yet.</h1><p>Create an account to start the verification steps.</p><Link className="button primary full" to="/register">Create an account ↗</Link></>
            : <><h1>Check your inbox.</h1><p>Hi {pending.firstName}, open the verification link for <strong>{pending.email}</strong> to continue.</p><div className="detail-strip">Link expires {formatTime(pending.emailExpiresAt, timeZoneFor(pending))}</div><p className="sample-note">This is a frontend demonstration. Open the email preview below to try the link.</p><details className="demo-preview" open><summary>Demo verification email preview</summary><p><strong>Subject: Action Required: Verify your email address for Haven</strong></p><p>Dear {pending.firstName},</p><p>Thank you for registering with Haven. We are thrilled to welcome you to our community.</p><p>To ensure the security of your account and complete your registration, please verify your email address by clicking the secure link below:</p><Link className="button primary full" to={`/verify-email?token=${pending.emailToken}`}>Verify My Email Address ↗</Link><p>If you did not initiate this request, please disregard this message. This link will expire in 24 hours for your protection.</p><p>Warm regards,<br />The Haven Security Team</p></details></>}
    <Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
}

function MobileVerification() {
  const { demo, updateAccount } = useApp();
  const account = demo.accounts.find((item) => item.id === demo.pendingId);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const otp = account?.otp;
  const expired = otp && now >= otp.expiresAt;
  const success = account?.mobileVerified;
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    if (!/^\d{6}$/.test(code)) { setMessage('Enter exactly six numeric digits.'); document.getElementById('otp')?.focus(); return; }
    setBusy(true); setMessage(''); await pause();
    const result = verifyOtp(account, code);
    if (result.account) updateAccount(result.account);
    setMessage({ invalid: 'That code is incorrect. Please try again.', expired: 'This code has expired. Request a new code.', locked: 'Mobile verification is locked after three incorrect attempts.', missing: 'Start email verification before verifying your mobile.' }[result.status] || '');
    setBusy(false);
  }
  async function resend() {
    if (busy) return;
    setBusy(true); setMessage(''); await pause();
    const nextAccount = resendOtp(account);
    if (nextAccount) { updateAccount(nextAccount); setCode(''); }
    setBusy(false);
  }
  return <AuthShell step={3}><section className="verification-card form-card"><span className="icon" aria-hidden="true">⌁</span><p className="eyebrow">MOBILE VERIFICATION</p>
    {!account?.emailVerified || !otp ? <><h1>Verify your email first.</h1><p>Your mobile verification follows email verification.</p><Link className="button primary full" to="/verify-email">Go to email verification ↗</Link></>
      : success ? <><h1>You’re all set.</h1><Notice type="success">Your mobile number has been verified in this demo.</Notice><p>Your account is ready. Sign in to open your workspace.</p><Link className="button primary full" to="/login">Continue to sign in ↗</Link></>
        : <><h1>One small step.</h1><p>Enter the six-digit code for {COUNTRIES[account.country].prefix} ••••••{account.mobile.slice(-4)}.</p><Notice>{message || (otp.locked ? 'Mobile verification is locked after three incorrect attempts.' : expired ? 'This code has expired. Request a new code below.' : '')}</Notice><form onSubmit={submit} noValidate aria-label="Mobile verification"><Field name="otp" label="Six-digit verification code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(value) => { setCode(value.replace(/\D/g, '').slice(0, 6)); setMessage(''); }} disabled={busy || otp.locked || expired} placeholder="000000" error={message} /><div className="verification-meta"><span>Expires in <strong role="timer">{countdown(otp.expiresAt, now)}</strong></span><span>{Math.max(0, 3 - otp.attempts)} attempts remaining</span></div><button className="button primary full" type="submit" disabled={busy || otp.locked || expired}>{busy ? 'Verifying…' : 'Verify mobile number'} ↗</button></form><button type="button" className="text-button resend-button" onClick={resend} disabled={busy || otp.locked || now < otp.resendAt}>{busy ? 'Please wait…' : now < otp.resendAt ? `Resend code in ${countdown(otp.resendAt, now)}` : 'Resend code ↗'}</button><p className="sample-note">Code valid until {formatTime(otp.expiresAt, timeZoneFor(account))} ({timeZoneFor(account)}).</p>
          <details className="demo-preview"><summary>Demo SMS preview</summary><p>Your Haven verification code is <strong className="demo-code">{otp.code}</strong>. Valid for five minutes. No SMS has been sent.</p></details>{otp.locked && <p className="sample-note">The blueprint does not specify OTP lockout recovery. For this demo, register another sample account.</p>}</>}
    <Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
}

function Unlock() {
  const { demo, query, updateAccount } = useApp();
  const unlockToken = query.get('token');
  const account = demo.accounts.find((item) => item.unlockToken === unlockToken && unlockToken);
  const now = useNow();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = account && now < account.unlockAt;
  async function unlock() {
    if (busy || waiting) return;
    setBusy(true); await pause(); const result = unlockAccount(account, unlockToken);
    if (result.account) updateAccount(result.account);
    setStatus(result.status); setBusy(false);
  }
  return <AuthShell><section className="verification-card form-card"><span className="icon" aria-hidden="true">◇</span><p className="eyebrow">ACCOUNT PROTECTION</p>
    {status === 'success' ? <><h1>Your account is unlocked.</h1><Notice type="success">You can sign in again in this demo.</Notice><Link className="button primary full" to="/login">Return to sign in ↗</Link></>
      : !account || status === 'invalid' ? <><h1>This unlock link is invalid.</h1><Notice>Use the unlock link in the demo security email after an account is locked.</Notice><Link className="button outline full" to="/login">Back to sign in ↗</Link></>
        : <><h1>Let’s take a moment.</h1><p>Your demo account was locked after three unsuccessful sign-in attempts. Wait two minutes before using this unlock link.</p><div className="detail-strip">Unlock available in <strong role="timer">{countdown(account.unlockAt, now)}</strong></div>{!waiting && <Notice type="info">The waiting period has ended. Select Unlock account to continue.</Notice>}<button className="button primary full" disabled={waiting || busy} onClick={unlock}>{busy ? 'Unlocking…' : 'Unlock account'} ↗</button><p className="sample-note">The countdown ending does not automatically unlock your account.</p></>}
  </section></AuthShell>;
}

function Navigation({ onHolidays }) {
  const { user, path, navigate, setDemo } = useApp();
  const [menu, setMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const profileRef = useRef(null);
  useEffect(() => { setMenu(false); setProfileMenu(false); }, [path]);
  useEffect(() => {
    const outside = (event) => { if (!profileRef.current?.contains(event.target)) setProfileMenu(false); };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      if (profileRef.current?.contains(document.activeElement)) profileRef.current.querySelector('button')?.focus();
      else if (document.getElementById('main-navigation')?.contains(document.activeElement)) document.querySelector('.hamburger')?.focus();
      setMenu(false); setProfileMenu(false);
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, []);
  function logout() { setDemo((previous) => ({ ...previous, currentId: null, pendingId: null })); navigate('/login', true); }
  return <header className="navigation"><Brand /><button className="hamburger" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={() => { setMenu(!menu); setProfileMenu(false); }}><span aria-hidden="true">{menu ? '×' : '☰'}</span></button><nav id="main-navigation" className={menu ? 'is-open' : ''} aria-label="Main navigation"><Link to="/dashboard" aria-current={path === '/dashboard' ? 'page' : undefined}>Dashboard</Link><Link to="/profile" aria-current={path === '/profile' ? 'page' : undefined}>Profile</Link><Link to="/settings" aria-current={path === '/settings' ? 'page' : undefined}>Settings</Link><button className="nav-link" onClick={() => { setMenu(false); onHolidays(); }}>Philippine Holidays <span aria-hidden="true">↗</span></button></nav>
    <div className="profile-control" ref={profileRef}><button className="avatar" aria-label="Open profile menu" aria-expanded={profileMenu} aria-controls="profile-menu" onClick={() => setProfileMenu(!profileMenu)}>{initials(user)}</button>{profileMenu && <div id="profile-menu" className="profile-dropdown"><strong>{fullName(user)}</strong><small>{user.email}</small><Link to="/profile">Your profile</Link><Link to="/settings">Settings</Link><button onClick={logout}>Logout ↗</button></div>}</div>
  </header>;
}

function Dashboard({ openWorkspace }) {
  const { user, demo } = useApp();
  const now = useNow();
  return <><section className="hero"><div className="hero-content"><p className="eyebrow light"><span className="status-dot" />YOUR EVERYDAY, SIMPLIFIED</p><h1>A little space.<br />A clearer day.</h1><p className="hero-description">Welcome home, {user.firstName}.<br />Your account, your calendar, and everything in between.</p><button className="button white" onClick={() => openWorkspace('accounts')}>View More <span aria-hidden="true">↗</span></button></div><div className="hero-bottom"><span>{demo.settings.showTime ? formatTime(now, 'Asia/Manila') : 'Made for the way you move.'}</span><span>PHILIPPINES <i /> ASIA / MANILA · +63</span></div></section>
    <div className="content"><div className="section-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>A place for everything.</h2></div><DemoNote /></div><section className="overview" aria-label="Workspace overview"><Link to="/profile" className="overview-card"><span className="icon" aria-hidden="true">◎</span><h3>Your profile</h3><p>A few details that make this space yours.</p><span className="card-link">Account details <span aria-hidden="true">↗</span></span></Link><button className="overview-card" onClick={() => openWorkspace('holidays')}><span className="icon" aria-hidden="true">▦</span><h3>Days to look forward to</h3><p>A little room for rest, plans, and new places.</p><span className="card-link">Explore holidays <span aria-hidden="true">↗</span></span></button><Link to="/settings" className="overview-card"><span className="icon" aria-hidden="true">◇</span><h3>Peace of mind</h3><p>Your account security, in one simple view.</p><span className="card-link">Security settings <span aria-hidden="true">↗</span></span></Link></section><Footer /></div></>;
}

function Profile() {
  const { user } = useApp();
  const rows = [['Full name', fullName(user)], ['Birthday', user.birthday], ['Email address', user.email], ['Mobile number', `${COUNTRIES[user.country].prefix} ${user.mobile}`], ['House & street', user.houseStreet], ['City', user.city], ['Province / state', user.region], ['Country', COUNTRIES[user.country].name], ['ZIP / postal code', user.postal]];
  return <div className="inner-page"><p className="eyebrow">YOUR DETAILS</p><h1>Your profile.</h1><p className="page-description">A few details that make this space yours.</p><section className="form-card profile-card"><div className="profile-heading"><span className="large-avatar">{initials(user)}</span><div><h2>{fullName(user)}</h2><div className="badge-row"><span className="badge regular">Email verified</span><span className="badge regular">Mobile verified</span></div></div></div><dl className="detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><Footer /></div>;
}

function Settings() {
  const { demo, user, setDemo } = useApp();
  const [saved, setSaved] = useState(false);
  return <div className="inner-page"><p className="eyebrow">A LITTLE REASSURANCE</p><h1>Your settings.</h1><p className="page-description">Simple preferences for your everyday.</p><section className="form-card settings-card"><h2>Dashboard preferences</h2><label className="switch-label"><span>Show the current Philippine date and time</span><input type="checkbox" checked={demo.settings.showTime} onChange={(event) => { setDemo((previous) => ({ ...previous, settings: { ...previous.settings, showTime: event.target.checked } })); setSaved(true); }} /></label>{saved && <Notice type="success">Preference saved for this browser tab.</Notice>}<hr /><h2>Account security</h2><dl className="detail-list"><div><dt>Email verification</dt><dd>{user.emailVerified ? 'Verified' : 'Pending'}</dd></div><div><dt>Mobile verification</dt><dd>{user.mobileVerified ? 'Verified' : 'Pending'}</dd></div><div><dt>Display time zone</dt><dd>{timeZoneFor(user)}</dd></div></dl><p className="sample-note">Verification and sessions are frontend simulations. No live authentication service is connected.</p></section><Footer /></div>;
}

function Accounts() {
  const { user } = useApp();
  return <><div className="subheading"><div><h3>People in your space</h3><p>Your accessible account.</p></div><span className="small-note">1 account</span></div><div className="table-scroll"><table><caption className="sr-only">Accounts available in your workspace</caption><thead><tr><th scope="col">Name</th><th scope="col">Email address</th><th scope="col">Status</th><th scope="col">Role</th></tr></thead><tbody><tr><td><span className="person-avatar" aria-hidden="true">{initials(user)}</span>{fullName(user)}</td><td>{user.email}</td><td><span className="badge regular">Verified</span></td><td>Member</td></tr></tbody></table></div><p className="sample-note">This demo displays your own account. Other registered demo accounts are not listed.</p></>;
}

function HolidayBadges({ holiday }) { return <div className="badge-row">{holiday.categories.map((category) => <span key={category} className={`badge ${category}`}>{CATEGORIES[category].badge}</span>)}</div>; }
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1))));
function Holidays() {
  const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()));
  const [year, setYear] = useState(Math.min(2027, Math.max(2020, currentYear)));
  const [month, setMonth] = useState(Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Asia/Manila' }).format(new Date())) - 1);
  const [category, setCategory] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [viewState, setViewState] = useState('success');
  const [loading, setLoading] = useState(false);
  useEffect(() => { setLoading(true); const timer = setTimeout(() => setLoading(false), 350); return () => clearTimeout(timer); }, [year, viewState]);
  const holidays = viewState === 'empty' ? [] : previewHolidays(year);
  const visible = holidays.filter((holiday) => (category === 'all' || holiday.categories.includes(category)) && (!selectedDate || holiday.date === selectedDate));
  const activeHolidays = holidays.filter((holiday) => category === 'all' || holiday.categories.includes(category));
  function selectYear(value) { setYear(Number(value)); setSelectedDate(''); }
  function selectMonth(value) { setMonth(Number(value)); setSelectedDate(''); }
  function moveMonth(direction) {
    const newMonth = month + direction;
    if (newMonth < 0 && year > 2020) { setYear(year - 1); setMonth(11); }
    else if (newMonth > 11 && year < 2027) { setYear(year + 1); setMonth(0); }
    else if (newMonth >= 0 && newMonth <= 11) setMonth(newMonth);
    setSelectedDate('');
  }
  return <><div className="subheading"><div><h3>A pause in the calendar.</h3><p>Philippines · Asia/Manila · +63</p></div><label className="year-label" htmlFor="holiday-year">Year<select id="holiday-year" value={year} onChange={(event) => selectYear(event.target.value)}>{YEARS.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <Notice type="info">Sample calendar for {year}. These are illustrative entries, not the official holiday list. No holiday API is connected; Islamic holiday dates await official confirmation.</Notice>
    <div className="holiday-controls"><label htmlFor="holiday-category">Category<select id="holiday-category" value={category} onChange={(event) => { setCategory(event.target.value); setSelectedDate(''); }}><option value="all">All categories</option>{Object.entries(CATEGORIES).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label><details className="preview-controls"><summary>Preview display states</summary><label htmlFor="holiday-preview-state">Demo state<select id="holiday-preview-state" value={viewState} onChange={(event) => { setViewState(event.target.value); setSelectedDate(''); }}><option value="success">Sample results</option><option value="empty">Empty results</option><option value="error">Request error</option></select></label></details></div>
    {loading ? <div className="loading-state" role="status"><span className="loader" aria-hidden="true" />Loading calendar preview for {year}…</div>
      : viewState === 'error' ? <div className="empty-state"><Notice>We couldn’t load the holidays. This is a simulated request error.</Notice><button className="button outline" onClick={() => setViewState('success')}>Retry ↗</button></div>
        : <><div className="calendar"><div className="calendar-heading"><button className="icon-button" aria-label="Previous month" disabled={year === 2020 && month === 0} onClick={() => moveMonth(-1)}>‹</button><div><label className="sr-only" htmlFor="calendar-month">Calendar month</label><select id="calendar-month" value={month} onChange={(event) => selectMonth(event.target.value)}>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select><span>{year}</span></div><button className="icon-button" aria-label="Next month" disabled={year === 2027 && month === 11} onClick={() => moveMonth(1)}>›</button></div><table className="calendar-table"><caption className="sr-only">{MONTHS[month]} {year}, Philippine sample calendar</caption><thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({ length: calendarCells(year, month).length / 7 }, (_, row) => <tr key={row}>{calendarCells(year, month).slice(row * 7, row * 7 + 7).map((date, column) => {
          const entries = activeHolidays.filter((holiday) => holiday.date === date);
          const day = date ? Number(date.slice(-2)) : '';
          return <td key={column}>{date && <button className={`calendar-day ${entries.length ? 'has-holiday' : ''} ${date === selectedDate ? 'is-selected' : ''}`} onClick={() => setSelectedDate(date === selectedDate ? '' : date)} aria-pressed={selectedDate === date} aria-label={`${MONTHS[month]} ${day}, ${year}${entries.length ? `: ${entries.map((holiday) => holiday.name).join(', ')}` : ': no sample holiday'}`}><span>{day}</span>{entries.length > 0 && <span className={`calendar-dot ${entries[0].categories[0]}`} aria-hidden="true" />}</button>}</td>;
        })}</tr>)}</tbody></table><div className="calendar-legend"><span><i className="regular" />Regular</span><span><i className="special" />Special non-working</span><span><i className="islamic" />Islamic</span></div></div>
          <div className="subheading holiday-list-heading"><h3>{selectedDate ? `Sample holidays on ${selectedDate}` : `Sample holidays · ${year}`}</h3>{selectedDate && <button className="text-button" onClick={() => setSelectedDate('')}>Show all dates</button>}</div>{visible.length ? <div className="holiday-grid">{visible.map((holiday) => <article className="holiday-card" key={holiday.id}><div className="date-block"><span>{holiday.date ? MONTHS[Number(holiday.date.slice(5, 7)) - 1].slice(0, 3).toUpperCase() : 'DATE'}</span><strong>{holiday.date ? holiday.date.slice(-2) : '—'}</strong></div><div><HolidayBadges holiday={holiday} /><h4>{holiday.name}</h4><p>{holiday.date ? 'Illustrative calendar entry' : 'Date awaiting official confirmation'}</p></div></article>)}</div> : <div className="empty-state" role="status">{selectedDate ? 'No sample holidays on this date.' : 'No holidays to display for this selection.'}</div>}</>}
  </>;
}

function Workspace({ initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const tabRefs = useRef([]);
  useEffect(() => {
    const restoreFocus = document.activeElement;
    const scrollStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const main = document.getElementById('authenticated-shell');
    main?.setAttribute('inert', '');
    closeRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const elements = [...dialogRef.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter((element) => element.getClientRects().length && element.tabIndex >= 0);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey); document.body.style.overflow = scrollStyle; main?.removeAttribute('inert');
      if (restoreFocus?.isConnected && restoreFocus.getClientRects().length) restoreFocus.focus();
      else {
        const fallback = [...document.querySelectorAll('.hamburger, .hero .button, .navigation .brand')].find((element) => element.getClientRects().length);
        fallback?.focus();
      }
    };
    // The modal owns focus for its entire mounted lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function tabKey(event, index) {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next !== undefined) { event.preventDefault(); setTab(next ? 'holidays' : 'accounts'); tabRefs.current[next]?.focus(); }
  }
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title" aria-describedby="workspace-description"><div className="panel-heading"><div><p className="eyebrow">A CLOSER LOOK</p><h2 id="workspace-title">Your workspace</h2><p className="small-note" id="workspace-description">Your accounts and Philippine calendar.</p></div><button ref={closeRef} className="icon-button" aria-label="Close workspace" onClick={onClose}>×</button></div><div className="tabs" role="tablist" aria-label="Workspace views">{[['accounts', 'Accounts'], ['holidays', 'Calendars/Holidays']].map(([key, label], index) => <button key={key} ref={(element) => { tabRefs.current[index] = element; }} id={`${key}-tab`} role="tab" aria-selected={tab === key} aria-controls={`${key}-panel`} tabIndex={tab === key ? 0 : -1} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)} onKeyDown={(event) => tabKey(event, index)}>{label}{key === 'accounts' && <span>01</span>}</button>)}</div><div className="tab-content" id={`${tab}-panel`} role="tabpanel" aria-labelledby={`${tab}-tab`} tabIndex={0}>{tab === 'accounts' ? <Accounts /> : <Holidays />}</div></section></div>;
}

function NotFound() { return <AuthShell><section className="verification-card form-card"><h1>This page isn’t here.</h1><p>Return to Haven to continue.</p><Link className="button primary full" to="/dashboard">Back to Haven ↗</Link></section></AuthShell>; }

export default function App() {
  const route = useRoute();
  const [demo, setDemo] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [storageWarning, setStorageWarning] = useState(false);
  useEffect(() => { let active = true; initialDemo().then((state) => { if (active) setDemo(state); }).catch(() => { if (active) setStartupError('The frontend demo could not start. Open it through the local Vite server, then reload.'); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!demo) return; try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(demo)); } catch { setStorageWarning(true); } }, [demo]);
  const user = demo?.accounts.find((account) => account.id === demo.currentId && account.emailVerified && account.mobileVerified && !account.locked);
  const protectedRoute = ['/dashboard', '/profile', '/settings'].includes(route.path);
  useEffect(() => {
    if (!demo) return;
    if (route.path === '/') route.navigate(user ? '/dashboard' : '/login', true);
    else if (protectedRoute && !user) route.navigate('/login', true);
    else if (user && ['/login', '/register'].includes(route.path)) route.navigate('/dashboard', true);
    // Redirect only after the simulated session is restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.currentId, Boolean(demo), route.path, Boolean(user)]);
  useEffect(() => { setWorkspace(route.path === '/dashboard' && route.query.get('workspace') === 'holidays' ? 'holidays' : null); const label = { '/register': 'Create account', '/login': 'Sign in', '/verify-email': 'Verify email', '/verify-mobile': 'Verify mobile', '/unlock-account': 'Unlock account', '/dashboard': 'Dashboard', '/profile': 'Profile', '/settings': 'Settings' }[route.path] || 'Haven'; document.title = `${label} · Haven`; const timer = setTimeout(() => { const heading = document.querySelector('h1'); if (heading && !document.querySelector('[role="dialog"]')) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); } }, 0); return () => clearTimeout(timer); }, [route.location]);
  function updateAccount(account) { setDemo((previous) => ({ ...previous, accounts: previous.accounts.map((item) => item.id === account.id ? account : item) })); }
  function openHolidays() { if (route.path !== '/dashboard') route.navigate('/dashboard?workspace=holidays'); else setWorkspace('holidays'); }
  if (!demo) return <main className="startup-screen"><span className="brand">haven.</span>{startupError ? <Notice>{startupError}</Notice> : <div role="status"><div className="loader" aria-hidden="true" />Opening your space…</div>}</main>;
  let screen;
  if (protectedRoute) screen = user ? <><div id="authenticated-shell"><Navigation onHolidays={openHolidays} /><main id="main-content">{route.path === '/dashboard' ? <Dashboard openWorkspace={setWorkspace} /> : route.path === '/profile' ? <Profile /> : <Settings />}</main></div>{workspace && <Workspace initialTab={workspace} onClose={() => setWorkspace(null)} />}</> : null;
  else screen = { '/register': <Registration />, '/login': <Login />, '/verify-email': <EmailVerification />, '/verify-mobile': <MobileVerification />, '/unlock-account': <Unlock /> }[route.path] || (route.path === '/' ? null : <NotFound />);
  return <AppContext.Provider value={{ ...route, demo, setDemo, updateAccount, user }}><a className="skip-link" href="#main-content">Skip to content</a>{storageWarning && <Notice type="info">Browser storage is unavailable. Demo changes will last until this page is reloaded.</Notice>}{screen}</AppContext.Provider>;
}
