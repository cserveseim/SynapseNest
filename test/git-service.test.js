'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { GitService, GitServiceError } = require('../src/git-service');

const WORKSPACE_ID = 'b70a7e9d-3323-4a49-909c-d2994324a90d';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-git-service-'));
  const workspacesRoot = path.join(directory, 'workspaces');
  const exportsRoot = path.join(directory, 'exports');
  fs.mkdirSync(path.join(workspacesRoot, WORKSPACE_ID), { recursive: true });
  return {
    directory,
    workspacesRoot,
    exportsRoot,
    service: new GitService({ workspacesRoot, exportsRoot }),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

function git(workspacePath, ...arguments_) {
  return childProcess.execFileSync('git', ['-C', workspacePath, ...arguments_], { encoding: 'utf8' }).trim();
}

test('creates the reviewed static starter in an initialized SynapseNest repository', () => {
  const subject = fixture();
  try {
    const result = subject.service.createStarter(WORKSPACE_ID);
    const workspacePath = path.join(subject.workspacesRoot, WORKSPACE_ID);

    assert.equal(result.branch, 'main');
    assert.equal(git(workspacePath, 'branch', '--show-current'), 'main');
    assert.equal(git(workspacePath, 'log', '-1', '--format=%an <%ae>'), 'SynapseNest <workspace@synapsenest.local>');
    assert.match(fs.readFileSync(path.join(workspacePath, 'index.html'), 'utf8'), /SynapseNest Starter/);
    assert.match(fs.readFileSync(path.join(workspacePath, 'styles.css'), 'utf8'), /:root/);
    assert.match(fs.readFileSync(path.join(workspacePath, 'app.js'), 'utf8'), /addEventListener/);
  } finally { subject.cleanup(); }
});

test('creates a named snapshot branch containing workspace changes', () => {
  const subject = fixture();
  try {
    subject.service.createStarter(WORKSPACE_ID);
    const workspacePath = path.join(subject.workspacesRoot, WORKSPACE_ID);
    fs.appendFileSync(path.join(workspacePath, 'app.js'), '\nconsole.log("snapshot");\n');

    const snapshot = subject.service.createSnapshot(WORKSPACE_ID, 'snapshot-2026');

    assert.equal(snapshot.branch, 'snapshot-2026');
    assert.equal(git(workspacePath, 'branch', '--show-current'), 'snapshot-2026');
    assert.equal(git(workspacePath, 'show', 'snapshot-2026:app.js').includes('snapshot'), true);
  } finally { subject.cleanup(); }
});

test('exports only a Git archive under the configured app-owned export directory', () => {
  const subject = fixture();
  try {
    subject.service.createStarter(WORKSPACE_ID);
    const archive = subject.service.exportWorkspace(WORKSPACE_ID, 'tar');

    assert.equal(path.dirname(archive.path), subject.exportsRoot);
    assert.equal(path.extname(archive.path), '.tar');
    assert.equal(fs.existsSync(archive.path), true);
    const entries = childProcess.execFileSync('tar', ['-tf', archive.path], { encoding: 'utf8' });
    assert.match(entries, /index\.html/);
    assert.doesNotMatch(entries, /\.git/);
  } finally { subject.cleanup(); }
});

test('rejects unsafe snapshot names and unsupported archive formats', () => {
  const subject = fixture();
  try {
    subject.service.createStarter(WORKSPACE_ID);
    assert.throws(() => subject.service.createSnapshot(WORKSPACE_ID, '../outside'), GitServiceError);
    assert.throws(() => subject.service.exportWorkspace(WORKSPACE_ID, 'shell'), GitServiceError);
  } finally { subject.cleanup(); }
});
