# SynapseNest Python API

Pinned runtime: `python:3.12-alpine` (digest in `runtime-adapter.js`).

The container runs `python -u /workspace/app.py` on port 8080 with the same
isolation posture as BusyBox previews: no published ports, dropped caps,
read-only root, internal preview network only.
