import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { COUNTRIES, manilaToday, passwordRules, suggestPassword, validateLogin, validateRegistration } from './validation.mjs';
import { countdown, formatTime, timeZoneFor } from './format.mjs';
import { api } from './api.mjs';
import { CATEGORIES, YEARS, calendarCells } from './calendar.mjs';
import EmailForm from './EmailForm.jsx';

const AppContext = createContext(null);
const useApp = () => useContext(AppContext);
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
  return <div className="public-layout"><header className="public-header"><Brand /><Link className="text-link" to="/login">Sign in ↗</Link></header>
    <main id="main-content" className={`auth-main ${wide ? 'wide' : ''}`}>
      {step && <ol className="steps" aria-label="Registration progress">{['Your details', 'Verify email', 'Verify mobile'].map((title, index) => <li key={title} className={step === index + 1 ? 'current' : step > index + 1 ? 'complete' : ''} aria-current={step === index + 1 ? 'step' : undefined}><span>{step > index + 1 ? '✓' : `0${index + 1}`}</span>{title}</li>)}</ol>}
      {children}
    </main><div className="footer-wrap"><Footer /></div></div>;
}

function useAddressChoices(country, region, city) {
  const [cities, setCities] = useState([]);
  const [postal, setPostal] = useState({ mode: 'input', options: [] });
  const [cityLoading, setCityLoading] = useState(false);
  const [postalLoading, setPostalLoading] = useState(false);
  const [cityError, setCityError] = useState('');
  const [postalError, setPostalError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCities([]); setCityError(''); setCityLoading(Boolean(region));
    if (region) api(`/addresses/cities?${new URLSearchParams({ country, region })}`, undefined, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCities(data.cities); })
      .catch(error => { if (!controller.signal.aborted) setCityError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setCityLoading(false); });
    return () => controller.abort();
  }, [country, region, retry]);
  useEffect(() => {
    const controller = new AbortController();
    setPostal({ mode: 'input', options: [] }); setPostalError(''); setPostalLoading(Boolean(city));
    if (city) api(`/addresses/postal-codes?${new URLSearchParams({ country, region, city })}`, undefined, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPostal(data); })
      .catch(error => { if (!controller.signal.aborted) setPostalError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setPostalLoading(false); });
    return () => controller.abort();
  }, [country, region, city, retry]);
  return { cities, postal, cityLoading, postalLoading, error: cityError || postalError, retry: () => setRetry(value => value + 1) };
}

