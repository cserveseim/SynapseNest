'use strict';

const { randomUUID } = require('node:crypto');
const { StoreError } = require('./genome-store');
const { toIso } = require('./pg-pool');

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_NOTE_LENGTH = 2_000;
const MAX_TEMPLATE_LENGTH = 80;
const MAX_NAME_LENGTH = 120;
const THEMES = new Set(['aurora', 'ocean', 'violet', 'sunset', 'forest', 'midnight']);

class PgProjectGenomeStore {
  constructor(pool) {
    if (!pool) throw new TypeError('A Postgres pool is required.');
    this.pool = pool;
    this.backend = 'postgres';
  }

  static async create(pool) {
    const store = new PgProjectGenomeStore(pool);
    await store.pool.query('SELECT 1 FROM project_genomes LIMIT 1');
    await store.pool.query('SELECT 1 FROM project_synapses LIMIT 1');
    await store.pool.query('SELECT 1 FROM project_publications LIMIT 1');
    return store;
  }

  async listProjects() {
    const result = await this.pool.query(
      `SELECT g.id, g.title, g.description, g.template, g.created_at, g.updated_at, g.winner_id,
              (SELECT count(*)::int FROM project_synapses s WHERE s.project_id = g.id) AS synapse_count,
              (SELECT count(*)::int FROM project_publications p WHERE p.project_id = g.id) AS publish_count
       FROM project_genomes g
       ORDER BY g.updated_at DESC`
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      template: row.template,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      winnerId: row.winner_id,
      synapseCount: row.synapse_count,
      publishCount: row.publish_count
    }));
  }

  async getProject(projectId) {
    return this.#loadProject(projectId);
  }

  async createProject(input) {
    const title = requiredText(input.title, 'title', MAX_TITLE_LENGTH);
    const description = optionalText(input.description, 'description', MAX_DESCRIPTION_LENGTH);
    const template = optionalText(input.template, 'template', MAX_TEMPLATE_LENGTH) || 'blank';
    const now = new Date().toISOString();
    const projectId = id('project');
    const rootId = id('syn');
    const environment = environmentFor(template);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO project_genomes (
           id, title, description, template, environment, winner_id, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, $8::timestamptz)`,
        [projectId, title, description, template, JSON.stringify(environment), rootId, now, now]
      );
      await client.query(
        `INSERT INTO project_synapses (
           id, project_id, name, parent_id, note, status, preview_theme, created_at
         ) VALUES ($1, $2, $3, NULL, $4, 'winner', $5, $6::timestamptz)`,
        [rootId, projectId, 'Primary synapse', 'Initial project genome.', themeFor(template), now]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
    return this.getProject(projectId);
  }

  async forkSynapse(projectId, input) {
    const project = await this.#loadProject(projectId);
    const parentId = requiredText(input.parentId || input.sourceSynapseId, 'parentId', 100);
    const parent = project.synapses.find((synapse) => synapse.id === parentId);
    if (!parent) throw new StoreError('Parent synapse not found.', 404);
    const note = requiredText(input.note || input.experimentNote, 'note', MAX_NOTE_LENGTH);
    const name = optionalText(input.name, 'name', MAX_NAME_LENGTH) || `${parent.name} fork`;
    const previewTheme = optionalTheme(input.previewTheme) || nextTheme(parent.previewTheme);
    const now = new Date().toISOString();
    const synapseId = id('syn');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO project_synapses (
           id, project_id, name, parent_id, note, status, preview_theme, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'candidate', $6, $7::timestamptz)`,
        [synapseId, projectId, name, parentId, note, previewTheme, now]
      );
      await client.query(
        `UPDATE project_genomes SET updated_at = $2::timestamptz WHERE id = $1`,
        [projectId, now]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
    return {
      id: synapseId,
      name,
      parentId,
      note,
      status: 'candidate',
      previewTheme,
      createdAt: now
    };
  }

  async selectWinner(projectId, input) {
    const project = await this.#loadProject(projectId);
    const synapseId = requiredText(input.synapseId || input.winnerId, 'synapseId', 100);
    const synapse = project.synapses.find((candidate) => candidate.id === synapseId);
    if (!synapse) throw new StoreError('Synapse not found.', 404);
    const now = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE project_synapses SET status = CASE WHEN id = $2 THEN 'winner' ELSE 'candidate' END
         WHERE project_id = $1`,
        [projectId, synapseId]
      );
      await client.query(
        `UPDATE project_genomes SET winner_id = $2, updated_at = $3::timestamptz WHERE id = $1`,
        [projectId, synapseId, now]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
    return this.getProject(projectId);
  }

  async publish(projectId, input = {}) {
    const project = await this.#loadProject(projectId);
    const synapseId = optionalText(input.synapseId, 'synapseId', 100) || project.winnerId;
    const synapse = project.synapses.find((candidate) => candidate.id === synapseId);
    if (!synapse) throw new StoreError('Synapse not found.', 404);
    const note = optionalText(input.note || input.message, 'note', MAX_NOTE_LENGTH);
    const publishedAt = new Date().toISOString();
    const publicationId = id('publish');
    const proofUrl = `/proof/${project.id}/${synapse.id}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO project_publications (
           id, project_id, synapse_id, note, published_at, proof_url
         ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6)`,
        [publicationId, projectId, synapse.id, note, publishedAt, proofUrl]
      );
      await client.query(
        `UPDATE project_genomes SET updated_at = $2::timestamptz WHERE id = $1`,
        [projectId, publishedAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
    return {
      id: publicationId,
      synapseId: synapse.id,
      note,
      publishedAt,
      proofUrl
    };
  }

  async exportProject(projectId) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project: await this.getProject(projectId)
    };
  }

  async requireProject(projectId) {
    return this.#loadProject(projectId);
  }

  async #loadProject(projectId) {
    const genome = await this.pool.query(
      `SELECT id, title, description, template, environment, winner_id, created_at, updated_at
       FROM project_genomes WHERE id = $1`,
      [projectId]
    );
    if (!genome.rowCount) throw new StoreError('Project not found.', 404);
    const row = genome.rows[0];
    const synapses = await this.pool.query(
      `SELECT id, name, parent_id, note, status, preview_theme, created_at
       FROM project_synapses WHERE project_id = $1 ORDER BY created_at ASC, id ASC`,
      [projectId]
    );
    const publications = await this.pool.query(
      `SELECT id, synapse_id, note, published_at, proof_url
       FROM project_publications WHERE project_id = $1 ORDER BY published_at ASC, id ASC`,
      [projectId]
    );
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      template: row.template,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      environment: row.environment || {},
      synapses: synapses.rows.map((synapse) => ({
        id: synapse.id,
        name: synapse.name,
        parentId: synapse.parent_id,
        note: synapse.note || '',
        status: synapse.status,
        previewTheme: synapse.preview_theme,
        createdAt: toIso(synapse.created_at)
      })),
      winnerId: row.winner_id,
      publications: publications.rows.map((publication) => ({
        id: publication.id,
        synapseId: publication.synapse_id,
        note: publication.note || '',
        publishedAt: toIso(publication.published_at),
        proofUrl: publication.proof_url
      }))
    };
  }
}

function id(prefix) { return `${prefix}_${randomUUID()}`; }
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
  if (typeof value !== 'string' || !THEMES.has(value)) {
    throw new StoreError(`previewTheme must be one of: ${[...THEMES].join(', ')}.`);
  }
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
  return {
    runtime: 'Static browser preview',
    template,
    install: 'No install required',
    command: 'Safe deterministic preview only'
  };
}

module.exports = { PgProjectGenomeStore };
