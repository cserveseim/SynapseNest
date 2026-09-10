'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { server } = require('../src/server');

let origin;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  origin = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('creates, forks, selects, publishes, and exports a Project Genome', async () => {
  const created = await request('POST', '/api/projects', {
    title: 'Release workflow',
    description: 'A complete API lifecycle.',
    template: 'portfolio'
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.synapses.length, 1);

  const projectId = created.body.project.id;
  const rootId = created.body.project.synapses[0].id;
  const forked = await request('POST', `/api/projects/${projectId}/synapses`, {
    parentId: rootId,
    name: 'Contrast branch',
    note: 'Make the primary action clearer.',
    previewTheme: 'ocean'
  });
  assert.equal(forked.status, 201);
  const forkId = forked.body.project.synapses.at(-1).id;
  assert.equal(forked.body.project.synapses.at(-1).parentId, rootId);

  const selected = await request('POST', `/api/projects/${projectId}/winner`, { synapseId: forkId });
  assert.equal(selected.status, 200);
  assert.equal(selected.body.project.winnerId, forkId);

  const published = await request('POST', `/api/projects/${projectId}/publish`, { synapseId: forkId });
  assert.equal(published.status, 201);
  assert.equal(published.body.project.publications[0].synapseId, forkId);

  const exported = await request('GET', `/api/projects/${projectId}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.schemaVersion, 1);
  assert.equal(exported.body.project.id, projectId);
});

test('serves a public proof page for a published synapse', async () => {
  const created = await request('POST', '/api/projects', { title: 'Proof link', description: 'A shareable result.', template: 'portfolio' });
  const project = created.body.project;
  const published = await request('POST', `/api/projects/${project.id}/publish`, { synapseId: project.winnerId });
  const proofPath = published.body.project.publications[0].proofUrl;

  const proof = await request('GET', proofPath);
  assert.equal(proof.status, 200);
  assert.match(proof.text, /SynapseNest Proof/i);
});

test('returns 400 for malformed percent-encoded project IDs', async () => {
  const response = await request('GET', '/api/projects/%E0%A4%A');
  assert.equal(response.status, 400);
  assert.match(response.body.error, /malformed/i);
});

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(pathname, origin);
    const request = http.request(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        const contentType = response.headers['content-type'] || '';
        resolve({ status: response.statusCode, text, body: contentType.includes('application/json') && text ? JSON.parse(text) : undefined });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
