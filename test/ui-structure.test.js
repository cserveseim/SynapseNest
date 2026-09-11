'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const workspaceHtml = fs.readFileSync(path.join(root, 'public', 'workspace.html'), 'utf8');
const workspaceCss = fs.readFileSync(path.join(root, 'public', 'workspace.css'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(root, 'public', 'workspace.js'), 'utf8');

test('dialog dismissal controls never submit create or fork forms', () => {
  const dismissalButtons = html.match(/<button[^>]*class="close"[^>]*>×<\/button>|<button[^>]*class="quiet"[^>]*>Cancel<\/button>/g) || [];
  assert.ok(dismissalButtons.length >= 4);
  for (const button of dismissalButtons) assert.match(button, /type="button"/);
});

test('responsive layout includes compact-phone rules and prevents horizontal overflow', () => {
  assert.match(css, /@media\s*\(\s*max-width:\s*480px\s*\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /min-width:\s*0/);
});

test('workspace IDE uses relative APIs, a sandboxed preview, and a single-pane mobile mode', () => {
  assert.match(workspaceHtml, /sandbox="allow-scripts allow-forms"/);
  assert.doesNotMatch(workspaceHtml, /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.match(workspaceJs, /\/api\/workspaces\/\$\{workspaceId\}\/terminal/);
  assert.match(workspaceJs, /\/api\/workspaces\/\$\{state\.workspace\.id\}\/ai/);
  assert.match(workspaceHtml, /id="chatForm"/);
  assert.match(workspaceHtml, /id="previewPip"/);
  assert.match(workspaceCss, /preview-pip/);
  assert.match(workspaceJs, /previewPip/);
  assert.match(workspaceJs, /WebSocket/);
  assert.match(workspaceJs, /location\.host/);
  assert.doesNotMatch(workspaceJs, /new WebSocket\([`'"]ws:\/\//);
  assert.match(workspaceCss, /@media\s*\(\s*max-width:\s*800px\s*\)/);
  assert.match(workspaceCss, /@media\s*\(\s*max-width:\s*480px\s*\)/);
  assert.match(workspaceCss, /\.pane\.active/);
});
