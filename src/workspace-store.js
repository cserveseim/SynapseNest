'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadTemplateCatalog, recipeMapFromCatalog, defaultTemplatesRoot } = require('./template-catalog');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_CATALOG = loadTemplateCatalog(defaultTemplatesRoot());
const TEMPLATE_RECIPES = recipeMapFromCatalog(DEFAULT_CATALOG);

const TRANSITIONS = Object.freeze({
  created: new Set(['running', 'stopped', 'archived']),
  running: new Set(['stopped']),
  stopped: new Set(['running', 'archived']),
  archived: new Set()
});

class WorkspaceStoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'WorkspaceStoreError';
    this.statusCode = statusCode;
  }
}

class WorkspaceStore {
  constructor(dataFile, options = {}) {
    if (!dataFile || typeof dataFile !== 'string') throw new TypeError('A data file path is required.');
    this.dataFile = path.resolve(dataFile);
    this.templateRecipes = options.templateRecipes || TEMPLATE_RECIPES;
    this.workspaces = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      if (!parsed || !Array.isArray(parsed.workspaces)) throw new Error('missing workspaces array');
      this.workspaces = parsed.workspaces;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.persist();
        return;
      }
      if (error instanceof SyntaxError || error.message === 'missing workspaces array') {
        throw new Error(`Could not read workspace store at ${this.dataFile}: invalid JSON.`);
      }
      throw error;
    }
  }

  listWorkspaces() {
    return this.workspaces
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(publicWorkspace);
  }

  getWorkspace(workspaceId) {
    return publicWorkspace(this.requireWorkspace(workspaceId));
  }

  createWorkspace(input = {}) {
    const templateId = this.requiredTemplateId(input.templateId);
    const baseRecipe = this.templateRecipes[templateId];
    const now = new Date().toISOString();
    const workspace = {
      id: randomUUID(),
      status: 'created',
      templateId,
      recipe: { ...baseRecipe, ...(input.recipe && typeof input.recipe === 'object' ? input.recipe : {}) },
      selectedBranch: optionalText(input.selectedBranch, 'selectedBranch', 120) || 'main',
      selectedSynapseId: optionalText(input.selectedSynapseId, 'selectedSynapseId', 120),
      contractId: optionalText(input.contractId, 'contractId', 120),
      contractRev: Number.isInteger(Number(input.contractRev)) ? Number(input.contractRev) : 0,
      contract: input.contract && typeof input.contract === 'object' ? input.contract : null,
      backupR2Key: optionalText(input.backupR2Key, 'backupR2Key', 400),
      proofPath: optionalText(input.proofPath, 'proofPath', 300),
      createdAt: now,
      updatedAt: now
    };
    this.workspaces.push(workspace);
    this.persist();
    return publicWorkspace(workspace);
  }

  setRuntimeId(workspaceId, runtimeId) {
    if (typeof runtimeId !== 'string' || !UUID_PATTERN.test(runtimeId)) {
      throw new WorkspaceStoreError('Runtime ID is invalid.');
    }
    const workspace = this.requireWorkspace(workspaceId);
    workspace.runtimeId = runtimeId;
    workspace.updatedAt = new Date().toISOString();
    this.persist();
    return publicWorkspace(workspace);
  }

  transitionWorkspace(workspaceId, nextStatus) {
    const workspace = this.requireWorkspace(workspaceId);
    if (typeof nextStatus !== 'string' || !Object.hasOwn(TRANSITIONS, nextStatus)) {
      throw new WorkspaceStoreError(`status must be one of: ${Object.keys(TRANSITIONS).join(', ')}.`);
    }
    if (!TRANSITIONS[workspace.status].has(nextStatus)) {
      throw new WorkspaceStoreError(`Cannot transition workspace from ${workspace.status} to ${nextStatus}.`);
    }
    workspace.status = nextStatus;
    workspace.updatedAt = new Date().toISOString();
    this.persist();
    return publicWorkspace(workspace);
  }

  requireWorkspace(workspaceId) {
    const workspace = this.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) throw new WorkspaceStoreError('Workspace not found.', 404);
    return workspace;
  }

  requiredTemplateId(value) {
    if (typeof value !== 'string' || !Object.hasOwn(this.templateRecipes, value)) {
      throw new WorkspaceStoreError(`templateId must be one of: ${Object.keys(this.templateRecipes).join(', ')}.`);
    }
    return value;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const temporaryFile = `${this.dataFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify({ version: 1, workspaces: this.workspaces }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryFile, this.dataFile);
    } finally {
      try { fs.unlinkSync(temporaryFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function publicWorkspace(workspace) {
  return JSON.parse(JSON.stringify({
    id: workspace.id,
    status: workspace.status,
    templateId: workspace.templateId,
    recipe: workspace.recipe,
    selectedBranch: workspace.selectedBranch,
    selectedSynapseId: workspace.selectedSynapseId,
    runtimeId: workspace.runtimeId || '',
    contractId: workspace.contractId || '',
    contractRev: workspace.contractRev || 0,
    contract: workspace.contract || null,
    backupR2Key: workspace.backupR2Key || '',
    proofPath: workspace.proofPath || '',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  }));
}

function optionalText(value, field, maximum) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new WorkspaceStoreError(`${field} must be a string.`);
  const text = value.trim();
  if (text.length > maximum) throw new WorkspaceStoreError(`${field} must be at most ${maximum} characters.`);
  return text;
}

module.exports = { WorkspaceStore, WorkspaceStoreError, TEMPLATE_RECIPES };
