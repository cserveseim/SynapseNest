'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_BYTES = 100_000;
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.svg', '.txt']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WorkspaceFileError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'WorkspaceFileError';
    this.statusCode = statusCode;
  }
}

class WorkspaceFiles {
  constructor(workspacesRoot) {
    if (!workspacesRoot || typeof workspacesRoot !== 'string') throw new TypeError('A workspaces root path is required.');
    this.workspacesRoot = path.resolve(workspacesRoot);
  }

  listFiles(workspaceId) {
    const root = this.workspaceRoot(workspaceId);
    return this.listDirectory(root, root).sort((a, b) => a.path.localeCompare(b.path));
  }

  readFile(workspaceId, relativePath) {
    const filePath = this.resolveFile(workspaceId, relativePath, false);
    let data;
    try { data = fs.readFileSync(filePath); } catch (error) { throw fileError(error); }
    assertTextBuffer(data);
    return data.toString('utf8');
  }

  writeFile(workspaceId, relativePath, content) {
    if (typeof content !== 'string') throw new WorkspaceFileError('File content must be text.');
    const data = Buffer.from(content, 'utf8');
    assertTextBuffer(data);
    const filePath = this.resolveFile(workspaceId, relativePath, true);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      this.assertNoSymlinks(this.workspaceRoot(workspaceId), path.dirname(filePath));
      try {
        const existing = fs.lstatSync(filePath);
        if (existing.isSymbolicLink() || !existing.isFile()) throw new WorkspaceFileError('Requested path is not a regular file.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      fs.writeFileSync(filePath, data, { mode: 0o600 });
    } catch (error) { throw fileError(error); }
  }

  workspaceRoot(workspaceId) {
    if (typeof workspaceId !== 'string' || !UUID_PATTERN.test(workspaceId)) throw new WorkspaceFileError('Workspace ID is invalid.');
    const root = path.resolve(this.workspacesRoot, workspaceId);
    if (!isWithin(this.workspacesRoot, root)) throw new WorkspaceFileError('Workspace root is invalid.');
    let stats;
    try { stats = fs.lstatSync(root); } catch (error) { throw fileError(error); }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new WorkspaceFileError('Workspace root is invalid.');
    return root;
  }

  resolveFile(workspaceId, relativePath, allowMissing) {
    const root = this.workspaceRoot(workspaceId);
    assertSafeRelativePath(relativePath);
    const target = path.resolve(root, relativePath);
    if (!isWithin(root, target)) throw new WorkspaceFileError('File path must be a safe relative path.');
    this.assertNoSymlinks(root, allowMissing ? path.dirname(target) : target);
    if (!allowMissing) {
      let stats;
      try { stats = fs.lstatSync(target); } catch (error) { throw fileError(error); }
      if (!stats.isFile() || stats.isSymbolicLink()) throw new WorkspaceFileError('Requested path is not a regular file.');
    }
    return target;
  }

  assertNoSymlinks(root, target) {
    const relative = path.relative(root, target);
    const parts = relative ? relative.split(path.sep) : [];
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      let stats;
      try { stats = fs.lstatSync(current); } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      if (stats.isSymbolicLink()) throw new WorkspaceFileError('Workspace paths may not contain symbolic links.');
    }
  }

  listDirectory(root, directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { throw fileError(error); }
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) throw new WorkspaceFileError('Workspace paths may not contain dotfiles.');
      const target = path.join(directory, entry.name);
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink()) throw new WorkspaceFileError('Workspace paths may not contain symbolic links.');
      if (stats.isDirectory()) files.push(...this.listDirectory(root, target));
      else if (stats.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (stats.size > MAX_TEXT_BYTES) throw new WorkspaceFileError('Text files must not exceed 100000 bytes.');
        const content = fs.readFileSync(target);
        assertTextBuffer(content);
        files.push({ path: path.relative(root, target).split(path.sep).join('/'), size: stats.size });
      }
    }
    return files;
  }
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new WorkspaceFileError('File path must be a safe relative path.');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new WorkspaceFileError('File path must be a safe relative path.');
  }
  if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    throw new WorkspaceFileError(`File type must be one of: ${[...TEXT_EXTENSIONS].join(', ')}.`);
  }
}

function assertTextBuffer(data) {
  if (data.length > MAX_TEXT_BYTES) throw new WorkspaceFileError('Text files must not exceed 100000 bytes.');
  if (data.includes(0)) throw new WorkspaceFileError('Only UTF-8 text files are allowed.');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new WorkspaceFileError('Only UTF-8 text files are allowed.');
  }
}

function isWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function fileError(error) {
  if (error instanceof WorkspaceFileError) return error;
  if (error.code === 'ENOENT') return new WorkspaceFileError('Workspace file not found.', 404);
  return error;
}

module.exports = { WorkspaceFiles, WorkspaceFileError, MAX_TEXT_BYTES, TEXT_EXTENSIONS };
