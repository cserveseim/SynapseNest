'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadTemplateCatalog, RECIPE_SCHEMA } = require('../src/template-catalog');
const { parseRecipeYaml } = require('../src/recipe-yaml');

const root = path.join(__dirname, '..');

test('parses synapsenest.yaml recipe subset', () => {
  const parsed = parseRecipeYaml(`
schema: synapsenest.recipe/v1
id: demo
title: Demo
runtime: static-preview
previewPort: 8080
tags:
  - one
  - two
`);
  assert.equal(parsed.schema, RECIPE_SCHEMA);
  assert.equal(parsed.id, 'demo');
  assert.deepEqual(parsed.tags, ['one', 'two']);
  assert.equal(parsed.previewPort, 8080);
});

test('loads reviewed templates from the repository catalog', () => {
  const catalog = loadTemplateCatalog(path.join(root, 'templates'));
  assert.ok(catalog.ids.includes('static-site'));
  assert.ok(catalog.ids.includes('landing-page'));
  assert.ok(catalog.ids.includes('knowledge-garden'));
  assert.ok(catalog.ids.includes('portfolio'));
  assert.equal(catalog.byId['landing-page'].runtime, 'static-preview');
  assert.equal(catalog.byId['portfolio'].genomeTemplate, 'portfolio');
  for (const id of catalog.ids) {
    assert.equal(fs.existsSync(path.join(root, 'templates', id, 'synapsenest.yaml')), true);
    assert.equal(fs.existsSync(path.join(root, 'templates', id, 'index.html')), true);
  }
});

test('rejects recipes whose id does not match the directory', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-catalog-'));
  const templateDir = path.join(directory, 'mismatch');
  fs.mkdirSync(templateDir);
  fs.writeFileSync(path.join(templateDir, 'synapsenest.yaml'), `schema: synapsenest.recipe/v1\nid: other\ntitle: Other\nruntime: static-preview\n`);
  assert.throws(() => loadTemplateCatalog(directory), /must match directory name/i);
  fs.rmSync(directory, { recursive: true, force: true });
});
