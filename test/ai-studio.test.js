'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { AiStudio, loadGrokCliToken } = require('../src/ai-studio');

test('loads a Grok CLI access token from an auth.json file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-grok-auth-'));
  const authFile = path.join(directory, 'auth.json');
  try {
    fs.writeFileSync(authFile, JSON.stringify({
      'https://auth.x.ai::client': { key: 'xai-oauth-access-token-placeholder-value', refresh_token: 'refresh' }
    }));
    assert.equal(loadGrokCliToken(authFile), 'xai-oauth-access-token-placeholder-value');
    assert.equal(loadGrokCliToken(path.join(directory, 'missing.json')), '');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reports SpaceXAI as configured when an API key is present', () => {
  const studio = new AiStudio({ apiKey: 'xai-test' });
  assert.deepEqual(studio.status(), { configured: true, model: 'grok-4.6', provider: 'SpaceXAI' });
});
