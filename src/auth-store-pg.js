'use strict';

const crypto = require('node:crypto');
const { AuthStoreError, MIN_PASSWORD_LENGTH, SESSION_TTL_MS } = require('./auth-store');
const { toIso } = require('./pg-pool');

const SCRYPT_KEYLEN = 64;

class PgAuthStore {
  constructor(pool) {
    if (!pool) throw new TypeError('A Postgres pool is required.');
    this.pool = pool;
    this.backend = 'postgres';
  }

  static async create(pool) {
    const store = new PgAuthStore(pool);
    await store.pool.query('SELECT 1 FROM auth_owner LIMIT 1');
    await store.pool.query('SELECT 1 FROM sessions LIMIT 1');
    return store;
  }

  async hasOwner() {
    const result = await this.pool.query('SELECT 1 FROM auth_owner WHERE id = 1');
    return result.rowCount > 0;
  }

  async bootstrap(password) {
    if (await this.hasOwner()) throw new AuthStoreError('Owner already exists.', 409);
    assertPassword(password);
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = scrypt(password, passwordSalt);
    const createdAt = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO auth_owner (id, password_salt, password_hash, created_at)
         VALUES (1, $1, $2, $3::timestamptz)`,
        [passwordSalt, passwordHash, createdAt]
      );
      const session = await this.#insertSession(client);
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async login(password) {
    const ownerResult = await this.pool.query(
      'SELECT password_salt, password_hash FROM auth_owner WHERE id = 1'
    );
    if (!ownerResult.rowCount) throw new AuthStoreError('Owner has not been created.', 404);
    const owner = ownerResult.rows[0];
    if (!passwordMatches(password, owner.password_salt, owner.password_hash)) {
      throw new AuthStoreError('Invalid password.', 401);
    }
    return this.createSession();
  }

  async createSession() {
    await this.pruneSessions();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await this.#insertSession(client);
      await client.query('COMMIT');
      return session;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async #insertSession(client) {
    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await client.query(
      `INSERT INTO sessions (token_hash, csrf_token, expires_at)
       VALUES ($1, $2, $3::timestamptz)`,
      [sha256(token), csrfToken, expiresAt]
    );
    return { token, csrfToken, expiresAt };
  }

  async authenticate(token) {
    await this.pruneSessions();
    if (typeof token !== 'string' || !token) throw new AuthStoreError('Authentication required.', 401);
    const result = await this.pool.query(
      `SELECT csrf_token, expires_at FROM sessions WHERE token_hash = $1`,
      [sha256(token)]
    );
    if (!result.rowCount) throw new AuthStoreError('Authentication required.', 401);
    const row = result.rows[0];
    return { csrfToken: row.csrf_token, expiresAt: toIso(row.expires_at) };
  }

  assertCsrf(session, csrfToken) {
    if (typeof csrfToken !== 'string' || !csrfToken || csrfToken !== session.csrfToken) {
      throw new AuthStoreError('CSRF token is invalid.', 403);
    }
  }

  async logout(token) {
    if (typeof token !== 'string' || !token) return;
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }

  async pruneSessions() {
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  }
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthStoreError(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

function scrypt(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function passwordMatches(password, passwordSalt, passwordHash) {
  if (typeof password !== 'string') return false;
  const actual = Buffer.from(scrypt(password, passwordSalt), 'hex');
  const expected = Buffer.from(passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { PgAuthStore };
