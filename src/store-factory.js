'use strict';

const { AuthStore } = require('./auth-store');
const { WorkspaceStore } = require('./workspace-store');
const { ProjectGenomeStore } = require('./genome-store');
const { createPool, assertReachable } = require('./pg-pool');
const { PgAuthStore } = require('./auth-store-pg');
const { PgWorkspaceStore } = require('./workspace-store-pg');
const { PgProjectGenomeStore } = require('./genome-store-pg');

/**
 * Store constructor. JSON is the default.
 *
 * USE_POSTGRES=1 selects Postgres-backed stores. Boot is fail-closed to JSON:
 * if Postgres adapters cannot be created, the factory logs clearly and returns
 * JSON stores so production stays up. Callers should treat backend === 'postgres'
 * as the only signal that live reads are on Postgres.
 */
function postgresRequested() {
  return process.env.USE_POSTGRES === '1';
}

function createJsonStores(options = {}) {
  const rootDir = options.rootDir;
  return {
    backend: 'json',
    auth: options.auth || new AuthStore(options.authFile),
    workspaceStore: options.workspaceStore || new WorkspaceStore(options.workspaceDataFile),
    store: options.store || new ProjectGenomeStore(options.dataFile),
    rootDir,
    pool: null
  };
}

async function createPostgresStores(options = {}) {
  const pool = options.pool || createPool({ connectionString: options.databaseUrl });
  await assertReachable(pool);
  const auth = options.auth || await PgAuthStore.create(pool);
  const workspaceStore = options.workspaceStore || await PgWorkspaceStore.create(pool, {
    templateRecipes: options.templateRecipes
  });
  const store = options.store || await PgProjectGenomeStore.create(pool);
  return {
    backend: 'postgres',
    auth,
    workspaceStore,
    store,
    rootDir: options.rootDir,
    pool
  };
}

async function createStores(options = {}) {
  if (options.forceJson) return createJsonStores(options);
  if (!postgresRequested()) return createJsonStores(options);

  try {
    const stores = await createPostgresStores(options);
    console.log('[store-factory] USE_POSTGRES=1 — live stores backend=postgres');
    return stores;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`[store-factory] USE_POSTGRES=1 Postgres boot failed; fail-closed fallback to JSON: ${message}`);
    if (error && error.stack) console.error(error.stack);
    return createJsonStores(options);
  }
}

module.exports = {
  createStores,
  createJsonStores,
  createPostgresStores,
  postgresRequested
};