function Registration() {
  const { refreshSession, navigate, services } = useApp();
  const registrationAvailable = services.email;
  const [values, setValues] = useState({ firstName: '', lastName: '', middleInitial: '', birthday: '', email: '', mobile: '', houseStreet: '', country: 'PH', region: '', city: '', postal: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [generated, setGenerated] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const now = useNow();
  const country = COUNTRIES[values.country];
  const region = country?.regions[values.region];
  const address = useAddressChoices(values.country, values.region, values.city);
  function change(name, value) {
    const emptyPostal = COUNTRIES[name === 'country' ? value : values.country]?.postalApplicable ? '' : 'N/A';
    const resets = name === 'country' ? { region: '', city: '', postal: emptyPostal, mobile: '' } : name === 'region' ? { city: '', postal: emptyPostal } : name === 'city' ? { postal: emptyPostal } : {};
    setValues((previous) => ({ ...previous, ...resets, [name]: value }));
    setErrors((previous) => { const next = { ...previous }; for (const key of [name, ...Object.keys(resets)]) delete next[key]; return next; });
    setMessage('');
    if (name === 'password') setGenerated('');
  }
  const field = (name, label, props = {}) => <Field name={name} label={label} value={values[name]} onChange={(value) => change(name, value)} error={errors[name]} {...props} />;
  async function submit(event) {
    event.preventDefault();
    if (busy || now < retryAt) return;
    const nextErrors = validateRegistration(values, manilaToday(), { cities: address.cities, postalMode: address.postal.mode, postalCodes: address.postal.options });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setMessage('Please correct the highlighted fields.'); focusError(nextErrors); return; }
    setBusy(true); setMessage('');
    try {
      const result = await api('/register', values);
      await refreshSession();
      navigate(result.email_submitted ? '/verify-email' : '/verify-email?delivery=failed');
    } catch (error) {
      setMessage(error.message);
      if (error.status === 429 && error.data?.retryAfter) setRetryAt(Date.now() + error.data.retryAfter * 1000);
      if (error.data?.errors) { setErrors(error.data.errors); focusError(error.data.errors); }
    } finally { setBusy(false); }
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
        <h3 className="form-section-title">Your address</h3>{field('houseStreet', 'House & street', { autoComplete: 'street-address', maxLength: 255, placeholder: 'House number, street, subdivision / barangay' })}
        <div className="form-grid address-grid">
          {field('country', 'Country', { autoComplete: 'country', options: Object.entries(COUNTRIES).map(([value, item]) => ({ value, label: item.name })) })}
          {field('region', values.country === 'PH' ? 'Province / Metro Manila' : 'Province / state', { autoComplete: 'address-level1', options: Object.keys(country?.regions || {}) })}
          {field('city', 'City / municipality', { autoComplete: 'address-level2', disabled: !region || address.cityLoading || !address.cities.length, options: address.cities.map(city => city.name), hint: address.cityLoading ? 'Loading cities…' : region && !address.cities.length && !address.error ? 'No cities are listed for this subdivision.' : undefined })}
          {field('postal', 'ZIP / postal code', { autoComplete: 'postal-code', disabled: !values.city || address.postalLoading || !country?.postalApplicable,
            options: !country?.postalApplicable ? [{ value: 'N/A', label: 'Not used in this country' }] : address.postal.mode === 'select' ? address.postal.options : undefined,
            maxLength: 20, placeholder: country?.postalExample, hint: address.postalLoading ? 'Loading postal areas…' : address.postal.mode === 'input' && values.city ? address.postal.hint : undefined })}
        </div>
        <p className="field-hint">Select your province or state, then your city. For Caloocan, select the postal area that matches your address; include your barangay and subdivision above.</p>
        <p className="field-hint"><a href="/address-data-sources.txt" target="_blank" rel="noreferrer">Address data sources</a></p>
        {address.error && <><Notice>{address.error}</Notice><button type="button" className="text-button" onClick={address.retry}>Retry address lookup</button></>}
        <h3 className="form-section-title">Contact details</h3><div className="form-grid">{field('email', 'Email address', { type: 'email', autoComplete: 'email', maxLength: 255, placeholder: 'you@gmail.com', hint: 'Public email providers only; company domains are not accepted.' })}{field('mobile', 'Mobile number', { type: 'tel', autoComplete: 'tel-national', inputMode: 'tel', prefix: country?.prefix, placeholder: values.country === 'PH' ? '917 123 4567' : values.country === 'GB' ? '7400 123456' : 'National mobile number', hint: country?.phoneHint })}</div>
        <h3 className="form-section-title">Keep it secure</h3><div className="form-grid">{field('password', 'Password', { type: showPassword ? 'text' : 'password', autoComplete: 'new-password', placeholder: 'Create a password' })}{field('confirmPassword', 'Confirm password', { type: showPassword ? 'text' : 'password', autoComplete: 'new-password', placeholder: 'Re-enter your password' })}</div>
        <ul className="password-rules" aria-label="Password requirements">{passwordRules(values.password).map((rule) => <li key={rule.label} className={rule.valid ? 'met' : ''}><span aria-hidden="true">{rule.valid ? '✓' : '○'}</span><span className="sr-only">{rule.valid ? 'Met: ' : 'Required: '}</span>{rule.label}</li>)}</ul>
        <div className="password-tools"><button type="button" className="text-button" onClick={suggest}>Suggest a strong password ↗</button><label className="checkbox-label"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />Show passwords</label></div>
        {generated && <p className="suggested-password" role="status">Suggested password: <strong>{generated}</strong><br />Both password fields have been filled.</p>}
        {!registrationAvailable && <Notice type="info">New registrations are temporarily unavailable while email verification is offline.</Notice>}
        {registrationAvailable && !services.sms && <Notice type="info">You can register and verify your email. Mobile verification is temporarily paused.</Notice>}
        <button className="button primary full" type="submit" disabled={!registrationAvailable || now < retryAt}>{busy ? 'Creating account…' : now < retryAt ? `Try again in ${countdown(retryAt, now)}` : 'Create account'}<span aria-hidden="true">↗</span></button>
      </fieldset></form>
    </div></section></AuthShell>;
}

function Login() {
  const { refreshSession, navigate, services } = useApp();
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState('');
  function change(name, value) { setValues(previous => ({ ...previous, [name]: value })); setErrors(previous => ({ ...previous, [name]: '' })); setMessage(''); }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    const nextErrors = validateLogin(values); setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { focusError(nextErrors); return; }
    setBusy(true); setMessage('');
    try { const result = await api('/login', values); await refreshSession(); navigate(result.next); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function requestUnlock() {
    if (!validateLogin({ email: values.email, password: 'x' }).email) {
      setBusy(true);
      try { setUnlockMessage((await api('/request-unlock', { email: values.email })).message); }
      catch (error) { setMessage(error.message); }
      finally { setBusy(false); }
    } else { setErrors({ email: 'Enter your registered email address.' }); }
  }
  return <AuthShell><section className="login-section"><div className="login-copy"><p className="eyebrow">GOOD TO SEE YOU AGAIN</p><h1>Welcome back.</h1><p>Your account, your calendar,<br />and a little room to breathe.</p><span className="decorative-orbit" aria-hidden="true">h.</span></div><div className="form-card"><h2>Sign in to Haven</h2><p className="form-description">Your everyday starts here.</p><Notice>{message}</Notice><form onSubmit={submit} noValidate aria-label="Sign in"><fieldset disabled={busy}><legend className="sr-only">Sign-in credentials</legend><Field name="email" label="Email address" type="email" autoComplete="username" value={values.email} onChange={value => change('email', value)} error={errors.email} placeholder="you@gmail.com" /><Field name="password" label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={values.password} onChange={value => change('password', value)} error={errors.password} placeholder="Enter your password" /><div className="login-options"><label className="checkbox-label"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label></div><button className="button primary full" type="submit">{busy ? 'Signing in…' : 'Sign in'}<span aria-hidden="true">↗</span></button></fieldset></form><p className="helper-note centered">New around here? <Link to="/register">Create an account ↗</Link></p><button className="text-button" disabled={busy || !services.email} onClick={requestUnlock}>Request an account unlock email</button><Notice type="info">{services.email ? unlockMessage : "Account unlock emails are temporarily unavailable. Please try again later."}</Notice></div></section></AuthShell>;
}

function EmailVerification() {
  const { pending, query, refreshSession, navigate, services } = useApp();
  const token = query.get('token');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [deliveryFailed, setDeliveryFailed] = useState(() => query.get('delivery') === 'failed');
  const now = useNow();
  async function verify() {
    if (busy) return;
    setBusy(true); setMessage('');
    try { const result = await api('/verify-email', { token }); await refreshSession(); navigate(result.sms_submitted ? '/verify-mobile' : '/verify-mobile?delivery=failed', true); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function resend() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      setMessage((await api('/resend-verification', {})).message); setResendAt(Date.now() + 60000);
      setDeliveryFailed(false); navigate('/verify-email', true);
    }
    catch (error) {
      setMessage(error.message);
      if ([502, 503].includes(error.status)) { setDeliveryFailed(true); navigate('/verify-email?delivery=failed', true); }
      if (error.data?.retryAfter) setResendAt(Date.now() + error.data.retryAfter * 1000);
    }
    finally { setBusy(false); }
  }
  if (!services.email && !pending?.emailVerified) return <AuthShell step={2}><section className="verification-card form-card"><p className="eyebrow">EMAIL VERIFICATION</p><h1>Verification is paused.</h1><Notice type="info">Email verification is temporarily unavailable. Please return later to continue.</Notice>{pending && <p>Your account details are saved.</p>}<Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
  return <AuthShell step={2}><section className="verification-card form-card"><span className="icon" aria-hidden="true">✉</span><p className="eyebrow">EMAIL VERIFICATION</p>{deliveryFailed && !message && !token && !pending?.emailVerified && <Notice>Your account was created, but the verification email could not be sent. Request another email below.</Notice>}<Notice type={message.includes('requested') ? 'info' : 'error'}>{message}</Notice>
    {token ? <><h1>Confirm your email.</h1><p>Verify your email address to continue. The secure link is valid for 24 hours.</p><button className="button primary full" onClick={verify} disabled={busy}>{busy ? 'Verifying…' : 'Verify my email address'} ↗</button></>
      : pending?.emailVerified ? <><h1>Email verified.</h1><Notice type="success">Your email address is confirmed.</Notice><Link className="button primary full" to="/verify-mobile">Continue to mobile verification ↗</Link></>
        : pending ? <><h1>{deliveryFailed ? 'Email delivery failed.' : 'Check your inbox.'}</h1>{deliveryFailed ? <p>The verification email for <strong>{pending.email}</strong> could not be sent. Your account is saved; request another email below.</p> : <><p>Hi {pending.firstName}, we requested a verification email to <strong>{pending.email}</strong>. Follow its secure link once it arrives.</p><p className="helper-note">Check your spam folder too. The link expires after 24 hours.</p></>}<button className="button outline full" onClick={resend} disabled={busy || now < resendAt}>{busy ? 'Sending…' : now < resendAt ? `Resend in ${countdown(resendAt, now)}` : 'Resend verification email'}</button><button className="text-button resend-button" disabled={busy} onClick={() => refreshSession().catch(error => setMessage(error.message))}>I have verified my email</button></>
          : <><h1>Continue your registration.</h1><p>Create an account, or sign in to resume verification.</p><Link className="button primary full" to="/register">Create an account ↗</Link></>}
    <Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
}

function MobileVerification() {
  const { pending, query, refreshSession, navigate, services } = useApp();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(() => query.get('delivery') === 'failed' ? "Your email is verified, but we couldn't send the SMS code. Please try again later or contact support." : '');
  const [messageType, setMessageType] = useState('error');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const now = useNow();
  const otp = pending?.otp;
  const expired = otp?.sent && now >= otp.expiresAt;
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    if (!/^\d{6}$/.test(code)) { setMessage('Enter exactly six numeric digits.'); document.getElementById('otp')?.focus(); return; }
    setBusy(true); setMessage(''); setMessageType('error');
    try { await api('/verify-mobile', { code }); setSuccess(true); await refreshSession(); }
    catch (error) { setMessage(error.message); await refreshSession().catch(() => {}); }
    finally { setBusy(false); }
  }
  async function resend() {
    if (busy) return;
    setBusy(true); setMessage(''); setMessageType('error');
    try { const result = await api('/send-mobile-otp', {}); setMessage(result.message); setMessageType('info'); setCode(''); await refreshSession(); navigate('/verify-mobile', true); }
    catch (error) { setMessage(error.message); setMessageType('error'); await refreshSession().catch(() => {}); }
    finally { setBusy(false); }
  }
  if (!services.sms && !otp?.sent && pending?.emailVerified && !pending.mobileVerified) return <AuthShell step={3}><section className="verification-card form-card"><p className="eyebrow">MOBILE VERIFICATION</p><h1>Verification is paused.</h1><Notice type="info">Mobile verification is temporarily unavailable. Please return later to continue.</Notice><p>Your account details are saved.</p><Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
  return <AuthShell step={3}><section className="verification-card form-card"><span className="icon" aria-hidden="true">⌁</span><p className="eyebrow">MOBILE VERIFICATION</p>
    {success || pending?.mobileVerified ? <><h1>You’re all set.</h1><Notice type="success">Your mobile number is verified.</Notice><p>Your account is ready. Sign in to open your workspace.</p><Link className="button primary full" to="/login">Continue to sign in ↗</Link></>
      : !pending?.emailVerified ? <><h1>Verify your email first.</h1><p>Your mobile verification follows email verification.</p><Link className="button primary full" to="/verify-email">Go to email verification ↗</Link></>
        : <><h1>One small step.</h1><p>{otp?.sent ? `Enter the six-digit SMS code for the number ending in ${pending.mobile.slice(-4)}.` : `Verify the number ending in ${pending.mobile.slice(-4)} by requesting a six-digit SMS code below.`}</p><Notice type={otp?.locked || expired ? 'error' : messageType}>{otp?.locked ? 'Mobile verification is locked after three incorrect attempts. Contact support.' : message || (expired ? 'This code has expired. Request a new code below.' : '')}</Notice>
          {otp?.sent && <form onSubmit={submit} noValidate aria-label="Mobile verification"><Field name="otp" label="Six-digit verification code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={value => { setCode(value.replace(/\D/g, '').slice(0, 6)); setMessage(''); }} disabled={busy || otp.locked || expired} placeholder="000000" /><div className="verification-meta"><span>Expires in <strong role="timer">{countdown(otp.expiresAt, now)}</strong></span><span>{otp.attemptsRemaining} attempts remaining</span></div><button className="button primary full" type="submit" disabled={busy || otp.locked || expired}>{busy ? 'Verifying…' : 'Verify mobile number'} ↗</button></form>}
          <button type="button" className="text-button resend-button" onClick={resend} disabled={busy || !services.sms || otp?.locked || now < (otp?.resendAt || 0)}>{busy ? 'Please wait…' : !services.sms ? 'SMS sending unavailable' : now < (otp?.resendAt || 0) ? `Resend OTP in ${countdown(otp.resendAt, now)}` : otp?.sent ? 'Resend OTP ↗' : 'Send SMS code ↗'}</button>{otp?.sent && <p className="helper-note">Code valid until {formatTime(otp.expiresAt, timeZoneFor(pending))} ({timeZoneFor(pending)}).</p>}</>}
    <Link className="text-link back-link" to="/login">Back to sign in</Link></section></AuthShell>;
}

function Unlock() {
  const { query } = useApp();
  const token = query.get('token');
  const [unlockAt, setUnlockAt] = useState(null);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const now = useNow() + offset;
  useEffect(() => {
    let active = true;
    api('/unlock-status', { token }).then(result => { if (active) { setUnlockAt(result.unlockAt); setOffset(result.serverNow - Date.now()); } }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [token]);
  async function unlock() {
    setBusy(true); setMessage('');
    try { await api('/unlock-account', { token }); setSuccess(true); window.history.replaceState({}, '', '/unlock-account'); }
    catch (error) { setMessage(error.message); if (error.data?.retryAfter) setUnlockAt(now + error.data.retryAfter * 1000); }
    finally { setBusy(false); }
  }
  return <AuthShell><section className="verification-card form-card"><span className="icon" aria-hidden="true">◇</span><p className="eyebrow">ACCOUNT PROTECTION</p><Notice>{message}</Notice>
    {success ? <><h1>Your account is unlocked.</h1><Notice type="success">Sign in with your password to continue.</Notice><Link className="button primary full" to="/login">Return to sign in ↗</Link></>
      : <><h1>Let’s take a moment.</h1><p>After three unsuccessful sign-in attempts, wait two minutes before using your account unlock link.</p>{unlockAt !== null && <div className="detail-strip">Unlock available in <strong role="timer">{countdown(unlockAt, now)}</strong></div>}<button className="button primary full" disabled={unlockAt === null || now < unlockAt || busy} onClick={unlock}>{busy ? 'Unlocking…' : 'Unlock account'} ↗</button><Link className="text-link back-link" to="/login">Back to sign in</Link></>}
  </section></AuthShell>;
}

function Navigation({ onHolidays }) {
  const { user, path, navigate, refreshSession } = useApp();
  const [logoutError, setLogoutError] = useState('');
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
  async function logout() { try { await api('/logout', {}); await refreshSession(); navigate('/login', true); } catch (error) { setLogoutError(error.message); } }
  return <header className="navigation"><Brand /><Notice>{logoutError}</Notice><button className="hamburger" aria-label={menu ? 'Close navigation' : 'Open navigation'} aria-expanded={menu} aria-controls="main-navigation" onClick={() => { setMenu(!menu); setProfileMenu(false); }}><span aria-hidden="true">{menu ? '×' : '☰'}</span></button><nav id="main-navigation" className={menu ? 'is-open' : ''} aria-label="Main navigation"><Link to="/dashboard" aria-current={path === '/dashboard' ? 'page' : undefined}>Dashboard</Link><Link to="/profile" aria-current={path === '/profile' ? 'page' : undefined}>Profile</Link><Link to="/settings" aria-current={path === '/settings' ? 'page' : undefined}>Settings</Link><Link to="/send-email" aria-current={path === '/send-email' ? 'page' : undefined}>Send email</Link><button className="nav-link" onClick={() => { setMenu(false); onHolidays(); }}>Philippine Holidays <span aria-hidden="true">↗</span></button></nav>
    <div className="profile-control" ref={profileRef}><button className="avatar" aria-label="Open profile menu" aria-expanded={profileMenu} aria-controls="profile-menu" onClick={() => setProfileMenu(!profileMenu)}>{initials(user)}</button>{profileMenu && <div id="profile-menu" className="profile-dropdown"><strong>{fullName(user)}</strong><small>{user.email}</small><Link to="/profile">Your profile</Link><Link to="/settings">Settings</Link><button onClick={logout}>Logout ↗</button></div>}</div>
  </header>;
}

function Dashboard({ openWorkspace }) {
  const { user, settings } = useApp();
  const now = useNow();
  return <><section className="hero"><div className="hero-content"><p className="eyebrow light"><span className="status-dot" />YOUR EVERYDAY, SIMPLIFIED</p><h1>A little space.<br />A clearer day.</h1><p className="hero-description">Welcome home, {user.firstName}.<br />Your account, your calendar, and everything in between.</p><button className="button white" onClick={() => openWorkspace('accounts')}>View More <span aria-hidden="true">↗</span></button></div><div className="hero-bottom"><span>{settings.showTime ? formatTime(now, 'Asia/Manila') : 'Made for the way you move.'}</span><span>PHILIPPINES <i /> ASIA / MANILA · +63</span></div></section>
    <div className="content"><div className="section-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>A place for everything.</h2></div></div><section className="overview" aria-label="Workspace overview"><Link to="/profile" className="overview-card"><span className="icon" aria-hidden="true">◎</span><h3>Your profile</h3><p>A few details that make this space yours.</p><span className="card-link">Account details <span aria-hidden="true">↗</span></span></Link><button className="overview-card" onClick={() => openWorkspace('holidays')}><span className="icon" aria-hidden="true">▦</span><h3>Days to look forward to</h3><p>A little room for rest, plans, and new places.</p><span className="card-link">Explore holidays <span aria-hidden="true">↗</span></span></button><Link to="/settings" className="overview-card"><span className="icon" aria-hidden="true">◇</span><h3>Peace of mind</h3><p>Your account security, in one simple view.</p><span className="card-link">Security settings <span aria-hidden="true">↗</span></span></Link></section><Footer /></div></>;
}

function Profile() {
  const { user } = useApp();
  const rows = [['Full name', fullName(user)], ['Birthday', user.birthday], ['Email address', user.email], ['Mobile number', user.mobile], ['House & street', user.houseStreet], ['City', user.city], ['Province / state', user.region], ['Country', COUNTRIES[user.country].name], ['ZIP / postal code', user.postal]];
  return <div className="inner-page"><p className="eyebrow">YOUR DETAILS</p><h1>Your profile.</h1><p className="page-description">A few details that make this space yours.</p><section className="form-card profile-card"><div className="profile-heading"><span className="large-avatar">{initials(user)}</span><div><h2>{fullName(user)}</h2><div className="badge-row"><span className="badge regular">Email verified</span><span className="badge regular">Mobile verified</span></div></div></div><dl className="detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><Footer /></div>;
}

function Settings() {
  const { settings, user, setSettings } = useApp();
  const [saved, setSaved] = useState(false);
  return <div className="inner-page"><p className="eyebrow">A LITTLE REASSURANCE</p><h1>Your settings.</h1><p className="page-description">Simple preferences for your everyday.</p><section className="form-card settings-card"><h2>Dashboard preferences</h2><label className="switch-label"><span>Show the current Philippine date and time</span><input type="checkbox" checked={settings.showTime} onChange={event => { setSettings({ showTime: event.target.checked }); setSaved(true); }} /></label>{saved && <Notice type="success">Display preference saved.</Notice>}<hr /><h2>Account security</h2><dl className="detail-list"><div><dt>Email verification</dt><dd>{user.emailVerified ? 'Verified' : 'Pending'}</dd></div><div><dt>Mobile verification</dt><dd>{user.mobileVerified ? 'Verified' : 'Pending'}</dd></div><div><dt>Display time zone</dt><dd>{timeZoneFor(user)}</dd></div></dl></section><Footer /></div>;
}

function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; api('/accounts').then(result => { if (active) setAccounts(result.accounts); }).catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <><div className="subheading"><div><h3>People in your space</h3><p>Your accessible accounts.</p></div><span className="small-note">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</span></div><Notice>{message}</Notice>{loading ? <p role="status">Loading accounts…</p> : <div className="table-scroll"><table><caption className="sr-only">Accounts available in your workspace</caption><thead><tr><th scope="col">Name</th><th scope="col">Email address</th><th scope="col">Status</th><th scope="col">Role</th></tr></thead><tbody>{accounts.map(account => <tr key={account.id}><td><span className="person-avatar" aria-hidden="true">{initials(account)}</span>{fullName(account)}</td><td>{account.email}</td><td><span className="badge regular">Verified</span></td><td>Member</td></tr>)}</tbody></table></div>}</>;
}

function HolidayBadges({ holiday }) { return <div className="badge-row">{holiday.categories.map((category) => <span key={category} className={`badge ${category}`}>{CATEGORIES[category].badge}</span>)}</div>; }
const MONTHS = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month, 1))));
function Holidays() {
  const { services } = useApp();
  const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()));
  const [year, setYear] = useState(Math.min(2027, Math.max(2020, currentYear)));
  const [month, setMonth] = useState(Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Asia/Manila' }).format(new Date())) - 1);
  const [category, setCategory] = useState('all');
  const [selectedDate, setSelectedDate] = useState('');
  const [holidays, setHolidays] = useState([]);
  const [source, setSource] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [requestError, setRequestError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setHolidays([]); setSource(''); setSourceUrl(''); setRequestError('');
    if (!services.holidays) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api(`/holidays/${year}`, undefined, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setHolidays(result.holidays); setSource(result.source); setSourceUrl(result.sourceUrl); }
    }).catch(error => { if (!controller.signal.aborted) setRequestError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, retry, services.holidays]);

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
    <p className="helper-note">Philippine public holidays for {year}{source && <> · Source: {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{source}</a> : source}</>}. Dates may change when official proclamations are issued.</p>
    {!services.holidays && <Notice type="info">Philippine holiday data is temporarily unavailable. Please check again later.</Notice>}
    <div className="holiday-controls"><label htmlFor="holiday-category">Category<select id="holiday-category" value={category} onChange={(event) => { setCategory(event.target.value); setSelectedDate(''); }}><option value="all">All categories</option>{Object.entries(CATEGORIES).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select></label></div>
    {!services.holidays ? null : loading ? <div className="loading-state" role="status"><span className="loader" aria-hidden="true" />Loading holidays for {year}…</div>
      : requestError ? <div className="empty-state"><Notice>{requestError}</Notice><button className="button outline" onClick={() => setRetry(value => value + 1)}>Retry ↗</button></div>
        : <><div className="calendar"><div className="calendar-heading"><button className="icon-button" aria-label="Previous month" disabled={year === 2020 && month === 0} onClick={() => moveMonth(-1)}>‹</button><div><label className="sr-only" htmlFor="calendar-month">Calendar month</label><select id="calendar-month" value={month} onChange={(event) => selectMonth(event.target.value)}>{MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}</select><span>{year}</span></div><button className="icon-button" aria-label="Next month" disabled={year === 2027 && month === 11} onClick={() => moveMonth(1)}>›</button></div><table className="calendar-table"><caption className="sr-only">{MONTHS[month]} {year}, Philippine holiday calendar</caption><thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <th scope="col" key={day}>{day}</th>)}</tr></thead><tbody>{Array.from({ length: calendarCells(year, month).length / 7 }, (_, row) => <tr key={row}>{calendarCells(year, month).slice(row * 7, row * 7 + 7).map((date, column) => {
          const entries = activeHolidays.filter((holiday) => holiday.date === date);
          const day = date ? Number(date.slice(-2)) : '';
          return <td key={column}>{date && <button className={`calendar-day ${entries.length ? 'has-holiday' : ''} ${date === selectedDate ? 'is-selected' : ''}`} onClick={() => setSelectedDate(date === selectedDate ? '' : date)} aria-pressed={selectedDate === date} aria-label={`${MONTHS[month]} ${day}, ${year}${entries.length ? `: ${entries.map((holiday) => holiday.name).join(', ')}` : ': no holiday'}`}><span>{day}</span>{entries.length > 0 && <span className={`calendar-dot ${entries[0].categories[0]}`} aria-hidden="true" />}</button>}</td>;
        })}</tr>)}</tbody></table><div className="calendar-legend"><span><i className="regular" />Regular</span><span><i className="special" />Special non-working</span><span><i className="islamic" />Islamic</span></div></div>
          <div className="subheading holiday-list-heading"><h3>{selectedDate ? `Holidays on ${selectedDate}` : `Holidays · ${year}`}</h3>{selectedDate && <button className="text-button" onClick={() => setSelectedDate('')}>Show all dates</button>}</div>{visible.length ? <div className="holiday-grid">{visible.map((holiday) => <article className="holiday-card" key={holiday.id}><div className="date-block"><span>{holiday.date ? MONTHS[Number(holiday.date.slice(5, 7)) - 1].slice(0, 3).toUpperCase() : 'DATE'}</span><strong>{holiday.date ? holiday.date.slice(-2) : '—'}</strong></div><div><HolidayBadges holiday={holiday} /><h4>{holiday.name}</h4><p>{'Philippine public holiday'}</p></div></article>)}</div> : <div className="empty-state" role="status">{selectedDate ? 'No holidays on this date.' : 'No holidays to display for this selection.'}</div>}</>}
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
  const [session, setSession] = useState({ user: null, pending: null });
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [workspace, setWorkspace] = useState(null);
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('haven.preferences')) || { showTime: true }; } catch { return { showTime: true }; }
  });
  const refreshSession = useCallback(async () => {
    const result = await api('/session'); setSession(result); setStartupError(''); return result;
  }, []);
  useEffect(() => {
    let active = true;
    api('/session').then(result => { if (active) setSession(result); }).catch(error => { if (active) setStartupError(error.message); }).finally(() => { if (active) setReady(true); });
    // Remove browser-only credentials left by earlier versions.
    try { sessionStorage.removeItem('haven.frontend-demo.v2'); } catch { /* storage is optional */ }
    return () => { active = false; };
  }, []);
  useEffect(() => { try { localStorage.setItem('haven.preferences', JSON.stringify(settings)); } catch { /* display preferences are optional */ } }, [settings]);
  useEffect(() => {
    const update = () => refreshSession().catch(error => { setSession({ user: null, pending: null }); setStartupError(error.message); });
    const timer = setInterval(update, 60000); window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refreshSession]);
  const { user, pending } = session;
  const protectedRoute = ['/dashboard', '/profile', '/settings', '/send-email'].includes(route.path);
  useEffect(() => {
    if (!ready) return;
    if (route.path === '/') route.navigate(user ? '/dashboard' : '/login', true);
    else if (protectedRoute && !user) route.navigate('/login', true);
    else if (user && ['/login', '/register'].includes(route.path)) route.navigate('/dashboard', true);
  }, [ready, route.path, Boolean(user)]);
  useEffect(() => {
    setWorkspace(route.path === '/dashboard' && route.query.get('workspace') === 'holidays' ? 'holidays' : null);
    const label = { '/register': 'Create account', '/login': 'Sign in', '/verify-email': 'Verify email', '/verify-mobile': 'Verify mobile', '/unlock-account': 'Unlock account', '/dashboard': 'Dashboard', '/profile': 'Profile', '/settings': 'Settings', '/send-email': 'Send email' }[route.path] || 'Haven';
    document.title = `${label} · Haven`;
    const timer = setTimeout(() => { const heading = document.querySelector('h1'); if (heading && !document.querySelector('[role="dialog"]')) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); } }, 0);
    return () => clearTimeout(timer);
  }, [route.location]);
  function openHolidays() { if (route.path !== '/dashboard') route.navigate('/dashboard?workspace=holidays'); else setWorkspace('holidays'); }
  if (!ready) return <main className="startup-screen"><span className="brand">haven.</span><div role="status"><div className="loader" aria-hidden="true" />Opening your space…</div></main>;
  let screen;
  if (protectedRoute) screen = user ? <><div id="authenticated-shell"><Navigation onHolidays={openHolidays} /><main id="main-content">{route.path === '/dashboard' ? <Dashboard openWorkspace={setWorkspace} /> : route.path === '/profile' ? <Profile /> : route.path === '/send-email' ? <div className="content"><EmailForm available={session.services?.email || false} /><Footer /></div> : <Settings />}</main></div>{workspace && <Workspace initialTab={workspace} onClose={() => setWorkspace(null)} />}</> : null;
  else screen = { '/register': <Registration />, '/login': <Login />, '/verify-email': <EmailVerification />, '/verify-mobile': <MobileVerification />, '/unlock-account': <Unlock /> }[route.path] || (route.path === '/' ? null : <NotFound />);
  const services = session.services || { email: false, sms: false, holidays: false };
  return <AppContext.Provider value={{ ...route, user, pending, services, refreshSession, settings, setSettings }}><a className="skip-link" href="#main-content">Skip to content</a>{startupError && <Notice>{startupError}</Notice>}{screen}</AppContext.Provider>;
}
