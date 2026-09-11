# SynapseNest — Project Genome Studio

SynapseNest is a local, self-hosted workspace for recording a project's
creation history as a portable **Project Genome**, then opening a selected
branch in an isolated Docker **Workspace**. Create projects, fork synapses,
compare previews, select a winner, record a publish event, and export the
genome as JSON. Workspaces add a confined file editor, Git snapshots, a
container terminal, and a proxied static preview.

## Run locally

Requires Node.js 18+ and, for workspace runtimes, Docker Engine.

```bash
npm test
npm start
```

The genome studio is at [http://127.0.0.1:3000](http://127.0.0.1:3000).
Docker workspaces are at [http://127.0.0.1:3000/workspace](http://127.0.0.1:3000/workspace).

On this VPS a single systemd unit `synapsenest.service` should own port 3000.
Do not start a second `node src/server.js` process.

## Owner gate

The first visit to `/workspace` creates the local owner password. Credentials
are stored as a scrypt hash in `data/auth.json` (mode 0600). Workspace APIs,
the terminal WebSocket, and the preview proxy require that session. Genome
studio routes stay available for local lineage work.

## Safety boundary

- Workspace HTTP only accepts workspace IDs and safe relative text paths.
  Absolute paths, traversal, symlinks, dotfiles, binaries, host URLs, and raw
  Docker arguments are rejected.
- The runtime adapter starts one reviewed BusyBox image with `--network none`,
  `--read-only`, dropped capabilities, CPU/memory/PID limits, and no published
  ports. Preview traffic uses an internal Docker network and a server-side
  proxy to a registered container address.
- The terminal is `docker exec` into that workspace container only.
- Git init/snapshot/export runs with fixed arguments inside the app-owned
  workspace directory.
- Provider AI, plugins, and skills are not granted filesystem or terminal
  access.

`nexus` is in the Docker group, so this first slice is a single-owner
self-hosted runtime, not a hardened multi-tenant boundary.

## Local data

All of the following stay on disk and are gitignored:

- `data/project-genomes.json` — project lineage
- `data/workspaces.json` — workspace metadata
- `data/auth.json` — owner hash and sessions
- `data/workspaces/` — workspace files and Git repos
- `data/exports/` — temporary archives

## API

Genome (unauthenticated, local studio):

- `GET /api/projects` — list projects
- `POST /api/projects` — create a project genome
- `GET /api/projects/:id` — retrieve a genome
- `POST /api/projects/:id/synapses` — fork a synapse
- `POST /api/projects/:id/winner` — choose a winning synapse
- `POST /api/projects/:id/publish` — record a publish event
- `GET /api/projects/:id/export` — download a portable JSON export

Workspace (owner session + CSRF on mutating requests):

- `POST /api/auth/bootstrap` / `POST /api/auth/login` / `POST /api/auth/logout`
- `GET /api/workspaces` — list workspaces
- `POST /api/workspaces` — create a static-site workspace
- `POST /api/workspaces/:id/start` — start the Docker runtime
- `POST /api/workspaces/:id/stop` — stop the Docker runtime
- `GET /api/workspaces/:id/files` and `GET|PUT /api/workspaces/:id/file`
- `POST /api/workspaces/:id/snapshots` — create a Git snapshot branch
- `GET /api/workspaces/:id/export` — download a tar/zip archive
- `GET /api/workspaces/:id/preview/` — proxied container preview
- `GET /api/workspaces/:id/terminal` — WebSocket terminal relay

## Production templates

- `deploy/systemd/synapsenest.service` — one Node process on port 3000
- `deploy/docker-compose.yml` — reviewed static-preview profile (no ports)
- `deploy/cloudflared/config.yml` — Tunnel to `http://127.0.0.1:3000`
- `wrangler.jsonc` — Cloudflare account placeholder only

The app binds `127.0.0.1:3000`. Public HTTPS is:

- https://2.154.66.148.host.secureserver.net:8443
- https://synapsenest-edge.core-ao.workers.dev

Host nginx on 8443 proxies to localhost. A Cloudflare Tunnel named
`synapsenest` is running for `synapsenest.eim-agent.com`; add a proxied
CNAME to `e4811f57-d6f2-42a8-a55f-ad1fe35332b6.cfargotunnel.com` when
zone DNS write access is available. Do not open port 3000 on the firewall.

## Manual live validation

1. Visit the genome studio, create a project, fork a synapse, select a winner,
   publish, and export.
2. Open `/workspace`, create the owner password, and create a static-site
   workspace.
3. Edit a file, start the runtime, confirm the preview iframe, type a command
   in the terminal, take a Git snapshot, and export the archive.
4. Refresh the browser and confirm both the genome and the workspace remain.
