'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREVIEW_NETWORK = 'synapsenest-preview';
const PREVIEW_PORT = 8080;
const CPU_LIMIT = '0.50';
const MEMORY_LIMIT = '256m';
const PID_LIMIT = '64';

/** Reviewed, pinned runtime profiles. No arbitrary images from clients. */
const RUNTIME_PROFILES = Object.freeze({
  'static-preview': Object.freeze({
    id: 'static-preview',
    image: 'busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213',
    command: Object.freeze(['httpd', '-f', '-p', '8080', '-h', '/workspace']),
    env: Object.freeze([]),
    previewPort: PREVIEW_PORT
  }),
  node: Object.freeze({
    id: 'node',
    image: 'node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32',
    command: Object.freeze(['node', '/workspace/server.js']),
    env: Object.freeze(['HOME=/tmp', 'NODE_ENV=production', 'npm_config_cache=/tmp/npm-cache']),
    previewPort: PREVIEW_PORT
  }),
  python: Object.freeze({
    id: 'python',
    image: 'python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a',
    command: Object.freeze(['python', '-u', '/workspace/app.py']),
    env: Object.freeze(['HOME=/tmp', 'PYTHONDONTWRITEBYTECODE=1', 'PYTHONUNBUFFERED=1']),
    previewPort: PREVIEW_PORT
  })
});

/** @deprecated Prefer RUNTIME_PROFILES['static-preview'].image — kept for existing tests. */
const RUNTIME_IMAGE = RUNTIME_PROFILES['static-preview'].image;

class RuntimeAdapterError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RuntimeAdapterError';
    this.statusCode = statusCode;
  }
}

class RuntimeAdapter {
  constructor({ workspacesRoot, hostWorkspacesRoot, execute = executeDocker } = {}) {
    if (!workspacesRoot || typeof workspacesRoot !== 'string') throw new TypeError('A workspaces root path is required.');
    if (typeof execute !== 'function') throw new TypeError('A Docker executor is required.');
    this.workspacesRoot = path.resolve(workspacesRoot);
    // When the app runs in a container with docker.sock, bind-mount src paths are
    // resolved by the HOST daemon — use the host absolute path when provided.
    const hostRoot = hostWorkspacesRoot || process.env.SYNAPSENEST_HOST_WORKSPACES_ROOT || this.workspacesRoot;
    this.hostWorkspacesRoot = path.resolve(hostRoot);
    this.execute = execute;
    this.runtimes = new Map();
  }

  create(workspaceId, options = {}) {
    const profile = resolveProfile(options.runtime || options.profile || 'static-preview');
    this.workspacePath(workspaceId);
    const id = randomUUID();
    const name = `synapsenest-runtime-${id}`;
    const args = [
      'create',
      '--name', name,
      '--label', `synapsenest.runtime=${id}`,
      '--label', `synapsenest.runtime.profile=${profile.id}`,
      '--network', 'none',
      '--read-only',
      '--user', `${process.getuid()}:${process.getgid()}`,
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--cpus', CPU_LIMIT,
      '--memory', MEMORY_LIMIT,
      '--pids-limit', PID_LIMIT,
      '--workdir', '/workspace',
      // This bind mount is intentionally writable: workspace editing happens here.
      '--mount', `type=bind,src=${this.hostWorkspacePath(workspaceId)},dst=/workspace`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777'
    ];
    for (const entry of profile.env) {
      args.push('--env', entry);
    }
    args.push(profile.image, ...profile.command);
    this.#docker(args);
    this.runtimes.set(id, { name, profile: profile.id, previewPort: profile.previewPort });
    return { id, status: 'created', runtime: profile.id };
  }

  start(runtimeId) {
    const runtime = this.requireRuntime(runtimeId);
    this.#docker(['start', runtime.name]);
    return { id: runtimeId, status: 'running' };
  }

  status(runtimeId) {
    const runtime = this.requireRuntime(runtimeId);
    const status = this.#docker(['inspect', '--format={{.State.Status}}', runtime.name]);
    return { id: runtimeId, status };
  }

  stop(runtimeId) {
    const runtime = this.requireRuntime(runtimeId);
    this.#docker(['stop', '--time', '5', runtime.name]);
    return { id: runtimeId, status: 'stopped' };
  }

  remove(runtimeId) {
    const runtime = this.requireRuntime(runtimeId);
    this.#docker(['rm', '--force', runtime.name]);
    this.runtimes.delete(runtimeId);
    return { id: runtimeId, status: 'removed' };
  }

