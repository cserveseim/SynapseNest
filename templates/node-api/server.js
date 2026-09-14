'use strict';

const http = require('node:http');

const PORT = Number(process.env.PORT) || 8080;

const server = http.createServer((request, response) => {
  const payload = {
    ok: true,
    runtime: 'node',
    service: 'SynapseNest node-api',
    method: request.method,
    path: request.url
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`SynapseNest node-api listening on ${PORT}\n`);
});
