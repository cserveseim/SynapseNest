'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_TEMPLATE_LENGTH = 80;
const MAX_NAME_LENGTH = 120;
const THEMES = new Set(['aurora', 'ocean', 'violet', 'sunset', 'forest', 'midnight']);

class StoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'StoreError';
    this.statusCode = statusCode;
  }
}

class ProjectGenomeStore {
  constructor(dataFile) {
    if (!dataFile || typeof dataFile !== 'string') {
      throw new TypeError('A data file path is required.');
    }
    this.dataFile = path.resolve(dataFile);
    this.projects = [];
    this.load();
  }

  load() {
    try {
      const contents = fs.readFileSync(this.dataFile, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || !Array.isArray(parsed.projects)) {
        throw new Error('missing projects array');
      }
      this.projects = parsed.projects;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.projects = [];
        this.persist();
        return;
      }
      if (error instanceof SyntaxError || error.message === 'missing projects array') {
        throw new Error(`Could not read genome store at ${this.dataFile}: invalid JSON.`);
      }
      throw error;
    }
  }

  listProjects() {
    return this.projects
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => ({
        id: project.id,
        title: project.title,
        description: project.description,
        template: project.template,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        winnerId: project.winnerId,
        synapseCount: project.synapses.length,
        publishCount: project.publications.length
      }));
  }

  getProject(projectId) {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new StoreError('Project not found.', 404);
    return clone(project);
  }

  createProject(input) {
    const title = requiredText(input.title, 'title', MAX_TITLE_LENGTH);
    const description = optionalText(input.description, 'description', MAX_DESCRIPTION_LENGTH);
    const template = optionalText(input.template, 'template', MAX_TEMPLATE_LENGTH) || 'blank';
    const now = new Date().toISOString();
    const rootId = id('syn');
    const project = {
      id: id('project'),
      title,
      description,
      template,
      createdAt: now,
      updatedAt: now,
      environment: environmentFor(template),
      synapses: [{
        id: rootId,
        name: 'Primary synapse',
        parentId: null,
        note: 'Initial project genome.',
        status: 'winner',
        previewTheme: themeFor(template),
        createdAt: now
      }],
      winnerId: rootId,
      publications: []
    };
    this.projects.push(project);
    this.persist();
    return clone(project);
  }

  forkSynapse(projectId, input) {
    const project = this.requireProject(projectId);
    const parentId = requiredText(input.parentId || input.sourceSynapseId, 'parentId', 100);
    const parent = project.synapses.find((synapse) => synapse.id === parentId);
    if (!parent) throw new StoreError('Parent synapse not found.', 404);
    const note = requiredText(input.note || input.experimentNote, 'note', MAX_NOTE_LENGTH);
    const name = optionalText(input.name, 'name', MAX_NAME_LENGTH) || `${parent.name} fork`;
    const previewTheme = optionalTheme(input.previewTheme) || nextTheme(parent.previewTheme);
    const now = new Date().toISOString();
    const synapse = {
      id: id('syn'), name, parentId, note, status: 'candidate', previewTheme, createdAt: now
    };
    project.synapses.push(synapse);
    project.updatedAt = now;
    this.persist();
    return clone(synapse);
  }

  selectWinner(projectId, input) {
    const project = this.requireProject(projectId);
    const synapseId = requiredText(input.synapseId || input.winnerId, 'synapseId', 100);
    const synapse = project.synapses.find((candidate) => candidate.id === synapseId);
    if (!synapse) throw new StoreError('Synapse not found.', 404);
    for (const candidate of project.synapses) candidate.status = candidate.id === synapseId ? 'winner' : 'candidate';
    project.winnerId = synapse.id;
    project.updatedAt = new Date().toISOString();
    this.persist();
    return clone(project);
  }

  publish(projectId, input = {}) {
    const project = this.requireProject(projectId);
    const synapseId = optionalText(input.synapseId, 'synapseId', 100) || project.winnerId;
    const synapse = project.synapses.find((candidate) => candidate.id === synapseId);
    if (!synapse) throw new StoreError('Synapse not found.', 404);
    const note = optionalText(input.note || input.message, 'note', MAX_NOTE_LENGTH);
    const publishedAt = new Date().toISOString();
    const publication = {
      id: id('publish'), synapseId: synapse.id, note, publishedAt,
      proofUrl: `/proof/${project.id}/${synapse.id}`
    };
    project.publications.push(publication);
    project.updatedAt = publishedAt;
    this.persist();
    return clone(publication);
  }

  exportProject(projectId) {
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), project: this.getProject(projectId) };
  }

  requireProject(projectId) {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new StoreError('Project not found.', 404);
    return project;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const temporaryFile = `${this.dataFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify({ version: 1, projects: this.projects }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryFile, this.dataFile);
    } finally {
      try { fs.unlinkSync(temporaryFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function id(prefix) { return `${prefix}_${randomUUID()}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function requiredText(value, field, maximum) {
  const text = optionalText(value, field, maximum);
  if (!text) throw new StoreError(`${field} is required.`);
  return text;
}
function optionalText(value, field, maximum) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new StoreError(`${field} must be a string.`);
  const text = value.trim();
  if (text.length > maximum) throw new StoreError(`${field} must be at most ${maximum} characters.`);
  return text;
}
function optionalTheme(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !THEMES.has(value)) throw new StoreError(`previewTheme must be one of: ${[...THEMES].join(', ')}.`);
  return value;
}
function themeFor(template) {
  return ({ portfolio: 'ocean', dashboard: 'violet', landing: 'sunset', blog: 'forest' })[template.toLowerCase()] || 'aurora';
}
function nextTheme(theme) {
  const options = [...THEMES];
  return options[(options.indexOf(theme) + 1) % options.length];
}
function environmentFor(template) {
  const key = String(template || 'blank').toLowerCase();
  const recipes = {
    blank: { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'static-site': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    landing: { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'landing-page': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'product landing page': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    blog: { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'knowledge-garden': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'personal knowledge garden': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    portfolio: { runtime: 'static-preview', install: 'none', command: 'httpd' },
    'creative portfolio': { runtime: 'static-preview', install: 'none', command: 'httpd' },
    dashboard: { runtime: 'static-preview', install: 'none', command: 'httpd' }
  };
  const matched = recipes[key] || { runtime: 'static-preview', install: 'none', command: 'httpd' };
  return {
    runtime: matched.runtime,
    template,
    install: matched.install,
    command: matched.command,
    recipeSchema: 'synapsenest.recipe/v1'
  };
}

module.exports = { ProjectGenomeStore, StoreError };
