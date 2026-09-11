'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectGenomeStore, StoreError } = require('./genome-store');
const { WorkspaceStore, WorkspaceStoreError } = require('./workspace-store');
const { WorkspaceFiles, WorkspaceFileError } = require('./workspace-files');
const { GitService, GitServiceError } = require('./git-service');
const { RuntimeAdapter, RuntimeAdapterError } = require('./runtime-adapter');
const { AuthStore, AuthStoreError } = require('./auth-store');
const { AiStudio, AiStudioError, loadGrokCliToken } = require('./ai-studio');
const { isWebSocketUpgrade, accept } = require('./websocket');

const ROOT_DIR = path.join(__dirname, '..');
const BODY_LIMIT = 100_000;
const PREVIEW_LIMIT = 1_000_000;
const SESSION_COOKIE = 'sn_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createApp(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  if (!options.skipEnvFile) loadDotEnv(options.envFile || path.join(rootDir, '.env'));
  const publicDir = options.publicDir || path.join(rootDir, 'public');
  const store = new ProjectGenomeStore(options.dataFile || path.join(rootDir, 'data', 'project-genomes.json'));
  const workspaceStore = new WorkspaceStore(options.workspaceDataFile || path.join(rootDir, 'data', 'workspaces.json'));
  const workspacesRoot = options.workspacesRoot || path.join(rootDir, 'data', 'workspaces');
  const exportsRoot = options.exportsRoot || path.join(rootDir, 'data', 'exports');
  const files = new WorkspaceFiles(workspacesRoot);
  const gitService = options.gitService || new GitService({
    workspacesRoot,
    exportsRoot,
    templatesRoot: path.join(rootDir, 'templates')
  });
  const runtime = options.runtimeAdapter || new RuntimeAdapter({ workspacesRoot });
  const auth = new AuthStore(options.authFile || path.join(rootDir, 'data', 'auth.json'));
  const cookieSecure = options.cookieSecure ?? process.env.SYNAPSENEST_SECURE_COOKIES === '1';
  const fetchImpl = options.fetch || globalThis.fetch;
  const ai = options.aiStudio || new AiStudio({
    apiKey: options.aiApiKey !== undefined
      ? options.aiApiKey
      : (process.env.XAI_API_KEY || (options.skipGrokAuth ? '' : loadGrokCliToken())),
    model: options.aiModel || process.env.XAI_MODEL,
    fetchImpl: options.aiFetch || fetchImpl
  });

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      sendJson(response, 500, { error: 'Internal server error.' });
    });
  });

  server.on('upgrade', (request, socket, head) => {
    handleUpgrade(request, socket, head).catch(() => {
      try { socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n'); } catch { /* ignore */ }
      socket.destroy();
    });
  });

  async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method || 'GET';
    try {
      if (url.pathname === '/api/health' && method === 'GET') return sendJson(response, 200, { ok: true, product: 'SynapseNest' });
      if (url.pathname === '/api/ai/status' && method === 'GET') return sendJson(response, 200, ai.status());
      if (url.pathname === '/api/auth/session' && method === 'GET') return handleAuthSession(request, response);
      if (url.pathname === '/api/auth/bootstrap' && method === 'POST') return handleBootstrap(request, response);
      if (url.pathname === '/api/auth/login' && method === 'POST') return handleLogin(request, response);
      if (url.pathname === '/api/auth/logout' && method === 'POST') return handleLogout(request, response);

      if (url.pathname === '/api/projects' && method === 'GET') return sendJson(response, 200, { projects: store.listProjects() });
      if (url.pathname === '/api/projects' && method === 'POST') return sendJson(response, 201, { project: store.createProject(await readJson(request)) });
      const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(synapses|winner|publish|export))?$/.exec(url.pathname);
      if (projectMatch) return await handleProjectRoute(request, response, method, decodeProjectId(projectMatch[1]), projectMatch[2]);

      const workspaceMatch = /^\/api\/workspaces(?:\/([^/]+))?(?:\/(start|stop|files|file|snapshots|export|preview|terminal|ai)(?:\/(.*))?)?$/.exec(url.pathname);
      if (workspaceMatch) return await handleWorkspaceRoute(request, response, method, url, workspaceMatch[1], workspaceMatch[2], workspaceMatch[3]);

      if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API route not found.' });
      if (url.pathname === '/workspace') return serveStatic('/workspace.html', response);
      if (/^\/proof\/[^/]+\/[^/]+$/.test(url.pathname)) return serveStatic('/proof.html', response);
      return serveStatic(url.pathname, response);
    } catch (error) {
      return sendError(response, error);
    }
  }

  async function handleAuthSession(request, response) {
    if (!auth.hasOwner()) return sendJson(response, 200, { owner: false, authenticated: false });
    try {
      const session = auth.authenticate(readCookies(request)[SESSION_COOKIE]);
      return sendJson(response, 200, { owner: true, authenticated: true, csrfToken: session.csrfToken });
    } catch {
      return sendJson(response, 200, { owner: true, authenticated: false });
    }
  }

  async function handleBootstrap(request, response) {
    assertSameOrigin(request);
    const body = await readJson(request);
    const session = auth.bootstrap(body.password);
    setSessionCookie(response, session.token, cookieSecure);
    return sendJson(response, 201, { owner: true, authenticated: true, csrfToken: session.csrfToken });
  }

  async function handleLogin(request, response) {
    assertSameOrigin(request);
    const body = await readJson(request);
    const session = auth.login(body.password);
    setSessionCookie(response, session.token, cookieSecure);
    return sendJson(response, 200, { owner: true, authenticated: true, csrfToken: session.csrfToken });
  }

  async function handleLogout(request, response) {
    const token = readCookies(request)[SESSION_COOKIE];
    if (token) {
      try {
        const session = auth.authenticate(token);
        if (MUTATING.has(request.method || '')) auth.assertCsrf(session, request.headers['x-csrf-token']);
      } catch (error) {
        if (!(error instanceof AuthStoreError && error.statusCode === 401)) throw error;
      }
    }
    auth.logout(token);
    clearSessionCookie(response, cookieSecure);
    return sendJson(response, 200, { owner: auth.hasOwner(), authenticated: false });
  }

  async function handleProjectRoute(request, response, method, projectId, action) {
    if (!action && method === 'GET') return sendJson(response, 200, { project: store.getProject(projectId) });
    if (action === 'synapses' && method === 'POST') {
      store.forkSynapse(projectId, await readJson(request));
      return sendJson(response, 201, { project: store.getProject(projectId) });
    }
    if (action === 'winner' && method === 'POST') return sendJson(response, 200, { project: store.selectWinner(projectId, await readJson(request)) });
    if (action === 'publish' && method === 'POST') {
      store.publish(projectId, await readJson(request));
      return sendJson(response, 201, { project: store.getProject(projectId) });
    }
    if (action === 'export' && method === 'GET') {
      const payload = store.exportProject(projectId);
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${projectId}-genome.json"`,
        'Cache-Control': 'no-store'
      });
      return response.end(`${JSON.stringify(payload, null, 2)}\n`);
    }
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  async function handleWorkspaceRoute(request, response, method, url, workspaceId, action, rest) {
    const session = requireSession(request);
    if (MUTATING.has(method)) auth.assertCsrf(session, request.headers['x-csrf-token']);

    if (!workspaceId && method === 'GET') return sendJson(response, 200, { workspaces: workspaceStore.listWorkspaces() });
    if (!workspaceId && method === 'POST') {
      const workspace = workspaceStore.createWorkspace(await readJson(request));
      gitService.createStarter(workspace.id);
      try { startWorkspace(workspace.id); } catch { /* runtime start is best-effort on create */ }
      return sendJson(response, 201, { workspace: workspaceStore.getWorkspace(workspace.id) });
    }
    if (!workspaceId) return sendJson(response, 405, { error: 'Method not allowed.' });
    if (!WORKSPACE_ID.test(workspaceId)) throw Object.assign(new Error('Workspace ID is invalid.'), { statusCode: 400 });

    const workspace = workspaceStore.getWorkspace(workspaceId);
    if (!action && method === 'GET') return sendJson(response, 200, { workspace });
    if (action === 'start' && method === 'POST') return sendJson(response, 200, { workspace: startWorkspace(workspaceId) });
    if (action === 'stop' && method === 'POST') return sendJson(response, 200, { workspace: stopWorkspace(workspaceId) });
    if (action === 'files' && method === 'GET') return sendJson(response, 200, { files: files.listFiles(workspaceId) });
    if (action === 'file' && method === 'GET') return sendJson(response, 200, { path: String(url.searchParams.get('path') || ''), content: files.readFile(workspaceId, url.searchParams.get('path')) });
    if (action === 'file' && method === 'PUT') {
      const body = await readJson(request);
      files.writeFile(workspaceId, body.path, body.content);
      return sendJson(response, 200, { path: body.path, content: files.readFile(workspaceId, body.path) });
    }
    if (action === 'snapshots' && method === 'POST') {
      const body = await readJson(request);
      const snapshot = gitService.createSnapshot(workspaceId, body.branch);
      return sendJson(response, 201, { snapshot, workspace: workspaceStore.getWorkspace(workspaceId) });
    }
    if (action === 'export' && method === 'GET') {
      const format = url.searchParams.get('format') || 'tar';
      const archive = gitService.exportWorkspace(workspaceId, format);
      const data = fs.readFileSync(archive.path);
      try { fs.unlinkSync(archive.path); } catch { /* export file is best-effort cleanup */ }
      response.writeHead(200, {
        'Content-Type': format === 'zip' ? 'application/zip' : 'application/x-tar',
        'Content-Disposition': `attachment; filename="workspace-${workspaceId}.${format}"`,
        'Cache-Control': 'no-store'
      });
      return response.end(data);
    }
    if (action === 'preview' && method === 'GET') return proxyPreview(request, response, workspace, rest);
    if (action === 'ai' && method === 'POST') return sendJson(response, 200, await runWorkspaceAi(workspaceId, await readJson(request)));
    if (action === 'terminal') return sendJson(response, 426, { error: 'Workspace terminal requires a WebSocket upgrade.' });
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  function startWorkspace(workspaceId) {
    const workspace = workspaceStore.requireWorkspace(workspaceId);
    if (workspace.status === 'archived') throw new WorkspaceStoreError('Cannot start an archived workspace.', 409);
    ensureStarter(workspaceId);
    let runtimeId = workspace.runtimeId;
    if (runtimeId) {
      try { runtime.status(runtimeId); } catch { runtimeId = ''; }
    }
    if (!runtimeId) {
      runtimeId = runtime.create(workspaceId).id;
      workspaceStore.setRuntimeId(workspaceId, runtimeId);
    }
    runtime.start(runtimeId);
    if (workspace.status !== 'running') workspaceStore.transitionWorkspace(workspaceId, 'running');
    return workspaceStore.getWorkspace(workspaceId);
  }

  function stopWorkspace(workspaceId) {
    const workspace = workspaceStore.requireWorkspace(workspaceId);
    if (workspace.runtimeId) {
      try { runtime.stop(workspace.runtimeId); } catch (error) {
        if (!(error instanceof RuntimeAdapterError && error.statusCode === 404)) throw error;
      }
    }
    if (workspace.status === 'running') workspaceStore.transitionWorkspace(workspaceId, 'stopped');
    return workspaceStore.getWorkspace(workspaceId);
  }

  async function runWorkspaceAi(workspaceId, body) {
    const listing = files.listFiles(workspaceId);
    const context = listing.slice(0, 12).map((entry) => ({
      path: entry.path,
      content: files.readFile(workspaceId, entry.path)
    }));
    const result = await ai.turn({ prompt: body.prompt, files: context });
    const written = [];
    const rejected = [];
    for (const file of result.files) {
      try {
        files.writeFile(workspaceId, file.path, file.content);
        written.push(file.path);
      } catch (error) {
        rejected.push({ path: file.path, error: error.message });
      }
    }
    return {
      reply: result.reply,
      written,
      rejected,
      files: files.listFiles(workspaceId)
    };
  }

  function ensureStarter(workspaceId) {
    const workspacePath = gitService.workspacePath(workspaceId);
    const entries = fs.readdirSync(workspacePath).filter((name) => name !== '.git');
    if (entries.length === 0) gitService.createStarter(workspaceId);
  }

  async function proxyPreview(request, response, workspace, rest) {
    if (workspace.status !== 'running' || !workspace.runtimeId) {
      return sendJson(response, 409, { error: 'Workspace preview is not running.' });
    }
    const target = runtime.previewTarget(workspace.runtimeId);
    if (!isAllowedPreviewHost(target.host) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
      throw new RuntimeAdapterError('Preview target is invalid.', 503);
    }
    const suffix = `/${String(rest || '').replace(/^\/+/, '')}`;
    const previewUrl = `http://${target.host}:${target.port}${suffix === '/' ? '/' : suffix}${new URL(request.url, 'http://localhost').search}`;
    if (typeof fetchImpl !== 'function') throw new RuntimeAdapterError('Preview proxy is unavailable.', 503);
    const proxied = await fetchImpl(previewUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const buffer = Buffer.from(await proxied.arrayBuffer());
    if (buffer.length > PREVIEW_LIMIT) return sendJson(response, 413, { error: 'Preview response is too large.' });
    const contentType = proxied.headers.get('content-type') || 'application/octet-stream';
    response.writeHead(proxied.status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; script-src 'unsafe-inline' 'self'"
    });
    return response.end(buffer);
  }

  async function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const match = /^\/api\/workspaces\/([^/]+)\/terminal$/.exec(url.pathname);
    if (!isWebSocketUpgrade(request) || !match) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      requireSession(request);
      const workspaceId = match[1];
      if (!WORKSPACE_ID.test(workspaceId)) throw Object.assign(new Error('Workspace ID is invalid.'), { statusCode: 400 });
      const workspace = workspaceStore.getWorkspace(workspaceId);
      if (workspace.status !== 'running' || !workspace.runtimeId) throw Object.assign(new Error('Workspace terminal is not running.'), { statusCode: 409 });
      const ws = accept(request, socket, head);
      if (!ws) return;
      const shell = runtime.attachShell(workspace.runtimeId);
      const stopShell = () => {
        try { shell.stdin.end(); } catch { /* already closed */ }
        try { shell.kill('SIGKILL'); } catch { /* already exited */ }
      };
      shell.stdout.on('data', (chunk) => ws.send(chunk.toString('utf8')));
      shell.stderr.on('data', (chunk) => ws.send(chunk.toString('utf8')));
      shell.on('close', () => ws.close());
      ws.on('message', (text) => {
        try { shell.stdin.write(text); } catch { /* shell already closed */ }
      });
      ws.on('close', stopShell);
      ws.send('workspace shell ready\n');
    } catch (error) {
      const status = error.statusCode || 500;
      const message = status === 401 ? 'Unauthorized' : status === 409 ? 'Conflict' : 'Bad Request';
      socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    }
  }

  function requireSession(request) {
    return auth.authenticate(readCookies(request)[SESSION_COOKIE]);
  }

  function serveStatic(pathname, response) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    let decoded;
    try { decoded = decodeURIComponent(requested); } catch { return sendJson(response, 400, { error: 'Malformed URL.' }); }
    const filePath = path.resolve(publicDir, `.${decoded}`);
    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden.' });
    fs.readFile(filePath, (error, data) => {
      if (error) return sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Could not read static file.' });
      response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      response.end(data);
    });
  }

  function sendError(response, error) {
    if (
      error instanceof StoreError
      || error instanceof WorkspaceStoreError
      || error instanceof WorkspaceFileError
      || error instanceof GitServiceError
      || error instanceof RuntimeAdapterError
      || error instanceof AuthStoreError
      || error instanceof AiStudioError
      || error.statusCode
    ) {
      return sendJson(response, error.statusCode || 400, { error: error.message });
    }
    console.error(error);
    return sendJson(response, 500, { error: 'Internal server error.' });
  }

  return { server, store, workspaceStore, auth, ai };
}