  previewTarget(runtimeId) {
    const runtime = this.requireRuntime(runtimeId);
    this.ensurePreviewNetwork();
    this.connectPreviewNetwork(runtime.name);
    const networks = JSON.parse(this.#docker(['inspect', `--format={{json .NetworkSettings.Networks}}`, runtime.name]) || '{}');
    const address = networks?.[PREVIEW_NETWORK]?.IPAddress;
    if (!address) throw new RuntimeAdapterError('Preview network address is unavailable.', 503);
    const port = runtime.previewPort || PREVIEW_PORT;
    return { host: address, port };
  }

  attachShell(runtimeId, { cols = 80, rows = 24 } = {}) {
    const runtime = this.requireRuntime(runtimeId);
    // Real PTY via Docker Engine exec API (Tty:true) + /exec/{id}/resize.
    // Still scoped to this workspace runtime container only.
    const { attachDockerExecPty } = require('./docker-exec-pty');
    return attachDockerExecPty({
      containerName: runtime.name,
      cmd: ['sh', '-lc', 'cd /workspace && exec sh'],
      workingDir: '/workspace',
      cols,
      rows
    });
  }

  ensurePreviewNetwork() {
    try {
      this.#docker(['network', 'inspect', PREVIEW_NETWORK]);
    } catch {
      this.#docker(['network', 'create', '--internal', '--label', 'synapsenest.preview=1', PREVIEW_NETWORK]);
    }
  }

  connectPreviewNetwork(containerName) {
    try {
      this.execute(['network', 'connect', PREVIEW_NETWORK, containerName]);
    } catch (error) {
      const stderr = Buffer.isBuffer(error && error.stderr) ? error.stderr.toString('utf8') : String((error && error.stderr) || error && error.message || '');
      if (!/already (exists|connected)/i.test(stderr)) {
        throw new RuntimeAdapterError('Docker runtime operation failed.', 503);
      }
    }
  }

  hostWorkspacePath(workspaceId) {
    // Validate via workspacePath (container-visible path), then map to host bind src.
    this.workspacePath(workspaceId);
    const hostPath = path.resolve(this.hostWorkspacesRoot, workspaceId);
    if (hostPath !== path.join(this.hostWorkspacesRoot, workspaceId)) {
      throw new RuntimeAdapterError('Workspace root is invalid.');
    }
    return hostPath;
  }

  workspacePath(workspaceId) {
    if (typeof workspaceId !== 'string' || !UUID_PATTERN.test(workspaceId)) throw new RuntimeAdapterError('Workspace ID is invalid.');
    const workspacePath = path.resolve(this.workspacesRoot, workspaceId);
    if (workspacePath !== path.join(this.workspacesRoot, workspaceId)) throw new RuntimeAdapterError('Workspace root is invalid.');
    let stats;
    try { stats = fs.lstatSync(workspacePath); } catch { throw new RuntimeAdapterError('Workspace root is unavailable.', 404); }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RuntimeAdapterError('Workspace root is invalid.');
    return workspacePath;
  }

  requireRuntime(runtimeId) {
    if (typeof runtimeId !== 'string' || !UUID_PATTERN.test(runtimeId)) throw new RuntimeAdapterError('Runtime ID is invalid.');
    const runtime = this.runtimes.get(runtimeId) || this.recoverRuntime(runtimeId);
    if (!runtime) throw new RuntimeAdapterError('Runtime not found.', 404);
    return runtime;
  }

  recoverRuntime(runtimeId) {
    const name = `synapsenest-runtime-${runtimeId}`;
    let labels;
    try {
      labels = JSON.parse(String(this.execute(['inspect', '--format={{json .Config.Labels}}', name])).trim());
    } catch (error) {
      if (isDockerObjectNotFound(error)) return null;
      throw new RuntimeAdapterError('Docker runtime operation failed.', 503);
    }
    if (!labels || labels['synapsenest.runtime'] !== runtimeId) return null;
    const profileId = labels['synapsenest.runtime.profile'] || 'static-preview';
    const profile = RUNTIME_PROFILES[profileId] || RUNTIME_PROFILES['static-preview'];
    const runtime = { name, profile: profile.id, previewPort: profile.previewPort };
    this.runtimes.set(runtimeId, runtime);
    return runtime;
  }

  #docker(args) {
    try {
      return String(this.execute(args)).trim();
    } catch {
      throw new RuntimeAdapterError('Docker runtime operation failed.', 503);
    }
  }
}

function resolveProfile(runtimeId) {
  if (typeof runtimeId !== 'string' || !Object.hasOwn(RUNTIME_PROFILES, runtimeId)) {
    throw new RuntimeAdapterError(`runtime must be one of: ${Object.keys(RUNTIME_PROFILES).join(', ')}.`);
  }
  return RUNTIME_PROFILES[runtimeId];
}

function isDockerObjectNotFound(error) {
  const exitCode = error && (error.status ?? error.code);
  const stderr = Buffer.isBuffer(error && error.stderr) ? error.stderr.toString('utf8') : String((error && error.stderr) || '');
  return exitCode === 1 && /no such object/i.test(stderr);
}

function executeDocker(args) {
  return childProcess.execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LC_ALL: 'C' }
  });
}

module.exports = {
  RuntimeAdapter,
  RuntimeAdapterError,
  RUNTIME_IMAGE,
  RUNTIME_PROFILES,
  PREVIEW_NETWORK,
  PREVIEW_PORT
};
