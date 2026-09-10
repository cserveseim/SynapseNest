'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_BYTES = 100_000;
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.svg', '.txt']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { O_CREAT, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK, O_RDONLY, O_TRUNC, O_WRONLY } = fs.constants;

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
    return this.withWorkspaceDirectory(workspaceId, (rootFd) => this.listDirectory(rootFd, [])).sort((a, b) => a.path.localeCompare(b.path));
  }

  readFile(workspaceId, relativePath) {
    const parts = safePathParts(relativePath);
    return this.withWorkspaceDirectory(workspaceId, (rootFd) => {
      const parentFd = this.openParentDirectory(rootFd, parts.slice(0, -1), false);
      try {
        const fileFd = openAt(parentFd, parts.at(-1), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        try {
          assertRegularFile(fs.fstatSync(fileFd));
          const data = fs.readFileSync(fileFd);
          assertTextBuffer(data);
          return data.toString('utf8');
        } finally { closeQuietly(fileFd); }
      } finally { closeQuietly(parentFd); }
    });
  }

  writeFile(workspaceId, relativePath, content) {
    if (typeof content !== 'string') throw new WorkspaceFileError('File content must be text.');
    const data = Buffer.from(content, 'utf8');
    assertTextBuffer(data);
    const parts = safePathParts(relativePath);
    this.withWorkspaceDirectory(workspaceId, (rootFd) => {
      const parentFd = this.openParentDirectory(rootFd, parts.slice(0, -1), true);
      try {
        const fileFd = openAt(parentFd, parts.at(-1), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_NONBLOCK, 0o600);
        try {
          assertRegularFile(fs.fstatSync(fileFd));
          fs.writeFileSync(fileFd, data);
        } finally { closeQuietly(fileFd); }
      } finally { closeQuietly(parentFd); }
    });
  }

  withWorkspaceDirectory(workspaceId, operation) {
    const root = this.workspacePath(workspaceId);
    let rootFd;
    try {
      rootFd = fs.openSync(root, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK);
      if (!fs.fstatSync(rootFd).isDirectory()) throw new WorkspaceFileError('Workspace root is invalid.');
      return operation(rootFd);
    } catch (error) { throw fileError(error); } finally { closeQuietly(rootFd); }
  }

  workspacePath(workspaceId) {
    if (typeof workspaceId !== 'string' || !UUID_PATTERN.test(workspaceId)) throw new WorkspaceFileError('Workspace ID is invalid.');
    const root = path.resolve(this.workspacesRoot, workspaceId);
    if (root !== path.join(this.workspacesRoot, workspaceId)) throw new WorkspaceFileError('Workspace root is invalid.');
    return root;
  }

  openParentDirectory(rootFd, parts, createMissing) {
    let currentFd = duplicateDirectory(rootFd);
    try {
      for (const part of parts) {
        let nextFd;
        try {
          nextFd = openAt(currentFd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK);
        } catch (error) {
          if (!createMissing || error.code !== 'ENOENT') throw error;
          try { fs.mkdirSync(atPath(currentFd, part), { mode: 0o700 }); } catch (mkdirError) {
            if (mkdirError.code !== 'EEXIST') throw mkdirError;
          }
          nextFd = openAt(currentFd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK);
        }
        closeQuietly(currentFd);
        currentFd = nextFd;
      }
      return currentFd;
    } catch (error) {
      closeQuietly(currentFd);
      throw error;
    }
  }

  listDirectory(directoryFd, parts) {
    const files = [];
    let entries;
    try { entries = fs.readdirSync(atPath(directoryFd), { withFileTypes: true }); } catch (error) { throw fileError(error); }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) throw new WorkspaceFileError('Workspace paths may not contain dotfiles.');
      if (entry.isSymbolicLink()) throw new WorkspaceFileError('Workspace paths may not contain symbolic links.');
      const extension = path.extname(entry.name).toLowerCase();
      if (entry.isDirectory()) {
        const childFd = openAt(directoryFd, entry.name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK);
        try {
          if (!fs.fstatSync(childFd).isDirectory()) throw new WorkspaceFileError('Workspace paths may not contain symbolic links.');
          files.push(...this.listDirectory(childFd, [...parts, entry.name]));
        } finally { closeQuietly(childFd); }
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extension)) {
        const fileFd = openAt(directoryFd, entry.name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
        try {
          const stats = fs.fstatSync(fileFd);
          assertRegularFile(stats);
          const content = fs.readFileSync(fileFd);
          assertTextBuffer(content);
          files.push({ path: [...parts, entry.name].join('/'), size: stats.size });
        } finally { closeQuietly(fileFd); }
      }
    }
    return files;
  }
}

function safePathParts(relativePath) {
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
  return parts;
}

function openAt(directoryFd, name, flags, mode) {
  return fs.openSync(atPath(directoryFd, name), flags, mode);
}

function duplicateDirectory(directoryFd) {
  // The /proc descriptor link is intentionally followed; it names an already-open directory.
  return fs.openSync(atPath(directoryFd), O_RDONLY | O_DIRECTORY | O_NONBLOCK);
}

function atPath(directoryFd, name = '') {
  return `/proc/self/fd/${directoryFd}${name ? `/${name}` : ''}`;
}

function assertRegularFile(stats) {
  if (!stats.isFile()) throw new WorkspaceFileError('Requested path is not a regular file.');
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

function closeQuietly(fileDescriptor) {
  if (typeof fileDescriptor !== 'number') return;
  try { fs.closeSync(fileDescriptor); } catch { /* close is best effort during cleanup */ }
}

function fileError(error) {
  if (error instanceof WorkspaceFileError) return error;
  if (error.code === 'ENOENT') return new WorkspaceFileError('Workspace file not found.', 404);
  if (['ELOOP', 'ENOTDIR', 'EISDIR'].includes(error.code)) return new WorkspaceFileError('Workspace paths may not contain symbolic links.');
  return error;
}

module.exports = { WorkspaceFiles, WorkspaceFileError, MAX_TEXT_BYTES, TEXT_EXTENSIONS };
