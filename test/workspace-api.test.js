'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../src/server');

const PASSWORD = 'correct-horse';
const RUNTIME_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-workspace-api-'));
  const preview = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<h1>preview ${request.url}</h1>`);
  });
  return { directory, preview };
}

async function startApp(directory, previewPort) {
  const { server } = createApp({
    rootDir: path.join(__dirname, '..'),
    dataFile: path.join(directory, 'genomes.json'),
    workspaceDataFile: path.join(directory, 'workspaces.json'),
    workspacesRoot: path.join(directory, 'workspaces'),
    exportsRoot: path.join(directory, 'exports'),
    authFile: path.join(directory, 'auth.json'),
    runtimeAdapter: {
      create() { return { id: RUNTIME_ID, status: 'created' }; },
      start(id) { return { id, status: 'running' }; },
      stop(id) { return { id, status: 'stopped' }; },
      status(id) { return { id, status: 'running' }; },
      previewTarget() { return { host: '127.0.0.1', port: previewPort }; },
      attachShell() {
        return childProcess.spawn(process.execPath, ['-e', 'process.stdin.on("data", (chunk) => process.stdout.write(chunk));'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
      }
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test('denies workspace access until the owner session is established', async () => {
  const subject = fixture();
  const { server, origin } = await startApp(subject.directory, 9);
  try {
    const denied = await request(origin, 'GET', '/api/workspaces');
    assert.equal(denied.status, 401);
    const bootstrap = await request(origin, 'POST', '/api/auth/bootstrap', { password: PASSWORD });
    assert.equal(bootstrap.status, 201);
    const listed = await request(origin, 'GET', '/api/workspaces', undefined, bootstrap);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.workspaces, []);
  } finally {
    await close(server);
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('creates, edits, starts, snapshots, exports, and proxies a workspace', async () => {
  const subject = fixture();
  await new Promise((resolve) => subject.preview.listen(0, '127.0.0.1', resolve));
  const { server, origin } = await startApp(subject.directory, subject.preview.address().port);
  try {
    const session = await request(origin, 'POST', '/api/auth/bootstrap', { password: PASSWORD });
    const created = await request(origin, 'POST', '/api/workspaces', { templateId: 'static-site' }, session);
    assert.equal(created.status, 201);
    const workspaceId = created.body.workspace.id;
    assert.match(workspaceId, /^[0-9a-f-]{36}$/i);

    const files = await request(origin, 'GET', `/api/workspaces/${workspaceId}/files`, undefined, session);
    assert.equal(files.status, 200);
    assert.equal(files.body.files.some((file) => file.path === 'index.html'), true);

    const saved = await request(origin, 'PUT', `/api/workspaces/${workspaceId}/file`, { path: 'index.html', content: '<h1>edited</h1>\n' }, session);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.content, '<h1>edited</h1>\n');

    const started = await request(origin, 'POST', `/api/workspaces/${workspaceId}/start`, {}, session);
    assert.equal(started.status, 200);
    assert.equal(started.body.workspace.status, 'running');
    assert.equal(started.body.workspace.runtimeId, RUNTIME_ID);

    const preview = await request(origin, 'GET', `/api/workspaces/${workspaceId}/preview/`, undefined, session);
    assert.equal(preview.status, 200);
    assert.match(preview.text, /preview \//);

    const snapshot = await request(origin, 'POST', `/api/workspaces/${workspaceId}/snapshots`, { branch: 'snapshot-1' }, session);
    assert.equal(snapshot.status, 201);
    assert.equal(snapshot.body.snapshot.branch, 'snapshot-1');

    const exported = await request(origin, 'GET', `/api/workspaces/${workspaceId}/export?format=tar`, undefined, session);
    assert.equal(exported.status, 200);
    assert.equal(exported.headers['content-type'], 'application/x-tar');
    assert.doesNotMatch(exported.text, /\/tmp\/|\/home\/nexus/);

    const stopped = await request(origin, 'POST', `/api/workspaces/${workspaceId}/stop`, {}, session);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.workspace.status, 'stopped');
  } finally {
    await close(server);
    await close(subject.preview);
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('rejects mutating workspace requests without a CSRF token', async () => {
  const subject = fixture();
  const { server, origin } = await startApp(subject.directory, 9);
  try {
    const session = await request(origin, 'POST', '/api/auth/bootstrap', { password: PASSWORD });
    const response = await request(origin, 'POST', '/api/workspaces', { templateId: 'static-site' }, { cookie: session.cookie, csrfToken: 'deadbeef' });
    assert.equal(response.status, 403);
  } finally {
    await close(server);
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

test('does not expose the terminal over plain HTTP', async () => {
  const subject = fixture();
  const { server, origin } = await startApp(subject.directory, 9);
  try {
    const session = await request(origin, 'POST', '/api/auth/bootstrap', { password: PASSWORD });
    const created = await request(origin, 'POST', '/api/workspaces', { templateId: 'static-site' }, session);
    const denied = await request(origin, 'GET', `/api/workspaces/${created.body.workspace.id}/terminal`);
    const missing = await request(origin, 'GET', `/api/workspaces/${created.body.workspace.id}/terminal`, undefined, session);
    assert.equal(denied.status, 401);
    assert.equal(missing.status, 426);
  } finally {
    await close(server);
    fs.rmSync(subject.directory, { recursive: true, force: true });
  }
});

function request(origin, method, pathname, body, session) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(pathname, origin);
    const headers = {};
    if (payload) headers['Content-Type'] = 'application/json';
    if (session?.cookie) headers.Cookie = `sn_session=${session.cookie}`;
    if (session?.csrfToken && payload !== undefined) headers['X-CSRF-Token'] = session.csrfToken;
    const req = http.request(url, { method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        const contentType = response.headers['content-type'] || '';
        const setCookie = String(response.headers['set-cookie'] || '');
        const cookieMatch = /sn_session=([^;]+)/.exec(setCookie);
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text,
          body: contentType.includes('application/json') && text ? JSON.parse(text) : undefined,
          cookie: cookieMatch ? cookieMatch[1] : session?.cookie,
          csrfToken: (contentType.includes('application/json') && text ? JSON.parse(text).csrfToken : undefined) || session?.csrfToken
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  });
}
