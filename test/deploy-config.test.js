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
const nginx = fs.readFileSync(path.join(root, 'deploy', 'nginx-synapsenest.conf'), 'utf8');

test('runtime compose profile never publishes a Docker port', () => {
  assert.match(compose, /network_mode:\s*none/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.doesNotMatch(compose, /0\.0\.0\.0:/);
});

test('systemd unit binds the single app process to localhost by default and does not embed secrets', () => {
  assert.match(unit, /User=nexus/);
  assert.match(unit, /PORT=3000/);
  assert.match(unit, /HOST=127\.0\.0\.1/);
  assert.match(unit, /SYNAPSENEST_SECURE_COOKIES=1/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node src\/server\.js/);
  assert.doesNotMatch(unit, /password|token|BEGIN /i);
});

test('Cloudflare tunnel template only forwards to the local app', () => {
  assert.match(tunnel, /synapsenest\.eim-agent\.com/);
  assert.match(tunnel, /http:\/\/127\.0\.0\.1:3000/);
  assert.match(tunnel, /YOUR_TUNNEL_ID/);
  assert.doesNotMatch(tunnel, /3000:3000/);
});

test('host nginx TLS frontend only proxies to localhost and does not publish Docker ports', () => {
  assert.match(nginx, /listen 8443 ssl/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(nginx, /0\.0\.0\.0:3000/);
});

test('Wrangler config points at the edge worker without embedding secrets', () => {
  assert.match(wrangler, /synapsenest-edge/);
  assert.match(wrangler, /deploy\/edge-worker\.js/);
  assert.doesNotMatch(wrangler, /oauth_token|TunnelSecret|BEGIN /);
});
