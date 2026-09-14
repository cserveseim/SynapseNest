'use strict';

const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');

const DEFAULT_SOCKET = process.env.DOCKER_HOST?.startsWith('unix://')
  ? process.env.DOCKER_HOST.slice('unix://'.length)
  : (process.env.DOCKER_SOCKET || '/var/run/docker.sock');

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function dockerJson(method, urlPath, body, socketPath = DEFAULT_SOCKET) {
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: urlPath,
      method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : { 'Content-Length': 0 }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); }
          catch { resolve(text); }
          return;
        }
        const error = new Error(text || `Docker API ${method} ${urlPath} failed (${res.statusCode}).`);
        error.statusCode = res.statusCode;
        reject(error);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpHijack(method, urlPath, body, socketPath = DEFAULT_SOCKET) {
  const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    let buffer = Buffer.alloc(0);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      reject(error);
    };

    socket.once('error', fail);
    socket.once('connect', () => {
      let request =
        `${method} ${urlPath} HTTP/1.1\r\n`
        + 'Host: localhost\r\n'
        + 'Connection: close\r\n';
      if (payload) {
        request += `Content-Type: application/json\r\nContent-Length: ${payload.length}\r\n`;
      } else {
        request += 'Content-Length: 0\r\n';
      }
      request += '\r\n';
      socket.write(request);
      if (payload) socket.write(payload);
    });

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      socket.off('data', onData);
      const headerText = buffer.subarray(0, headerEnd).toString('utf8');
      const rest = buffer.subarray(headerEnd + 4);
      const statusLine = headerText.split('\r\n')[0] || '';
      const status = Number(statusLine.split(' ')[1]);
      if (status !== 200 && status !== 101) {
        fail(new Error(`Docker hijack failed: ${statusLine}`));
        return;
      }
      if (rest.length) socket.unshift(rest);
      settled = true;
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

/**
 * Attach an interactive TTY docker exec session with resize support.
 * Returns a ChildProcess-like handle: stdin/stdout/stderr + resize/kill/on.
 */
async function attachDockerExecPty({
  containerName,
  cmd,
  cols = 80,
  rows = 24,
  socketPath = DEFAULT_SOCKET,
  workingDir = '/workspace'
} = {}) {
  if (!containerName || typeof containerName !== 'string') throw new TypeError('containerName is required');
  if (!Array.isArray(cmd) || cmd.length === 0) throw new TypeError('cmd is required');

  const width = clampInt(cols, 2, 512, 80);
  const height = clampInt(rows, 2, 256, 24);

  const created = await dockerJson('POST', `/containers/${encodeURIComponent(containerName)}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: cmd,
    WorkingDir: workingDir,
    ConsoleSize: [height, width]
  }, socketPath);

  const execId = created && created.Id;
  if (!execId) throw new Error('Docker exec create did not return an Id.');

  const stream = await httpHijack('POST', `/exec/${execId}/start`, {
    Detach: false,
    Tty: true
  }, socketPath);

  // Ensure kernel/PTY dimensions even if ConsoleSize was ignored by older engines.
  try {
    await dockerJson('POST', `/exec/${encodeURIComponent(execId)}/resize?h=${height}&w=${width}`, null, socketPath);
  } catch {
    /* resize may fail until the process is fully attached; client will retry */
  }

  const stdout = new EventEmitter();
  const stderr = new EventEmitter(); // unused with Tty:true (merged into stdout)
  const stdin = {
    write(data) {
      if (closed) return false;
      try {
        return stream.write(typeof data === 'string' ? data : data);
      } catch {
        return false;
      }
    },
    end() {
      if (closed) return;
      try { stream.end(); } catch { /* ignore */ }
    }
  };

  let closed = false;
  const session = new EventEmitter();
  session.stdin = stdin;
  session.stdout = stdout;
  session.stderr = stderr;
  session.execId = execId;
  session.pid = 0;

  const emitClose = (code = 0) => {
    if (closed) return;
    closed = true;
    session.emit('close', code);
  };

  stream.on('data', (chunk) => stdout.emit('data', chunk));
  stream.on('end', () => emitClose(0));
  stream.on('close', () => emitClose(0));
  stream.on('error', (error) => {
    session.emit('error', error);
    emitClose(1);
  });

  session.resize = async (nextCols, nextRows) => {
    if (closed) return false;
    const w = clampInt(nextCols, 2, 512, width);
    const h = clampInt(nextRows, 2, 256, height);
    await dockerJson('POST', `/exec/${encodeURIComponent(execId)}/resize?h=${h}&w=${w}`, null, socketPath);
    return { cols: w, rows: h };
  };

  session.kill = () => {
    if (closed) return;
    try { stream.destroy(); } catch { /* ignore */ }
    emitClose(1);
  };

  return session;
}

function parseTerminalControlMessage(text) {
  if (typeof text !== 'string' || text.length < 2 || text[0] !== '{') return null;
  let msg;
  try { msg = JSON.parse(text); } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type !== 'resize') return null;
  const cols = clampInt(msg.cols, 2, 512, NaN);
  const rows = clampInt(msg.rows, 2, 256, NaN);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  return { type: 'resize', cols, rows };
}

module.exports = {
  attachDockerExecPty,
  parseTerminalControlMessage,
  dockerJson,
  DEFAULT_SOCKET
};
