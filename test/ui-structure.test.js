'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('dialog dismissal controls never submit create or fork forms', () => {
  const dismissalButtons = html.match(/<button[^>]*class="close"[^>]*>×<\/button>|<button[^>]*class="quiet"[^>]*>Cancel<\/button>/g) || [];
  assert.ok(dismissalButtons.length >= 4);
  for (const button of dismissalButtons) assert.match(button, /type="button"/);
});

test('responsive layout includes compact-phone rules and prevents horizontal overflow', () => {
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /min-width:0/);
});
