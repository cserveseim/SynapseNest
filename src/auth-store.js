'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;

class AuthStoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AuthStoreError';
    this.statusCode = statusCode;
  }
}

class AuthStore {
  constructor(dataFile) {
    if (!dataFile || typeof dataFile !== 'string') throw new TypeError('A data file path is required.');
    this.dataFile = path.resolve(dataFile);
    this.owner = null;
    this.sessions = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid auth store');
      this.owner = parsed.owner || null;
      this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      this.pruneSessions();
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.persist();
        return;
      }
      throw new Error(`Could not read auth store at ${this.dataFile}: invalid JSON.`);
    }
  }

  hasOwner() {
    return Boolean(this.owner);
  }

  bootstrap(password) {
    if (this.owner) throw new AuthStoreError('Owner already exists.', 409);
    assertPassword(password);
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    this.owner = {
      passwordSalt,
      passwordHash: scrypt(password, passwordSalt),
      createdAt: new Date().toISOString()
    };
    this.persist();
    return this.createSession();
  }

  login(password) {
    if (!this.owner) throw new AuthStoreError('Owner has not been created.', 404);
    if (!passwordMatches(password, this.owner)) throw new AuthStoreError('Invalid password.', 401);
    return this.createSession();
  }

  createSession() {
    this.pruneSessions();
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      tokenHash: sha256(token),
      csrfToken: crypto.randomBytes(24).toString('hex'),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
    this.sessions.push(session);
    this.persist();
    return { token, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  authenticate(token) {
    this.pruneSessions();
    if (typeof token !== 'string' || !token) throw new AuthStoreError('Authentication required.', 401);
    const tokenHash = sha256(token);
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash);
    if (!session) throw new AuthStoreError('Authentication required.', 401);
    return { csrfToken: session.csrfToken, expiresAt: session.expiresAt };
  }

  assertCsrf(session, csrfToken) {
    if (typeof csrfToken !== 'string' || !csrfToken || csrfToken !== session.csrfToken) {
      throw new AuthStoreError('CSRF token is invalid.', 403);
    }
  }

  logout(token) {
    if (typeof token !== 'string' || !token) return;
    const tokenHash = sha256(token);
    const next = this.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (next.length === this.sessions.length) return;
    this.sessions = next;
    this.persist();
  }

  pruneSessions() {
    const now = Date.now();
    this.sessions = this.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  }

  persist() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const temporaryFile = `${this.dataFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(
        temporaryFile,
        `${JSON.stringify({ version: 1, owner: this.owner, sessions: this.sessions }, null, 2)}\n`,
        { mode: 0o600 }
      );
      fs.renameSync(temporaryFile, this.dataFile);
    } finally {
      try { fs.unlinkSync(temporaryFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
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

function passwordMatches(password, owner) {
  if (typeof password !== 'string') return false;
  const actual = Buffer.from(scrypt(password, owner.passwordSalt), 'hex');
  const expected = Buffer.from(owner.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { AuthStore, AuthStoreError, MIN_PASSWORD_LENGTH, SESSION_TTL_MS };
