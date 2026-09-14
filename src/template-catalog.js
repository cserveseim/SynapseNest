'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseRecipeYaml, RecipeYamlError } = require('./recipe-yaml');

const RECIPE_SCHEMA = 'synapsenest.recipe/v1';
const RECIPE_FILE = 'synapsenest.yaml';
const ALLOWED_RUNTIMES = new Set(['static-preview', 'stub', 'node', 'python', 'lxc-ubuntu']);

class TemplateCatalogError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'TemplateCatalogError';
    this.statusCode = statusCode;
  }
}

function defaultTemplatesRoot() {
  return path.join(__dirname, '..', 'templates');
}

function loadTemplateCatalog(templatesRoot = defaultTemplatesRoot()) {
  const root = path.resolve(templatesRoot);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return freezeCatalog([]);
    throw error;
  }

  const templates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const recipePath = path.join(root, entry.name, RECIPE_FILE);
    if (!fs.existsSync(recipePath)) continue;
    const recipe = loadRecipeFile(recipePath, entry.name);
    templates.push(publicTemplate(recipe, entry.name));
  }

  templates.sort((a, b) => a.id.localeCompare(b.id));
  return freezeCatalog(templates);
}

function loadRecipeFile(recipePath, directoryName) {
  let text;
  try {
    text = fs.readFileSync(recipePath, 'utf8');
  } catch {
    throw new TemplateCatalogError(`Recipe unavailable for template ${directoryName}.`);
  }
  let parsed;
  try {
    parsed = parseRecipeYaml(text);
  } catch (error) {
    if (error instanceof RecipeYamlError) {
      throw new TemplateCatalogError(`Invalid synapsenest.yaml in ${directoryName}: ${error.message}`);
    }
    throw error;
  }
  return normalizeRecipe(parsed, directoryName);
}

function normalizeRecipe(input, directoryName) {
  if (!input || typeof input !== 'object') throw new TemplateCatalogError(`Recipe missing for ${directoryName}.`);
  const schema = String(input.schema || '').trim();
  if (schema !== RECIPE_SCHEMA) {
    throw new TemplateCatalogError(`Recipe schema must be ${RECIPE_SCHEMA} (${directoryName}).`);
  }
  const id = String(input.id || directoryName).trim();
  if (id !== directoryName) {
    throw new TemplateCatalogError(`Recipe id must match directory name (${directoryName}).`);
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    throw new TemplateCatalogError(`Recipe id is invalid (${directoryName}).`);
  }
  const runtime = String(input.runtime || 'static-preview').trim();
  if (!ALLOWED_RUNTIMES.has(runtime)) {
    throw new TemplateCatalogError(`Unsupported runtime in ${directoryName}: ${runtime}.`);
  }
  const previewPort = Number(input.previewPort == null ? 8080 : input.previewPort);
  if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
    throw new TemplateCatalogError(`previewPort is invalid in ${directoryName}.`);
  }
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
    : [];

  return {
    schema: RECIPE_SCHEMA,
    id,
    title: String(input.title || id).trim().slice(0, 80) || id,
    description: String(input.description || '').trim().slice(0, 400),
    runtime,
    previewPort,
    install: String(input.install || 'none').trim().slice(0, 80) || 'none',
    command: String(input.command || 'httpd').trim().slice(0, 120) || 'httpd',
    genomeTemplate: String(input.genomeTemplate || id).trim().slice(0, 80) || id,
    tags
  };
}

function publicTemplate(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    runtime: recipe.runtime,
    previewPort: recipe.previewPort,
    install: recipe.install,
    command: recipe.command,
    genomeTemplate: recipe.genomeTemplate,
    tags: [...recipe.tags],
    recipe: {
      id: recipe.id,
      runtime: recipe.runtime,
      previewPort: recipe.previewPort,
      install: recipe.install,
      command: recipe.command,
      genomeTemplate: recipe.genomeTemplate
    }
  };
}

function freezeCatalog(templates) {
  const byId = Object.create(null);
  for (const template of templates) byId[template.id] = Object.freeze({ ...template, tags: Object.freeze([...template.tags]), recipe: Object.freeze({ ...template.recipe }) });
  return Object.freeze({
    templates: Object.freeze(templates.map((template) => byId[template.id])),
    byId: Object.freeze(byId),
    ids: Object.freeze(Object.keys(byId))
  });
}

function recipeMapFromCatalog(catalog) {
  const map = Object.create(null);
  for (const template of catalog.templates) {
    map[template.id] = Object.freeze({ ...template.recipe });
  }
  return Object.freeze(map);
}

module.exports = {
  RECIPE_SCHEMA,
  RECIPE_FILE,
  TemplateCatalogError,
  loadTemplateCatalog,
  recipeMapFromCatalog,
  defaultTemplatesRoot
};
