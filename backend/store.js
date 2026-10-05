const crypto = require('crypto');
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const USER_FIELDS = new Set(['email_verified_at', 'mobile_verified', 'failed_login_attempts', 'is_locked', 'lockout_until', 'updated_at']);

class Store {
  constructor(db, connection = null) { this.db = db; this.connection = connection; }
  query(sql, values = []) { return (this.connection || this.db).query(sql, values); }
  async transaction(work) {
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(new Store(this.db, connection));
      await connection.commit();
      return result;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  async userByEmail(email, lock = false) {
    return (await this.query(`SELECT * FROM users WHERE email = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [email]))[0];
  }
  async user(id, lock = false) {
    const user = (await this.query(`SELECT * FROM users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]))[0];
    if (!user) return null;
    const address = (await this.query('SELECT * FROM addresses WHERE user_id = ? LIMIT 1', [id]))[0];
    return { ...user, ...address, id: user.id };
  }
  async insertUser(user, address) {
    const keys = Object.keys(user);
    await this.query(`INSERT INTO users (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(user));
    const addressKeys = Object.keys(address);
    await this.query(`INSERT INTO addresses (${addressKeys.join(',')}) VALUES (${addressKeys.map(() => '?').join(',')})`, Object.values(address));
  }
  async updateUser(id, fields) {
    const keys = Object.keys(fields);
    if (keys.some(key => !USER_FIELDS.has(key))) throw new Error('Unsupported user update');
    await this.query(`UPDATE users SET ${keys.map(key => `${key} = ?`).join(',')} WHERE id = ?`, [...Object.values(fields), id]);
  }
  async tokenByHash(hash, type, lock = false) {
    return (await this.query(`SELECT * FROM verification_tokens WHERE token_hash = ? AND type = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [hash, type]))[0];
  }
  async latestToken(userId, type) {
    return (await this.query('SELECT * FROM verification_tokens WHERE user_id = ? AND type = ? ORDER BY expires_at DESC LIMIT 1', [userId, type]))[0];
  }
  async replaceToken(userId, type, now, ttl = 86400000) {
    const token = crypto.randomBytes(32).toString('hex');
    const id = crypto.randomUUID();
    await this.deleteTokens(userId, type);
    await this.query('INSERT INTO verification_tokens (id,user_id,token_hash,type,expires_at) VALUES (?,?,?,?,?)',
      [id, userId, hashToken(token), type, new Date(now + ttl)]);
    return { token, tokenId: id };
  }
  deleteTokens(userId, type) { return this.query('DELETE FROM verification_tokens WHERE user_id = ? AND type = ?', [userId, type]); }
  async mobile(userId) { return (await this.query('SELECT * FROM mobile_verifications WHERE user_id = ?', [userId]))[0]; }
  async saveMobile(userId, fields) {
    await this.query(`INSERT INTO mobile_verifications (user_id,provider_id,otp_hash,expires_at,resend_at,attempts,is_locked)
      VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE provider_id=VALUES(provider_id),otp_hash=VALUES(otp_hash),expires_at=VALUES(expires_at),
      resend_at=VALUES(resend_at),attempts=VALUES(attempts),is_locked=VALUES(is_locked)`,
      [userId, fields.provider_id || null, fields.otp_hash || null, fields.expires_at || null, fields.resend_at || null, fields.attempts || 0, fields.is_locked ? 1 : 0]);
  }
  async session(hash, now) {
    return (await this.query('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?', [hash, new Date(now)]))[0];
  }
  async createSession(userId, type, now) {
    const token = crypto.randomBytes(32).toString('hex');
    await this.query('DELETE FROM sessions WHERE expires_at <= ?', [new Date(now)]);
    await this.query('INSERT INTO sessions (token_hash,user_id,type,expires_at) VALUES (?,?,?,?)',
      [hashToken(token), userId, type, new Date(now + (type === 'authenticated' ? 28800000 : 86400000))]);
    return token;
  }
  deleteSession(hash) { return this.query('DELETE FROM sessions WHERE token_hash = ?', [hash]); }
  deleteUserSessions(id) { return this.query('DELETE FROM sessions WHERE user_id = ?', [id]); }
  async consumeRate(key, limit, duration, now) {
    const consume = async tx => {
      const hashed = hashToken(key);
      await tx.query('DELETE FROM api_rate_limits WHERE reset_at <= ?', [new Date(now)]);
      await tx.query('INSERT IGNORE INTO api_rate_limits (rate_key,count,reset_at) VALUES (?,0,?)', [hashed, new Date(now + duration)]);
      const row = (await tx.query('SELECT * FROM api_rate_limits WHERE rate_key = ? FOR UPDATE', [hashed]))[0];
      if (row.count >= limit) return Math.ceil((new Date(row.reset_at).getTime() - now) / 1000);
      await tx.query('UPDATE api_rate_limits SET count = count + 1 WHERE rate_key = ?', [hashed]);
      return 0;
    };
    // Call outside the account transaction for registration attempts; a rejected
    // account submission must still count toward the five-request hourly limit.
    return this.connection ? consume(this) : this.transaction(consume);
  }
}
module.exports = { Store, hashToken };
