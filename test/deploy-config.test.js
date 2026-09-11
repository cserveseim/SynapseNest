'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'deploy', 'docker-compose.yml'), 'utf8');
const unit = fs.readFileSync(path.join(root, 'deploy', 'systemd', 'synapsenest.service'), 'utf8');
const tunnel = fs.readFileSync(path.join(root, 'deploy', 'cloudflared', 'config.yml'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');

test('runtime compose profile never publishes a Docker port', () => {
  assert.match(compose, /network_mode:\s*none/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.doesNotMatch(compose, /0\.0\.0\.0:/);
});

test('systemd unit binds the single app process to localhost by default and does not embed secrets', () => {
  assert.match(unit, /User=nexus/);
  assert.match(unit, /PORT=3000/);
  assert.match(unit, /HOST=127\.0\.0\.1/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node src\/server\.js/);
  assert.doesNotMatch(unit, /password|token|BEGIN /i);
});

test('Cloudflare tunnel template only forwards to the local app', () => {
  assert.match(tunnel, /synapsenest\.eim-agent\.com/);
  assert.match(tunnel, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(tunnel, /YOUR_TUNNEL_ID/);
  assert.doesNotMatch(tunnel, /3000:3000/);
});

test('Wrangler config keeps placeholders instead of credentials', () => {
  assert.match(wrangler, /YOUR_CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(wrangler, /[A-Za-z0-9]{40,}/);
});
