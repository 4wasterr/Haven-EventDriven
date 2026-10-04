const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { hashToken } = require('./store');
const cookie = (req, name) => {
  const part = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
};
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function security(app, { env, store, now }) {
  const secret = env.CSRF_SECRET || crypto.randomBytes(32).toString('hex');
  const production = env.NODE_ENV === 'production';
  const signature = nonce => crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  const options = req => ({ httpOnly: true, secure: production || req.secure, sameSite: 'lax', path: '/' });
  if (env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (production && !req.secure) return res.status(426).json({ message: 'HTTPS is required.' });
    if (production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.get('/api/csrf', (req, res) => {
    const nonce = crypto.randomBytes(32).toString('hex');
    const token = `${nonce}.${signature(nonce)}`;
    res.cookie('haven_csrf', token, { ...options(req), maxAge: 86400000 });
    res.json({ csrfToken: token });
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const token = req.get('X-CSRF-Token');
    const saved = cookie(req, 'haven_csrf');
    const [nonce, signed] = typeof token === 'string' ? token.split('.') : [];
    if (!nonce || !/^[a-f0-9]{64}$/.test(nonce) || !equal(token, saved) || !equal(signed, signature(nonce))) {
      return res.status(403).json({ message: 'Refresh the page and try again.', reason: 'csrf' });
    }
    const origin = req.get('Origin');
    const local = !production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    const allowed = env.PUBLIC_APP_URL ? new URL(env.PUBLIC_APP_URL).origin : 'http://localhost:5173';
    if (origin && origin !== allowed && !local) return res.status(403).json({ message: 'Request origin is not allowed.' });
    next();
  });
  return {
    async session(req) {
      const token = cookie(req, 'haven_session');
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      return store.session(hashToken(token), now());
    },
    async issue(req, res, tx, userId, type) {
      const old = cookie(req, 'haven_session');
      if (old) await tx.deleteSession(hashToken(old));
      const token = await tx.createSession(userId, type, now());
      res.cookie('haven_session', token, { ...options(req), maxAge: type === 'authenticated' ? 28800000 : 86400000 });
    },
    async logout(req, res, tx = store) {
      const token = cookie(req, 'haven_session');
      if (token) await tx.deleteSession(hashToken(token));
      res.clearCookie('haven_session', options(req));
    }
  };
}
const hashPassword = password => bcrypt.hash(password, 12);
// Equal-cost password comparison for an unknown account; never a usable credential.
const dummyHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
const comparePassword = (password, hash) => bcrypt.compare(password, /^\$2[aby]\$(?:1[2-9]|2\d|3[01])\$/.test(hash || '') ? hash : dummyHash);
module.exports = { security, hashPassword, comparePassword };
