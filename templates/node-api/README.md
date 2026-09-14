# SynapseNest Node API

Pinned runtime: `node:22-alpine` (digest in `runtime-adapter.js`).

The container runs `node /workspace/server.js` on port 8080 with the same
isolation posture as BusyBox previews: no published ports, dropped caps,
read-only root, internal preview network only.
