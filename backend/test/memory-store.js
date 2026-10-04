const crypto = require('crypto');
const { hashToken } = require('../store');
class MemoryStore {
  constructor() { this.state = { users: [], addresses: [], tokens: [], mobiles: {}, sessions: {}, rates: {} }; this.queue = Promise.resolve(); }
  transaction(work) {
    const result = this.queue.then(async () => {
      const snapshot = structuredClone(this.state);
      try { return await work(this); } catch (error) { this.state = snapshot; throw error; }
    });
    this.queue = result.catch(() => {}); return result;
  }
  async userByEmail(email) { return this.state.users.find(user => user.email === email); }
  async user(id) {
    const user = this.state.users.find(user => user.id === id);
    return user ? { ...user, ...this.state.addresses.find(address => address.user_id === id), id } : null;
  }
  async insertUser(user, address) {
    this.state.users.push({ email_verified_at: null, mobile_verified: 0, failed_login_attempts: 0, is_locked: 0, lockout_until: null, ...user });
    if (this.failAddress) throw new Error('private database detail');
    this.state.addresses.push(address);
  }
  async updateUser(id, fields) { Object.assign(this.state.users.find(user => user.id === id), fields); }
  async tokenByHash(hash, type) { return this.state.tokens.find(token => token.token_hash === hash && token.type === type); }
  async latestToken(id, type) { return this.state.tokens.find(token => token.user_id === id && token.type === type); }
  async replaceToken(id, type, now, ttl = 86400000) {
    await this.deleteTokens(id, type);
    const token = crypto.randomBytes(32).toString('hex'), tokenId = crypto.randomUUID();
    this.state.tokens.push({ id: tokenId, user_id: id, type, token_hash: hashToken(token), expires_at: new Date(now + ttl) });
    return { token, tokenId };
  }
  async deleteTokens(id, type) { this.state.tokens = this.state.tokens.filter(token => token.user_id !== id || token.type !== type); }
  async mobile(id) { return this.state.mobiles[id]; }
  async saveMobile(id, fields) { this.state.mobiles[id] = { ...fields }; }
  async createSession(id, type, now) {
    const token = crypto.randomBytes(32).toString('hex');
    this.state.sessions[hashToken(token)] = { user_id: id, type, expires_at: now + (type === 'authenticated' ? 28800000 : 86400000) };
    return token;
  }
  async session(hash, now) { const saved = this.state.sessions[hash]; return saved?.expires_at > now ? saved : null; }
  async deleteSession(hash) { delete this.state.sessions[hash]; }
  async deleteUserSessions(id) { for (const [hash, session] of Object.entries(this.state.sessions)) if (session.user_id === id) delete this.state.sessions[hash]; }
  async consumeRate(key, limit, duration, now) {
    let saved = this.state.rates[key];
    if (!saved || saved.resetAt <= now) saved = this.state.rates[key] = { count: 0, resetAt: now + duration };
    if (saved.count >= limit) return Math.ceil((saved.resetAt - now) / 1000);
    saved.count++; return 0;
  }
}
module.exports = { MemoryStore };