function loadDotEnv(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const name = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > BODY_LIMIT) reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try {
        const value = JSON.parse(body);
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Request body must be a JSON object.');
        resolve(value);
      } catch (error) { reject(Object.assign(new Error(error.message === 'Request body must be a JSON object.' ? error.message : 'Request body must contain valid JSON.'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, body) {
  if (response.headersSent) return;
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(`${JSON.stringify(body)}\n`);
}

function decodeProjectId(encodedId) {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    throw Object.assign(new Error('Malformed project ID.'), { statusCode: 400 });
  }
}

function numberFromEnvironment(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 65536 ? number : fallback;
}

function readCookies(request) {
  const header = request.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { cookies[name] = decodeURIComponent(value); } catch { cookies[name] = value; }
  }
  return cookies;
}

function setSessionCookie(response, token, secure) {
  appendCookie(response, `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(response, secure) {
  appendCookie(response, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

function appendCookie(response, cookie) {
  const current = response.getHeader('Set-Cookie');
  if (!current) response.setHeader('Set-Cookie', cookie);
  else response.setHeader('Set-Cookie', Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.headers.host) {
      throw Object.assign(new Error('Cross-origin request is not allowed.'), { statusCode: 403 });
    }
  } catch (error) {
    if (error.statusCode) throw error;
    throw Object.assign(new Error('Cross-origin request is not allowed.'), { statusCode: 403 });
  }
}

function isAllowedPreviewHost(host) {
  if (host === '127.0.0.1' || host === 'localhost') return true;
  const parts = String(host || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

if (require.main === module) {
  const port = numberFromEnvironment(process.env.PORT, 3000);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createApp();
  server.listen(port, host, () => {
    console.log(`SynapseNest listening on http://${host}:${port}`);
  });
}

module.exports = { createApp, numberFromEnvironment };
