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
