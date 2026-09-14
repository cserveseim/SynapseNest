'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const script = path.join(__dirname, '..', 'deploy', 'migrate-json-to-pg.js');
const schema = path.join(__dirname, '..', 'deploy', 'schema.sql');

test('schema.sql covers auth, sessions, workspaces, and genomes', () => {
  const sql = fs.readFileSync(schema, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS auth_owner/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspaces/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS project_genomes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS project_synapses/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS project_publications/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b/i);
  assert.doesNotMatch(sql, /unlink|rm -|DELETE FROM auth\.json/i);
});

test('importer dry-run inventories JSON and does not rewrite files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-migrate-'));
  const auth = {
    version: 1,
    owner: { passwordSalt: 'ab', passwordHash: 'cd', createdAt: '2026-09-11T00:00:00.000Z' },
    sessions: [{ tokenHash: 't1', csrfToken: 'c1', expiresAt: '2026-09-18T00:00:00.000Z' }]
  };
  const workspaces = {
    version: 1,
    workspaces: [{
      id: '11111111-1111-4111-8111-111111111111',
      status: 'created',
      templateId: 'static-site',
      recipe: { id: 'static-site' },
      selectedBranch: 'main',
      selectedSynapseId: '',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z'
    }]
  };
  const genomes = {
    version: 1,
    projects: [{
      id: 'project_1',
      title: 'Demo',
      description: '',
      template: 'blank',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      environment: { runtime: 'static' },
      winnerId: 'syn_1',
      synapses: [{
        id: 'syn_1', name: 'Primary', parentId: null, note: 'n', status: 'winner',
        previewTheme: 'aurora', createdAt: '2026-09-11T00:00:00.000Z'
      }],
      publications: []
    }]
  };

  const authFile = path.join(dir, 'auth.json');
  const wsFile = path.join(dir, 'workspaces.json');
  const genomeFile = path.join(dir, 'project-genomes.json');
  fs.writeFileSync(authFile, `${JSON.stringify(auth, null, 2)}\n`);
  fs.writeFileSync(wsFile, `${JSON.stringify(workspaces, null, 2)}\n`);
  fs.writeFileSync(genomeFile, `${JSON.stringify(genomes, null, 2)}\n`);
  const before = {
    auth: fs.readFileSync(authFile, 'utf8'),
    ws: fs.readFileSync(wsFile, 'utf8'),
    genomes: fs.readFileSync(genomeFile, 'utf8')
  };

  const result = spawnSync(process.execPath, [script, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dir, USE_POSTGRES: '0' }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /sessions\s+= 1/);
  assert.match(result.stdout, /workspaces\s+= 1/);
  assert.match(result.stdout, /project_genomes\s+= 1/);
  assert.match(result.stdout, /project_synapses\s+= 1/);
  assert.match(result.stdout, /Dry-run only/);
  assert.equal(fs.readFileSync(authFile, 'utf8'), before.auth);
  assert.equal(fs.readFileSync(wsFile, 'utf8'), before.ws);
  assert.equal(fs.readFileSync(genomeFile, 'utf8'), before.genomes);
});

test('store-factory defaults to JSON and exposes postgresRequested', () => {
  const factory = require('../src/store-factory');
  assert.equal(typeof factory.createStores, 'function');
  assert.equal(typeof factory.createPostgresStores, 'function');
  assert.equal(factory.postgresRequested(), process.env.USE_POSTGRES === '1');
  const stores = factory.createJsonStores({
    authFile: require('node:path').join(require('node:os').tmpdir(), 'sn-auth-missing.json'),
    workspaceDataFile: require('node:path').join(require('node:os').tmpdir(), 'sn-ws-missing.json'),
    dataFile: require('node:path').join(require('node:os').tmpdir(), 'sn-genome-missing.json')
  });
  assert.equal(stores.backend, 'json');
});
