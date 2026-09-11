'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AuthStore, AuthStoreError } = require('../src/auth-store');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-auth-'));
  return {
    directory,
    store: new AuthStore(path.join(directory, 'auth.json')),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test('bootstraps a single owner and issues a session', () => {
  const subject = fixture();
  try {
    assert.equal(subject.store.hasOwner(), false);
    const session = subject.store.bootstrap('correct-horse');
    assert.equal(subject.store.hasOwner(), true);
    assert.match(session.token, /^[0-9a-f]{64}$/);
    assert.match(session.csrfToken, /^[0-9a-f]{48}$/);
    const authenticated = subject.store.authenticate(session.token);
    assert.equal(authenticated.csrfToken, session.csrfToken);
    assert.throws(() => subject.store.bootstrap('another-password'), (error) => error instanceof AuthStoreError && error.statusCode === 409);
  } finally { subject.cleanup(); }
});

test('rejects short passwords and invalid login attempts', () => {
  const subject = fixture();
  try {
    assert.throws(() => subject.store.bootstrap('short'), AuthStoreError);
    subject.store.bootstrap('correct-horse');
    assert.throws(() => subject.store.login('wrong-password'), (error) => error instanceof AuthStoreError && error.statusCode === 401);
    const session = subject.store.login('correct-horse');
    assert.throws(() => subject.store.assertCsrf(session, 'bad-token'), (error) => error instanceof AuthStoreError && error.statusCode === 403);
  } finally { subject.cleanup(); }
});

test('persists hashed credentials and forgets sessions on logout', () => {
  const subject = fixture();
  try {
    const session = subject.store.bootstrap('correct-horse');
    const saved = JSON.parse(fs.readFileSync(path.join(subject.directory, 'auth.json'), 'utf8'));
    assert.equal(Object.hasOwn(saved.owner, 'passwordHash'), true);
    assert.doesNotMatch(JSON.stringify(saved), /correct-horse/);
    subject.store.logout(session.token);
    assert.throws(() => subject.store.authenticate(session.token), AuthStoreError);
  } finally { subject.cleanup(); }
});
