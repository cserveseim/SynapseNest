'use strict';

const { randomUUID } = require('node:crypto');
const { WorkspaceStoreError, TEMPLATE_RECIPES } = require('./workspace-store');
const { toIso } = require('./pg-pool');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRANSITIONS = Object.freeze({
  created: new Set(['running', 'stopped', 'archived']),
  running: new Set(['stopped']),
  stopped: new Set(['running', 'archived']),
  archived: new Set()
});

class PgWorkspaceStore {
  constructor(pool, options = {}) {
    if (!pool) throw new TypeError('A Postgres pool is required.');
    this.pool = pool;
    this.backend = 'postgres';
    this.templateRecipes = options.templateRecipes && typeof options.templateRecipes === 'object'
      ? options.templateRecipes
      : TEMPLATE_RECIPES;
  }

  static async create(pool, options = {}) {
    const store = new PgWorkspaceStore(pool, options);
    await store.pool.query('SELECT 1 FROM workspaces LIMIT 1');
    return store;
  }

  async listWorkspaces() {
    const result = await this.pool.query(
      `SELECT id, status, template_id, recipe, selected_branch, selected_synapse_id,
              runtime_id, contract_id, contract_rev, contract, backup_r2_key, proof_path,
              created_at, updated_at
       FROM workspaces
       ORDER BY updated_at DESC`
    );
    return result.rows.map(mapRow);
  }

  async getWorkspace(workspaceId) {
    return mapRow(await this.#requireRow(workspaceId));
  }

  async createWorkspace(input = {}) {
    const templateId = requiredTemplateId(input.templateId, this.templateRecipes);
    const now = new Date().toISOString();
    const id = randomUUID();
    const recipe = {
      ...(this.templateRecipes[templateId] || {}),
      ...(input.recipe && typeof input.recipe === 'object' ? input.recipe : {})
    };
    const selectedBranch = optionalText(input.selectedBranch, 'selectedBranch', 120) || 'main';
    const selectedSynapseId = optionalText(input.selectedSynapseId, 'selectedSynapseId', 120);
    const contractId = optionalText(input.contractId, 'contractId', 120);
    const contractRev = Number.isInteger(Number(input.contractRev)) ? Number(input.contractRev) : 0;
    const contract = input.contract && typeof input.contract === 'object' ? input.contract : null;
    const backupR2Key = optionalText(input.backupR2Key, 'backupR2Key', 400);
    const proofPath = optionalText(input.proofPath, 'proofPath', 300);

    await this.pool.query(
      `INSERT INTO workspaces (
         id, status, template_id, recipe, selected_branch, selected_synapse_id,
         runtime_id, contract_id, contract_rev, contract, backup_r2_key, proof_path,
         created_at, updated_at
       ) VALUES (
         $1::uuid, 'created', $2, $3::jsonb, $4, $5,
         '', $6, $7, $8::jsonb, $9, $10,
         $11::timestamptz, $12::timestamptz
       )`,
      [
        id, templateId, JSON.stringify(recipe), selectedBranch, selectedSynapseId,
        contractId, contractRev, contract ? JSON.stringify(contract) : null,
        backupR2Key, proofPath, now, now
      ]
    );
    return this.getWorkspace(id);
  }

  async setRuntimeId(workspaceId, runtimeId) {
    if (typeof runtimeId !== 'string' || !UUID_PATTERN.test(runtimeId)) {
      throw new WorkspaceStoreError('Runtime ID is invalid.');
    }
    await this.#requireRow(workspaceId);
    const updatedAt = new Date().toISOString();
    await this.pool.query(
      `UPDATE workspaces SET runtime_id = $2, updated_at = $3::timestamptz WHERE id = $1::uuid`,
      [workspaceId, runtimeId, updatedAt]
    );
    return this.getWorkspace(workspaceId);
  }

  async transitionWorkspace(workspaceId, nextStatus) {
    const row = await this.#requireRow(workspaceId);
    if (typeof nextStatus !== 'string' || !Object.hasOwn(TRANSITIONS, nextStatus)) {
      throw new WorkspaceStoreError(`status must be one of: ${Object.keys(TRANSITIONS).join(', ')}.`);
    }
    if (!TRANSITIONS[row.status].has(nextStatus)) {
      throw new WorkspaceStoreError(`Cannot transition workspace from ${row.status} to ${nextStatus}.`);
    }
    const updatedAt = new Date().toISOString();
    await this.pool.query(
      `UPDATE workspaces SET status = $2, updated_at = $3::timestamptz WHERE id = $1::uuid`,
      [workspaceId, nextStatus, updatedAt]
    );
    return this.getWorkspace(workspaceId);
  }

  async requireWorkspace(workspaceId) {
    return mapRow(await this.#requireRow(workspaceId));
  }

  async #requireRow(workspaceId) {
    const result = await this.pool.query(
      `SELECT id, status, template_id, recipe, selected_branch, selected_synapse_id,
              runtime_id, contract_id, contract_rev, contract, backup_r2_key, proof_path,
              created_at, updated_at
       FROM workspaces WHERE id = $1::uuid`,
      [workspaceId]
    );
    if (!result.rowCount) throw new WorkspaceStoreError('Workspace not found.', 404);
    return result.rows[0];
  }
}

function mapRow(row) {
  return {
    id: String(row.id),
    status: row.status,
    templateId: row.template_id,
    recipe: row.recipe || {},
    selectedBranch: row.selected_branch || 'main',
    selectedSynapseId: row.selected_synapse_id || '',
    runtimeId: row.runtime_id || '',
    contractId: row.contract_id || '',
    contractRev: row.contract_rev || 0,
    contract: row.contract || null,
    backupR2Key: row.backup_r2_key || '',
    proofPath: row.proof_path || '',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function requiredTemplateId(value, recipes = TEMPLATE_RECIPES) {
  if (typeof value !== 'string' || !Object.hasOwn(recipes, value)) {
    throw new WorkspaceStoreError(`templateId must be one of: ${Object.keys(recipes).join(', ')}.`);
  }
  return value;
}

function optionalText(value, field, maximum) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new WorkspaceStoreError(`${field} must be a string.`);
  const text = value.trim();
  if (text.length > maximum) throw new WorkspaceStoreError(`${field} must be at most ${maximum} characters.`);
  return text;
}

module.exports = { PgWorkspaceStore };
