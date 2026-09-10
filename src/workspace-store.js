'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const TEMPLATE_RECIPES = Object.freeze({
  'static-site': Object.freeze({ id: 'static-site', runtime: 'static-preview' })
});

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
  constructor(dataFile) {
    if (!dataFile || typeof dataFile !== 'string') throw new TypeError('A data file path is required.');
    this.dataFile = path.resolve(dataFile);
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
    const templateId = requiredTemplateId(input.templateId);
    const now = new Date().toISOString();
    const workspace = {
      id: randomUUID(),
      status: 'created',
      templateId,
      recipe: { ...TEMPLATE_RECIPES[templateId] },
      selectedBranch: optionalText(input.selectedBranch, 'selectedBranch', 120) || 'main',
      selectedSynapseId: optionalText(input.selectedSynapseId, 'selectedSynapseId', 120),
      createdAt: now,
      updatedAt: now
    };
    this.workspaces.push(workspace);
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
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  }));
}

function requiredTemplateId(value) {
  if (typeof value !== 'string' || !Object.hasOwn(TEMPLATE_RECIPES, value)) {
    throw new WorkspaceStoreError(`templateId must be one of: ${Object.keys(TEMPLATE_RECIPES).join(', ')}.`);
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

module.exports = { WorkspaceStore, WorkspaceStoreError, TEMPLATE_RECIPES };
