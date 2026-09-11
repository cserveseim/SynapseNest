'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { WorkspaceStore, WorkspaceStoreError } = require('../src/workspace-store');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-workspace-store-'));
  return {
    directory,
    store: new WorkspaceStore(path.join(directory, 'workspaces.json')),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test('creates a persistent workspace with public metadata and UUID', () => {
  const subject = fixture();
  try {
    const workspace = subject.store.createWorkspace({
      templateId: 'static-site',
      selectedBranch: 'release-candidate',
      selectedSynapseId: 'syn_123'
    });

    assert.match(workspace.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(workspace.status, 'created');
    assert.equal(workspace.templateId, 'static-site');
    assert.equal(workspace.selectedBranch, 'release-candidate');
    assert.equal(workspace.selectedSynapseId, 'syn_123');
    assert.deepEqual(workspace.recipe, { id: 'static-site', runtime: 'static-preview' });
    assert.match(workspace.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(workspace.updatedAt, workspace.createdAt);
    assert.equal(Object.hasOwn(workspace, 'rootPath'), false);
    assert.equal(workspace.runtimeId, '');

    const reloaded = new WorkspaceStore(path.join(subject.directory, 'workspaces.json'));
    assert.deepEqual(reloaded.getWorkspace(workspace.id), workspace);
  } finally { subject.cleanup(); }
});

test('only allows reviewed workspace template IDs', () => {
  const subject = fixture();
  try {
    assert.throws(
      () => subject.store.createWorkspace({ templateId: 'ubuntu:latest' }),
      (error) => error instanceof WorkspaceStoreError && /templateId must be one of: static-site/i.test(error.message)
    );
  } finally { subject.cleanup(); }
});

test('only permits explicit workspace lifecycle transitions', () => {
  const subject = fixture();
  try {
    const workspace = subject.store.createWorkspace({ templateId: 'static-site' });
    const running = subject.store.transitionWorkspace(workspace.id, 'running');
    assert.equal(running.status, 'running');
    const stopped = subject.store.transitionWorkspace(workspace.id, 'stopped');
    assert.equal(stopped.status, 'stopped');
    const archived = subject.store.transitionWorkspace(workspace.id, 'archived');
    assert.equal(archived.status, 'archived');
    assert.throws(
      () => subject.store.transitionWorkspace(workspace.id, 'running'),
      (error) => error instanceof WorkspaceStoreError && /cannot transition/i.test(error.message)
    );
  } finally { subject.cleanup(); }
});

test('persists a generated runtime ID without exposing filesystem paths', () => {
  const subject = fixture();
  try {
    const workspace = subject.store.createWorkspace({ templateId: 'static-site' });
    const runtimeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const updated = subject.store.setRuntimeId(workspace.id, runtimeId);
    assert.equal(updated.runtimeId, runtimeId);
    assert.equal(Object.hasOwn(updated, 'rootPath'), false);
    assert.throws(() => subject.store.setRuntimeId(workspace.id, '../escape'), WorkspaceStoreError);
  } finally { subject.cleanup(); }
});
