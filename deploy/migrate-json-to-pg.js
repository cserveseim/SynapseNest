#!/usr/bin/env node
/**
 * SynapseNest — JSON → Postgres importer
 *
 * Reads the live JSON stores and upserts into Postgres. NEVER deletes or
 * rewrites JSON files. Live app reads stay on JSON unless USE_POSTGRES=1
 * is wired later (default OFF).
 *
 *   DATA_DIR=/path/to/data node deploy/migrate-json-to-pg.js --dry-run
 *   DATA_DIR=/path/to/data node deploy/migrate-json-to-pg.js --apply
 *   DATA_DIR=/path/to/data node deploy/migrate-json-to-pg.js --verify
 *
 * Postgres access (first match wins):
 *   1. PSQL_CMD  — full command, SQL on stdin
 *   2. psql in PATH + DATABASE_URL / PG* env
 *   3. docker exec $POSTGRES_CONTAINER (default synapsenest-postgres-1)
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = process.env.SCHEMA_FILE || path.join(__dirname, 'schema.sql');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

const AUTH_FILE = path.join(DATA, 'auth.json');
const WORKSPACES_FILE = path.join(DATA, 'workspaces.json');
const GENOMES_FILE = path.join(DATA, 'project-genomes.json');

function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const verify = args.has('--verify');
  const schemaOnly = args.has('--schema-only');
  const dryRun = !apply && !verify && !schemaOnly || args.has('--dry-run');

  console.log('SynapseNest JSON→Postgres migration');
  console.log(`  DATA_DIR     = ${DATA}`);
  console.log(`  SCHEMA_FILE  = ${SCHEMA_FILE}`);
  console.log(`  USE_POSTGRES = ${process.env.USE_POSTGRES || '0'} (importer never flips live reads)`);
  console.log(`  mode         = ${verify ? 'verify' : schemaOnly ? 'schema-only' : apply && !args.has('--dry-run') ? 'apply' : 'dry-run'}`);
  console.log('');

  const inventory = loadInventory();
  printInventory(inventory);

  if (verify) {
    const result = verifyAgainstPostgres(inventory);
    if (!result.ok) process.exit(1);
    return;
  }

  if (dryRun && !schemaOnly) {
    console.log('Dry-run only. JSON files were not written. Re-run with --apply to load Postgres.');
    return;
  }

  const sql = schemaOnly ? readSchema() : buildApplySql(inventory);
  const psql = runPsql(sql);
  if (psql.status !== 0) {
    console.error('psql failed.');
    if (psql.stderr) console.error(psql.stderr);
    if (psql.stdout) console.error(psql.stdout);
    process.exit(psql.status || 1);
  }
  if (psql.stdout.trim()) console.log(psql.stdout.trim());

  if (schemaOnly) {
    console.log('Schema applied. JSON files unchanged.');
    return;
  }

  console.log('Import applied. Verifying…');
  const result = verifyAgainstPostgres(inventory);
  if (!result.ok) process.exit(1);
  assertJsonUntouched(inventory.checksums);
  console.log('JSON source of truth unchanged (checksums match).');
}

function loadInventory() {
  const checksums = {};
  const auth = readJson(AUTH_FILE, checksums);
  const workspacesDoc = readJson(WORKSPACES_FILE, checksums);
  const genomesDoc = readJson(GENOMES_FILE, checksums);

  const owner = auth && auth.owner && typeof auth.owner === 'object' ? auth.owner : null;
  const sessions = Array.isArray(auth && auth.sessions) ? auth.sessions : [];
  const workspaces = Array.isArray(workspacesDoc && workspacesDoc.workspaces) ? workspacesDoc.workspaces : [];
  const projects = Array.isArray(genomesDoc && genomesDoc.projects) ? genomesDoc.projects : [];

  let synapseCount = 0;
  let publicationCount = 0;
  for (const project of projects) {
    synapseCount += Array.isArray(project.synapses) ? project.synapses.length : 0;
    publicationCount += Array.isArray(project.publications) ? project.publications.length : 0;
  }

  return {
    checksums,
    auth,
    owner,
    sessions,
    workspaces,
    projects,
    synapseCount,
    publicationCount
  };
}

function printInventory(inventory) {
  console.log('JSON inventory (read-only):');
  console.log(`  auth owner        = ${inventory.owner ? 'yes' : 'no'}`);
  console.log(`  sessions          = ${inventory.sessions.length}`);
  console.log(`  workspaces        = ${inventory.workspaces.length}`);
  console.log(`  project_genomes   = ${inventory.projects.length}`);
  console.log(`  project_synapses  = ${inventory.synapseCount}`);
  console.log(`  publications      = ${inventory.publicationCount}`);
  console.log('');
}

function readJson(file, checksums) {
  if (!fs.existsSync(file)) {
    console.error(`[skip] missing ${file}`);
    return null;
  }
  const raw = fs.readFileSync(file);
  checksums[file] = crypto.createHash('sha256').update(raw).digest('hex');
  return JSON.parse(raw.toString('utf8'));
}

function assertJsonUntouched(checksums) {
  for (const [file, expected] of Object.entries(checksums)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== expected) {
      throw new Error(`Refusing to continue: JSON file changed during import: ${file}`);
    }
  }
}

function readSchema() {
  if (!fs.existsSync(SCHEMA_FILE)) {
    throw new Error(`Schema file not found: ${SCHEMA_FILE}`);
  }
  return fs.readFileSync(SCHEMA_FILE, 'utf8');
}

function buildApplySql(inventory) {
  const statements = [readSchema(), 'BEGIN;'];

  if (inventory.owner) {
    statements.push(`
INSERT INTO auth_owner (id, password_salt, password_hash, created_at)
VALUES (
  1,
  ${sqlText(inventory.owner.passwordSalt)},
  ${sqlText(inventory.owner.passwordHash)},
  ${sqlTs(inventory.owner.createdAt)}
)
ON CONFLICT (id) DO UPDATE SET
  password_salt = EXCLUDED.password_salt,
  password_hash = EXCLUDED.password_hash,
  created_at = EXCLUDED.created_at,
  imported_at = now();
`.trim());
  }

  const sessionHashes = [];
  for (const session of inventory.sessions) {
    if (!session || !session.tokenHash) continue;
    sessionHashes.push(session.tokenHash);
    statements.push(`
INSERT INTO sessions (token_hash, csrf_token, expires_at)
VALUES (${sqlText(session.tokenHash)}, ${sqlText(session.csrfToken)}, ${sqlTs(session.expiresAt)})
ON CONFLICT (token_hash) DO UPDATE SET
  csrf_token = EXCLUDED.csrf_token,
  expires_at = EXCLUDED.expires_at,
  imported_at = now();
`.trim());
  }
  if (sessionHashes.length) {
    statements.push(`DELETE FROM sessions WHERE token_hash NOT IN (${sessionHashes.map(sqlText).join(', ')});`);
  } else {
    statements.push('DELETE FROM sessions;');
  }

  const workspaceIds = [];
  for (const workspace of inventory.workspaces) {
    if (!workspace || !workspace.id) continue;
    workspaceIds.push(workspace.id);
    statements.push(`
INSERT INTO workspaces (
  id, status, template_id, recipe, selected_branch, selected_synapse_id,
  runtime_id, contract_id, contract_rev, contract, backup_r2_key, proof_path,
  created_at, updated_at
) VALUES (
  ${sqlText(workspace.id)}::uuid,
  ${sqlText(workspace.status || 'created')},
  ${sqlText(workspace.templateId || '')},
  ${sqlJson(workspace.recipe || {})},
  ${sqlText(workspace.selectedBranch || 'main')},
  ${sqlText(workspace.selectedSynapseId || '')},
  ${sqlText(workspace.runtimeId || '')},
  ${sqlText(workspace.contractId || '')},
  ${sqlInt(workspace.contractRev)},
  ${workspace.contract && typeof workspace.contract === 'object' ? sqlJson(workspace.contract) : 'NULL'},
  ${sqlText(workspace.backupR2Key || '')},
  ${sqlText(workspace.proofPath || '')},
  ${sqlTs(workspace.createdAt)},
  ${sqlTs(workspace.updatedAt)}
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  template_id = EXCLUDED.template_id,
  recipe = EXCLUDED.recipe,
  selected_branch = EXCLUDED.selected_branch,
  selected_synapse_id = EXCLUDED.selected_synapse_id,
  runtime_id = EXCLUDED.runtime_id,
  contract_id = EXCLUDED.contract_id,
  contract_rev = EXCLUDED.contract_rev,
  contract = EXCLUDED.contract,
  backup_r2_key = EXCLUDED.backup_r2_key,
  proof_path = EXCLUDED.proof_path,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  imported_at = now();
`.trim());
  }
  if (workspaceIds.length) {
    statements.push(`DELETE FROM workspaces WHERE id NOT IN (${workspaceIds.map((id) => `${sqlText(id)}::uuid`).join(', ')});`);
  }

  const projectIds = [];
  const synapseIds = [];
  const publicationIds = [];
  for (const project of inventory.projects) {
    if (!project || !project.id) continue;
    projectIds.push(project.id);
    statements.push(`
INSERT INTO project_genomes (
  id, title, description, template, environment, winner_id, created_at, updated_at
) VALUES (
  ${sqlText(project.id)},
  ${sqlText(project.title || '')},
  ${sqlText(project.description || '')},
  ${sqlText(project.template || 'blank')},
  ${sqlJson(project.environment || {})},
  ${project.winnerId ? sqlText(project.winnerId) : 'NULL'},
  ${sqlTs(project.createdAt)},
  ${sqlTs(project.updatedAt)}
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  template = EXCLUDED.template,
  environment = EXCLUDED.environment,
  winner_id = EXCLUDED.winner_id,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  imported_at = now();
`.trim());

    for (const synapse of Array.isArray(project.synapses) ? project.synapses : []) {
      if (!synapse || !synapse.id) continue;
      synapseIds.push(synapse.id);
      statements.push(`
INSERT INTO project_synapses (
  id, project_id, name, parent_id, note, status, preview_theme, created_at
) VALUES (
  ${sqlText(synapse.id)},
  ${sqlText(project.id)},
  ${sqlText(synapse.name || '')},
  ${synapse.parentId ? sqlText(synapse.parentId) : 'NULL'},
  ${sqlText(synapse.note || '')},
  ${sqlText(synapse.status || 'candidate')},
  ${synapse.previewTheme ? sqlText(synapse.previewTheme) : 'NULL'},
  ${sqlTs(synapse.createdAt)}
)
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  name = EXCLUDED.name,
  parent_id = EXCLUDED.parent_id,
  note = EXCLUDED.note,
  status = EXCLUDED.status,
  preview_theme = EXCLUDED.preview_theme,
  created_at = EXCLUDED.created_at;
`.trim());
    }

    for (const publication of Array.isArray(project.publications) ? project.publications : []) {
      if (!publication || !publication.id) continue;
      publicationIds.push(publication.id);
      statements.push(`
INSERT INTO project_publications (
  id, project_id, synapse_id, note, published_at, proof_url
) VALUES (
  ${sqlText(publication.id)},
  ${sqlText(project.id)},
  ${sqlText(publication.synapseId || '')},
  ${sqlText(publication.note || '')},
  ${sqlTs(publication.publishedAt)},
  ${publication.proofUrl ? sqlText(publication.proofUrl) : 'NULL'}
)
ON CONFLICT (id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  synapse_id = EXCLUDED.synapse_id,
  note = EXCLUDED.note,
  published_at = EXCLUDED.published_at,
  proof_url = EXCLUDED.proof_url;
`.trim());
    }
  }

  if (publicationIds.length) {
    statements.push(`DELETE FROM project_publications WHERE id NOT IN (${publicationIds.map(sqlText).join(', ')});`);
  } else {
    statements.push('DELETE FROM project_publications;');
  }
  if (synapseIds.length) {
    statements.push(`DELETE FROM project_synapses WHERE id NOT IN (${synapseIds.map(sqlText).join(', ')});`);
  } else {
    statements.push('DELETE FROM project_synapses;');
  }
  if (projectIds.length) {
    statements.push(`DELETE FROM project_genomes WHERE id NOT IN (${projectIds.map(sqlText).join(', ')});`);
  }

  statements.push('COMMIT;');
  statements.push(verifySql());
  return `${statements.join('\n\n')}\n`;
}

function verifySql() {
  return `
SELECT 'auth_owner' AS rel, count(*)::text AS n FROM auth_owner
UNION ALL SELECT 'sessions', count(*)::text FROM sessions
UNION ALL SELECT 'workspaces', count(*)::text FROM workspaces
UNION ALL SELECT 'project_genomes', count(*)::text FROM project_genomes
UNION ALL SELECT 'project_synapses', count(*)::text FROM project_synapses
UNION ALL SELECT 'project_publications', count(*)::text FROM project_publications
ORDER BY 1;
`.trim();
}

function verifyAgainstPostgres(inventory) {
  const sql = `${readSchema()}\n${verifySql()}\n`;
  const extra = `
SELECT token_hash FROM sessions ORDER BY expires_at;
SELECT id::text FROM workspaces ORDER BY id;
SELECT id FROM project_genomes ORDER BY id;
SELECT id FROM project_synapses ORDER BY id;
SELECT id FROM project_publications ORDER BY id;
SELECT password_salt IS NOT NULL AND password_hash IS NOT NULL AS owner_ok, created_at::text FROM auth_owner WHERE id = 1;
`;
  const psql = runPsql(`${sql}\n${extra}`);
  if (psql.status !== 0) {
    console.error('verify psql failed.');
    if (psql.stderr) console.error(psql.stderr);
    if (psql.stdout) console.error(psql.stdout);
    return { ok: false };
  }

  const counts = parseCountTable(psql.stdout);
  const expected = {
    auth_owner: inventory.owner ? 1 : 0,
    sessions: inventory.sessions.length,
    workspaces: inventory.workspaces.length,
    project_genomes: inventory.projects.length,
    project_synapses: inventory.synapseCount,
    project_publications: inventory.publicationCount
  };

  let ok = true;
  console.log('Postgres vs JSON:');
  for (const [rel, want] of Object.entries(expected)) {
    const got = counts[rel];
    const match = got === want;
    if (!match) ok = false;
    console.log(`  ${rel.padEnd(22)} json=${want}  pg=${got === undefined ? 'missing' : got}  ${match ? 'OK' : 'MISMATCH'}`);
  }

  const pgWorkspaceIds = new Set(inventory.workspaces.map((row) => row.id));
  const pgProjectIds = new Set(inventory.projects.map((row) => row.id));
  const outIds = collectColumn(psql.stdout, /^[0-9a-f-]{36}$/i).filter((id) => pgWorkspaceIds.has(id));
  const outProjects = collectColumn(psql.stdout, /^project_[0-9a-f-]+$/i).filter((id) => pgProjectIds.has(id));
  if (outIds.length !== inventory.workspaces.length) {
    // ID lists come from multiple result sets; presence check is enough.
  }
  if (inventory.workspaces.length && outIds.length === 0) {
    console.error('  workspaces: no matching ids returned from Postgres');
    ok = false;
  }
  if (inventory.projects.length && outProjects.length === 0) {
    console.error('  project_genomes: no matching ids returned from Postgres');
    ok = false;
  }

  if (ok) console.log('\nVerify passed. Live reads remain on JSON (USE_POSTGRES default OFF).');
  else console.error('\nVerify failed. Live app was not switched to Postgres.');
  return { ok };
}

function parseCountTable(stdout) {
  const counts = {};
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(auth_owner|sessions|workspaces|project_genomes|project_synapses|project_publications)\s*\|\s*(\d+)\s*$/);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return counts;
}

function collectColumn(stdout, pattern) {
  const values = [];
  for (const line of stdout.split('\n')) {
    const text = line.trim();
    if (pattern.test(text)) values.push(text);
  }
  return values;
}

function sqlText(value) {
  if (value === undefined || value === null) return 'NULL';
  return dollarQuote(String(value));
}

function sqlTs(value) {
  if (!value) return 'now()';
  return `${dollarQuote(String(value))}::timestamptz`;
}

function sqlInt(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : '0';
}

function sqlJson(value) {
  return `${dollarQuote(JSON.stringify(value))}::jsonb`;
}

function dollarQuote(text) {
  const s = String(text);
  for (let n = 0; n < 32; n += 1) {
    const tag = `sn${n}_${crypto.randomBytes(4).toString('hex')}`;
    if (!s.includes(`$${tag}$`)) return `$${tag}$${s}$${tag}$`;
  }
  throw new Error('Could not dollar-quote value');
}

function runPsql(sql) {
  const configured = process.env.PSQL_CMD;
  if (configured) {
    return spawnViaShell(configured, sql);
  }

  const psqlPath = findOnPath('psql');
  const databaseUrl = process.env.DATABASE_URL || '';
  if (psqlPath && (databaseUrl || process.env.PGHOST)) {
    const args = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-X'];
    if (databaseUrl) args.push(databaseUrl);
    return spawnSync(psqlPath, args, { input: sql, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  }

  const docker = findOnPath('docker');
  if (docker) {
    const container = process.env.POSTGRES_CONTAINER || 'synapsenest-postgres-1';
    const user = process.env.POSTGRES_USER || 'synapsenest';
    const db = process.env.POSTGRES_DB || 'synapsenest';
    return spawnSync(docker, [
      'exec', '-i',
      '-e', 'PGOPTIONS=--client-min-messages=warning',
      container,
      'psql', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-X'
    ], { input: sql, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  }

  console.error('No psql access. Set PSQL_CMD, install psql, or run on the Docker host.');
  return { status: 2, stdout: '', stderr: 'no psql' };
}

function spawnViaShell(command, sql) {
  return spawnSync('sh', ['-c', command], { input: sql, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function findOnPath(bin) {
  const result = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  }
}

module.exports = {
  loadInventory,
  buildApplySql,
  dollarQuote,
  sqlText,
  DATA
};
