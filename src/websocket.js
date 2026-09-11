'use strict';

const crypto = require('node:crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 32_768;

function isWebSocketUpgrade(request) {
  return (request.headers.upgrade || '').toLowerCase() === 'websocket'
    && /\bupgrade\b/i.test(request.headers.connection || '');
}

function accept(request, socket, head) {
  const key = request.headers['sec-websocket-key'];
  if (!key || request.headers['sec-websocket-version'] !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );
  if (head && head.length) socket.unshift(head);
  return new TextSocket(socket);
}

class TextSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.handlers = { message: [], close: [] };
    this.queued = [];
    this.closed = false;
    socket.on('data', (chunk) => this.#push(chunk));
    socket.on('close', () => this.#close());
    socket.on('error', () => this.#close());
  }

  on(event, handler) {
    this.handlers[event]?.push(handler);
    if (event === 'message' && this.queued.length) {
      const queued = this.queued;
      this.queued = [];
      for (const data of queued) handler(data);
    }
  }

  send(text) {
    if (this.closed) return;
    this.socket.write(encodeFrame(Buffer.from(String(text), 'utf8'), 0x1));
  }

  close() {
    if (this.closed) return;
    try { this.socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch { /* already gone */ }
    this.socket.destroy();
    this.#close();
  }

  #emit(event, data) {
    for (const handler of this.handlers[event] || []) handler(data);
  }

  #close() {
    if (this.closed) return;
    this.closed = true;
    this.#emit('close');
  }

  #push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (!this.closed) {
      const frame = decodeFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.length);
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(frame.payload, 0xa));
        continue;
      }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString('utf8');
        if (this.handlers.message.length === 0) this.queued.push(text);
        else this.#emit('message', text);
      }
    }
  }
}

function encodeFrame(payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (payloadLen > MAX_PAYLOAD) throw new Error('WebSocket payload is too large.');
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLen) return null;
  let payload = buffer.subarray(offset + maskLength, offset + maskLength + payloadLen);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, length: offset + maskLength + payloadLen };
}

module.exports = { isWebSocketUpgrade, accept, TextSocket };
