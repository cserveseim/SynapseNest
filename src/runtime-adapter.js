'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_IMAGE = 'busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213';
const CPU_LIMIT = '0.50';
const MEMORY_LIMIT = '256m';
const PID_LIMIT = '64';

class RuntimeAdapterError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RuntimeAdapterError';
    this.statusCode = statusCode;
  }
}

class RuntimeAdapter {
  constructor({ workspacesRoot, execute = executeDocker } = {}) {
    if (!workspacesRoot || typeof workspacesRoot !== 'string') throw new TypeError('A workspaces root path is required.');
    if (typeof execute !== 'function') throw new TypeError('A Docker executor is required.');
    this.workspacesRoot = path.resolve(workspacesRoot);
    this.execute = execute;
    this.runtimes = new Map();
  }

  create(workspaceId) {
    const workspacePath = this.workspacePath(workspaceId);
    const id = randomUUID();
    const name = `synapsenest-runtime-${id}`;
    this.#docker([
      'create',
      '--name', name,
      '--label', `synapsenest.runtime=${id}`,
      '--network', 'none',
      '--read-only',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--cpus', CPU_LIMIT,
      '--memory', MEMORY_LIMIT,
      '--pids-limit', PID_LIMIT,
      // This bind mount is intentionally writable: workspace editing happens here.
      '--mount', `type=bind,src=${workspacePath},dst=/workspace`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m',
      RUNTIME_IMAGE,
      'httpd', '-f', '-p', '8080', '-h', '/workspace'
    ]);
    this.runtimes.set(id, { name });
    return { id, status: 'created' };
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
    const runtime = { name };
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

module.exports = { RuntimeAdapter, RuntimeAdapterError, RUNTIME_IMAGE };
