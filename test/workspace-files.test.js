'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { WorkspaceFiles, WorkspaceFileError } = require('../src/workspace-files');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synapsenest-workspace-files-'));
  const workspaceId = 'b70a7e9d-3323-4a49-909c-d2994324a90d';
  fs.mkdirSync(path.join(directory, workspaceId), { recursive: true });
  return {
    directory,
    workspaceId,
    files: new WorkspaceFiles(directory),
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

test('skips git metadata when listing workspace files', () => {
  const subject = fixture();
  try {
    fs.mkdirSync(path.join(subject.directory, subject.workspaceId, '.git'));
    fs.writeFileSync(path.join(subject.directory, subject.workspaceId, '.git', 'config'), 'secret');
    subject.files.writeFile(subject.workspaceId, 'index.html', '<h1>ok</h1>\n');
    assert.deepEqual(subject.files.listFiles(subject.workspaceId), [{ path: 'index.html', size: 12 }]);
  } finally { subject.cleanup(); }
});

test('lists, reads, and writes allowlisted text files inside a workspace', () => {
  const subject = fixture();
  try {
    subject.files.writeFile(subject.workspaceId, 'src/app.js', 'console.log("safe");\n');
    assert.deepEqual(subject.files.listFiles(subject.workspaceId), [{ path: 'src/app.js', size: 21 }]);
    assert.equal(subject.files.readFile(subject.workspaceId, 'src/app.js'), 'console.log("safe");\n');
  } finally { subject.cleanup(); }
});

test('rejects traversal, absolute paths, and dotfiles', () => {
  const subject = fixture();
  try {
    for (const unsafePath of ['../outside.txt', '/etc/passwd', '.env', 'src/../.secret']) {
      assert.throws(
        () => subject.files.writeFile(subject.workspaceId, unsafePath, 'nope'),
        (error) => error instanceof WorkspaceFileError && /safe relative path/i.test(error.message)
      );
    }
  } finally { subject.cleanup(); }
});

test('rejects symlink escapes before reading or listing', () => {
  const subject = fixture();
  try {
    const outside = path.join(subject.directory, 'outside.txt');
    fs.writeFileSync(outside, 'private');
    fs.symlinkSync(outside, path.join(subject.directory, subject.workspaceId, 'escape.txt'));

    assert.throws(() => subject.files.readFile(subject.workspaceId, 'escape.txt'), WorkspaceFileError);
    assert.throws(() => subject.files.listFiles(subject.workspaceId), WorkspaceFileError);
  } finally { subject.cleanup(); }
});

test('rejects writes through an existing symlink', () => {
  const subject = fixture();
  try {
    const outside = path.join(subject.directory, 'outside.txt');
    fs.writeFileSync(outside, 'private');
    fs.symlinkSync(outside, path.join(subject.directory, subject.workspaceId, 'escape.txt'));

    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'escape.txt', 'overwrite'), WorkspaceFileError);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'private');
  } finally { subject.cleanup(); }
});

test('rejects intermediate directory symlinks without touching the external target', () => {
  const subject = fixture();
  try {
    const outsideDirectory = path.join(subject.directory, 'outside');
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, 'app.js'), 'private');
    fs.symlinkSync(outsideDirectory, path.join(subject.directory, subject.workspaceId, 'src'));

    assert.throws(() => subject.files.readFile(subject.workspaceId, 'src/app.js'), WorkspaceFileError);
    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'src/app.js', 'overwrite'), WorkspaceFileError);
    assert.equal(fs.readFileSync(path.join(outsideDirectory, 'app.js'), 'utf8'), 'private');
  } finally { subject.cleanup(); }
});

test('rejects a symlinked workspace root without reading the target', () => {
  const subject = fixture();
  try {
    const workspacePath = path.join(subject.directory, subject.workspaceId);
    const outsideDirectory = path.join(subject.directory, 'outside');
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, 'app.js'), 'private');
    fs.rmdirSync(workspacePath);
    fs.symlinkSync(outsideDirectory, workspacePath);

    assert.throws(() => subject.files.readFile(subject.workspaceId, 'app.js'), WorkspaceFileError);
    assert.equal(fs.readFileSync(path.join(outsideDirectory, 'app.js'), 'utf8'), 'private');
  } finally { subject.cleanup(); }
});

test('rejects a final-component symlink swap before an external read', () => {
  const subject = fixture();
  const originalOpen = fs.openSync;
  try {
    const workspaceFile = path.join(subject.directory, subject.workspaceId, 'app.js');
    const outside = path.join(subject.directory, 'outside.js');
    fs.writeFileSync(workspaceFile, 'safe');
    fs.writeFileSync(outside, 'private');
    fs.openSync = function openAndSwap(filePath, ...arguments_) {
      if (String(filePath).endsWith('/app.js')) {
        fs.openSync = originalOpen;
        fs.unlinkSync(workspaceFile);
        fs.symlinkSync(outside, workspaceFile);
      }
      return originalOpen.call(fs, filePath, ...arguments_);
    };

    assert.throws(() => subject.files.readFile(subject.workspaceId, 'app.js'), WorkspaceFileError);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'private');
  } finally {
    fs.openSync = originalOpen;
    subject.cleanup();
  }
});

test('rejects a final-component symlink swap before an external write', () => {
  const subject = fixture();
  const originalOpen = fs.openSync;
  try {
    const workspaceFile = path.join(subject.directory, subject.workspaceId, 'app.js');
    const outside = path.join(subject.directory, 'outside.js');
    fs.writeFileSync(workspaceFile, 'safe');
    fs.writeFileSync(outside, 'private');
    fs.openSync = function openAndSwap(filePath, flags, ...arguments_) {
      if (String(filePath).endsWith('/app.js') && (flags & fs.constants.O_WRONLY)) {
        fs.openSync = originalOpen;
        fs.unlinkSync(workspaceFile);
        fs.symlinkSync(outside, workspaceFile);
      }
      return originalOpen.call(fs, filePath, flags, ...arguments_);
    };

    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'app.js', 'overwrite'), WorkspaceFileError);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'private');
  } finally {
    fs.openSync = originalOpen;
    subject.cleanup();
  }
});

test('accepts only bounded UTF-8 text in allowlisted file types', () => {
  const subject = fixture();
  try {
    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'image.png', 'nope'), WorkspaceFileError);
    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'readme.txt', 'a'.repeat(100_001)), WorkspaceFileError);
    assert.throws(() => subject.files.writeFile(subject.workspaceId, 'readme.txt', 'before\u0000after'), WorkspaceFileError);
    subject.files.writeFile(subject.workspaceId, 'unicode.txt', 'replacement character: \uFFFD');
    assert.equal(subject.files.readFile(subject.workspaceId, 'unicode.txt'), 'replacement character: \uFFFD');
    fs.writeFileSync(path.join(subject.directory, subject.workspaceId, 'binary.txt'), Buffer.from([0x61, 0, 0x62]));
    assert.throws(() => subject.files.readFile(subject.workspaceId, 'binary.txt'), WorkspaceFileError);
  } finally { subject.cleanup(); }
});
