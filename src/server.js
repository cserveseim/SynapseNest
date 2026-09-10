'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ProjectGenomeStore, StoreError } = require('./genome-store');

const PORT = numberFromEnvironment(process.env.PORT, 3000);
const DATA_FILE = process.env.SYNAPSENEST_DATA_FILE || path.join(__dirname, '..', 'data', 'project-genomes.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BODY_LIMIT = 100_000;
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const store = new ProjectGenomeStore(DATA_FILE);
const server = http.createServer((request, response) => handle(request, response).catch((error) => {
  console.error(error);
  sendJson(response, 500, { error: 'Internal server error.' });
}));

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const method = request.method || 'GET';
  try {
    if (url.pathname === '/api/projects' && method === 'GET') return sendJson(response, 200, { projects: store.listProjects() });
    if (url.pathname === '/api/projects' && method === 'POST') return sendJson(response, 201, { project: store.createProject(await readJson(request)) });
    const match = /^\/api\/projects\/([^/]+)(?:\/(synapses|winner|publish|export))?$/.exec(url.pathname);
    if (match) return await handleProjectRoute(request, response, method, decodeProjectId(match[1]), match[2]);
    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API route not found.' });
    return serveStatic(url.pathname, response);
  } catch (error) {
    if (error instanceof StoreError) return sendJson(response, error.statusCode, { error: error.message });
    if (error.statusCode) return sendJson(response, error.statusCode, { error: error.message });
    throw error;
  }
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
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${projectId}-genome.json"`, 'Cache-Control': 'no-store' });
    return response.end(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return sendJson(response, 405, { error: 'Method not allowed.' });
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

function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { return sendJson(response, 400, { error: 'Malformed URL.' }); }
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(response, 403, { error: 'Forbidden.' });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'Not found.' : 'Could not read static file.' });
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(`${JSON.stringify(body)}\n`);
}
function decodeProjectId(encodedId) {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    throw Object.assign(new Error("Malformed project ID."), { statusCode: 400 });
  }
}

function numberFromEnvironment(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 65536 ? number : fallback;
}

if (require.main === module) server.listen(PORT, () => console.log(`SynapseNest listening on http://localhost:${PORT}`));
module.exports = { server, store };
