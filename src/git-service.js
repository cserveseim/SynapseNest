'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_TEXT_BYTES, TEXT_EXTENSIONS } = require('./workspace-files');
const { TEMPLATE_RECIPES } = require('./workspace-store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const ARCHIVE_FORMATS = new Set(['tar', 'zip']);

class GitServiceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'GitServiceError';
    this.statusCode = statusCode;
  }
}

class GitService {
  constructor({ workspacesRoot, exportsRoot, templatesRoot = path.join(__dirname, '..', 'templates') } = {}) {
    if (!workspacesRoot || typeof workspacesRoot !== 'string') throw new TypeError('A workspaces root path is required.');
    if (!exportsRoot || typeof exportsRoot !== 'string') throw new TypeError('An exports root path is required.');
    this.workspacesRoot = path.resolve(workspacesRoot);
    this.exportsRoot = path.resolve(exportsRoot);
    this.templatesRoot = path.resolve(templatesRoot);
  }

  createStarter(workspaceId, templateId = 'static-site') {
    const resolvedTemplate = resolveTemplateId(templateId);
    const workspacePath = this.workspacePath(workspaceId);
    assertEmptyDirectory(workspacePath, 'Workspace root');
    copyReviewedTemplate(path.join(this.templatesRoot, resolvedTemplate), workspacePath);
    this.#runGit(workspacePath, ['init', '--initial-branch=main']);
    this.#runGit(workspacePath, ['config', 'user.name', 'SynapseNest']);
    this.#runGit(workspacePath, ['config', 'user.email', 'workspace@synapsenest.local']);
    this.#runGit(workspacePath, ['add', '--all']);
    this.#runGit(workspacePath, ['commit', '--message', `Create SynapseNest ${resolvedTemplate} starter`]);
    return { branch: 'main', commit: this.#runGit(workspacePath, ['rev-parse', 'HEAD']), templateId: resolvedTemplate };
  }

  createSnapshot(workspaceId, branch) {
    const workspacePath = this.workspacePath(workspaceId);
    assertBranchName(branch);
    this.assertRepository(workspacePath);
    this.#runGit(workspacePath, ['switch', '--create', branch]);
    this.#runGit(workspacePath, ['add', '--all']);
    this.#runGit(workspacePath, ['commit', '--allow-empty', '--message', `Create snapshot ${branch}`]);
    return { branch, commit: this.#runGit(workspacePath, ['rev-parse', 'HEAD']) };
  }

  exportWorkspace(workspaceId, format = 'tar') {
    const workspacePath = this.workspacePath(workspaceId);
    if (!ARCHIVE_FORMATS.has(format)) throw new GitServiceError('Archive format must be tar or zip.');
    this.assertRepository(workspacePath);
    ensureDirectory(this.exportsRoot, 'Export root');
    const archivePath = path.resolve(this.exportsRoot, `${workspaceId}-${randomUUID()}.${format}`);
    if (path.dirname(archivePath) !== this.exportsRoot) throw new GitServiceError('Export path is invalid.');
    this.#runGit(workspacePath, ['archive', `--format=${format}`, `--output=${archivePath}`, 'HEAD']);
    return { format, path: archivePath };
  }

  workspacePath(workspaceId) {
    if (typeof workspaceId !== 'string' || !UUID_PATTERN.test(workspaceId)) throw new GitServiceError('Workspace ID is invalid.');
    const workspacePath = path.resolve(this.workspacesRoot, workspaceId);
    if (workspacePath !== path.join(this.workspacesRoot, workspaceId)) throw new GitServiceError('Workspace root is invalid.');
    ensureDirectory(workspacePath, 'Workspace root');
    return workspacePath;
  }

  assertRepository(workspacePath) {
    if (this.#runGit(workspacePath, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
      throw new GitServiceError('Workspace repository is invalid.');
    }
  }

  #runGit(workspacePath, args) {
    try {
      return childProcess.execFileSync('git', ['-C', workspacePath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '/bin/false',
          LC_ALL: 'C'
        }
      }).trim();
    } catch {
      throw new GitServiceError('Git operation failed.');
    }
  }
}


function resolveTemplateId(templateId) {
  if (typeof templateId !== 'string' || !Object.hasOwn(TEMPLATE_RECIPES, templateId)) {
    throw new GitServiceError(`templateId must be one of: ${Object.keys(TEMPLATE_RECIPES).join(', ')}.`);
  }
  return templateId;
}

function copyReviewedTemplate(templatePath, destinationPath) {
  assertTemplateDirectory(templatePath);
  for (const entry of fs.readdirSync(templatePath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) throw new GitServiceError('Template contains an unsafe path.');
    if (entry.name === 'synapsenest.yaml') continue; // Nest recipe metadata — not workspace content
    const sourcePath = path.join(templatePath, entry.name);
    const destination = path.join(destinationPath, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destination, { mode: 0o700 });
      copyReviewedTemplate(sourcePath, destination);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const content = fs.readFileSync(sourcePath);
      if (content.length > MAX_TEXT_BYTES || content.includes(0)) throw new GitServiceError('Template contains an unsafe file.');
      fs.writeFileSync(destination, content, { mode: 0o600 });
    } else {
      throw new GitServiceError('Template contains an unsafe file.');
    }
  }
}

function assertTemplateDirectory(templatePath) {
  let stats;
  try { stats = fs.lstatSync(templatePath); } catch { throw new GitServiceError('Template is unavailable.'); }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new GitServiceError('Template is invalid.');
}

function assertEmptyDirectory(directoryPath, name) {
  ensureDirectory(directoryPath, name);
  if (fs.readdirSync(directoryPath).length > 0) throw new GitServiceError(`${name} must be empty.`);
}

function ensureDirectory(directoryPath, name) {
  try { fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 }); } catch { throw new GitServiceError(`${name} is invalid.`); }
  let stats;
  try { stats = fs.lstatSync(directoryPath); } catch { throw new GitServiceError(`${name} is invalid.`); }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new GitServiceError(`${name} is invalid.`);
}

function assertBranchName(branch) {
  if (typeof branch !== 'string' || !BRANCH_PATTERN.test(branch)) throw new GitServiceError('Snapshot branch name is invalid.');
}

module.exports = { GitService, GitServiceError };
