'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RuntimeAdapter, RUNTIME_IMAGE, RuntimeAdapterError } = require('../src/runtime-adapter');

const WORKSPACE_ID = 'b70a7e9d-3323-4a49-909c-d2994324a90d';
const REVIEWED_IMAGE = 'busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-runtime-adapter-'));
  const workspacesRoot = path.join(directory, 'workspaces');
  const workspacePath = path.join(workspacesRoot, WORKSPACE_ID);
  const calls = [];
  fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
  return {
    directory,
    workspacePath,
    calls,
    adapter: new RuntimeAdapter({
      workspacesRoot,
      execute(args) {
        calls.push(args);
        if (args[0] === 'inspect') return 'running\n';
        return 'container-id\n';
      }
    }),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test('creates only a fixed, resource-bounded and isolated static-preview invocation', () => {
  const subject = fixture();
  try {
    const runtime = subject.adapter.create(WORKSPACE_ID);
    const args = subject.calls[0];

    assert.match(runtime.id, /^[0-9a-f-]{36}$/i);
    assert.equal(RUNTIME_IMAGE, REVIEWED_IMAGE);
    assert.equal(args.at(-7), REVIEWED_IMAGE);
    assert.deepEqual(args.slice(-6), ['httpd', '-f', '-p', '8080', '-h', '/workspace']);
    assert.equal(args.includes('--network'), true);
    assert.equal(args[args.indexOf('--network') + 1], 'none');
    assert.equal(args.includes('--read-only'), true);
    assert.deepEqual(args.slice(args.indexOf('--cap-drop'), args.indexOf('--cap-drop') + 2), ['--cap-drop', 'ALL']);
    assert.deepEqual(args.slice(args.indexOf('--security-opt'), args.indexOf('--security-opt') + 2), ['--security-opt', 'no-new-privileges:true']);
    assert.deepEqual(args.slice(args.indexOf('--cpus'), args.indexOf('--cpus') + 2), ['--cpus', '0.50']);
    assert.deepEqual(args.slice(args.indexOf('--memory'), args.indexOf('--memory') + 2), ['--memory', '256m']);
    assert.deepEqual(args.slice(args.indexOf('--pids-limit'), args.indexOf('--pids-limit') + 2), ['--pids-limit', '64']);
    assert.equal(args[args.indexOf('--mount') + 1], `type=bind,src=${subject.workspacePath},dst=/workspace`);
    assert.equal(args.slice(0, args.indexOf(RUNTIME_IMAGE)).some((argument) => argument === '-p' || argument === '--publish' || argument.startsWith('--publish=')), false);
  } finally { subject.cleanup(); }
});

test('uses generated runtime IDs for lifecycle operations and rejects unknown IDs', () => {
  const subject = fixture();
  try {
    const runtime = subject.adapter.create(WORKSPACE_ID);
    assert.deepEqual(subject.adapter.start(runtime.id), { id: runtime.id, status: 'running' });
    assert.deepEqual(subject.adapter.status(runtime.id), { id: runtime.id, status: 'running' });
    assert.deepEqual(subject.adapter.stop(runtime.id), { id: runtime.id, status: 'stopped' });
    assert.deepEqual(subject.adapter.remove(runtime.id), { id: runtime.id, status: 'removed' });
    assert.deepEqual(subject.calls.map((args) => args[0]), ['create', 'start', 'inspect', 'stop', 'rm']);
    assert.throws(() => subject.adapter.start('00000000-0000-4000-8000-000000000000'), RuntimeAdapterError);
  } finally { subject.cleanup(); }
});

test('recovers a labeled runtime after adapter restart before removing it', () => {
  const subject = fixture();
  try {
    const runtime = subject.adapter.create(WORKSPACE_ID);
    const restartedAdapter = new RuntimeAdapter({
      workspacesRoot: path.dirname(subject.workspacePath),
      execute(args) {
        subject.calls.push(args);
        if (args.includes('--format={{json .Config.Labels}}')) {
          return JSON.stringify({ 'synapsenest.runtime': runtime.id });
        }
        return 'container-id\n';
      }
    });

    assert.deepEqual(restartedAdapter.remove(runtime.id), { id: runtime.id, status: 'removed' });
    assert.deepEqual(subject.calls.slice(-2).map((args) => args[0]), ['inspect', 'rm']);
  } finally { subject.cleanup(); }
});

test('rejects workspace IDs outside the configured, app-owned workspace root', () => {
  const subject = fixture();
  try {
    assert.throws(() => subject.adapter.create('../outside'), RuntimeAdapterError);
    assert.equal(subject.calls.length, 0);
  } finally { subject.cleanup(); }
});

test('creates and removes an isolated static preview container when Docker integration is enabled', {
  skip: process.env.SYNAPSENEST_DOCKER_TEST !== '1'
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-runtime-docker-'));
  const workspacesRoot = path.join(directory, 'workspaces');
  const workspacePath = path.join(workspacesRoot, WORKSPACE_ID);
  fs.mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(workspacePath, 'index.html'), '<h1>SynapseNest preview</h1>');
  const adapter = new RuntimeAdapter({ workspacesRoot });
  let runtime;
  try {
    runtime = adapter.create(WORKSPACE_ID);
    assert.deepEqual(adapter.start(runtime.id), { id: runtime.id, status: 'running' });
    assert.deepEqual(adapter.status(runtime.id), { id: runtime.id, status: 'running' });
  } finally {
    try {
      if (runtime) {
        const containerName = `synapsenest-runtime-${runtime.id}`;
        try {
          const restartedAdapter = new RuntimeAdapter({ workspacesRoot });
          restartedAdapter.remove(runtime.id);
          assert.throws(() => childProcess.execFileSync('docker', ['container', 'inspect', containerName], { stdio: 'ignore' }));
        } catch (error) {
          // A failed assertion must still not strand the test container.
          try { childProcess.execFileSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' }); } catch { /* preserve the adapter failure */ }
          throw error;
        }
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
