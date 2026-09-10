# Self-hosted Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn SynapseNest into a cost-minimised, self-hosted project workspace platform with real Docker workspaces, browser development tools, Git snapshots, and a secure Cloudflare-ready edge.

**Architecture:** Keep Project Genome lineage separate from runtime Workspace records. The Node app owns HTTP/auth/UI and a workspace store. A restricted runtime adapter owns fixed Docker lifecycle actions; browser tools address workspace-relative files and registered previews only. Cloudflare is optional infrastructure, not the execution platform.

**Tech Stack:** Node.js built-ins, Docker Engine/Compose, Git CLI, browser WebSocket support, Cloudflare Tunnel/Access/D1/R2 through Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-10-self-hosted-workspaces-design.md`

## Global Constraints

- No paid Cloudflare Containers or Sandboxes.
- No arbitrary commands, images, URLs, host paths, or Docker socket exposed to HTTP clients.
- No user secrets in Git, response bodies, logs, or commits.
- Maintain existing Project Genome API and proof-page behavior.
- Test each behavior before implementation; run the full test suite before each commit.

## File structure

```
src/
  server.js                 # route composition and auth gate
  genome-store.js           # existing project lineage
  workspace-store.js        # workspace metadata and validation
  workspace-files.js        # confined filesystem API
  runtime-adapter.js        # restricted Docker lifecycle operations
  git-service.js            # fixed Git snapshot/export operations
  auth-store.js             # local owner session records
public/
  workspace.html            # developer workspace shell
  workspace.js              # browser file/terminal/preview client
  workspace.css             # responsive three-pane layout
templates/static-site/      # reviewed starter template
test/
  workspace-store.test.js
  workspace-files.test.js
  runtime-adapter.test.js
  workspace-api.test.js
  auth.test.js
deploy/
  docker-compose.yml
  cloudflared/config.yml
  wrangler.jsonc
```

## Tasks

### 1. Workspace domain and safe filesystem foundation

**Files:** `src/workspace-store.js`, `src/workspace-files.js`, `test/workspace-store.test.js`, `test/workspace-files.test.js`

1. Write failing tests for workspace creation, allowed template IDs, lifecycle transitions, path traversal rejection, symlink escape rejection, and text-size/type limits.
2. Implement persistent Workspace records with UUIDs, status, recipe, selected branch/synapse, timestamps, and no absolute paths returned by API.
3. Implement a confined file service using resolved root validation and `lstat` checks; expose list/read/write only for allowlisted text files.
4. Run focused tests, then `npm test`.

### 2. Starter template and Git snapshot service

**Files:** `templates/static-site/*`, `src/git-service.js`, `test/git-service.test.js`

1. Write failing tests that create a reviewed static starter, initialize a repo, create a named branch/snapshot, and produce a tar/zip export only under an app-owned export directory.
2. Implement copy-with-validation, noninteractive fixed Git invocation, author identity local to SynapseNest, and export path confinement.
3. Verify test repo operations and run the full suite.

### 3. Restricted Docker runtime adapter

**Files:** `src/runtime-adapter.js`, `deploy/docker-compose.yml`, `test/runtime-adapter.test.js`

1. Write unit tests for generated Docker argument invariants: fixed image, resource limits, no-new-privileges, dropped capabilities, read-only root, bounded volume, and no public port mappings.
2. Implement create/start/status/stop/remove with a generated runtime ID. No method takes raw Docker arguments from a request.
3. Add an opt-in Docker integration test that creates a static preview container and always cleans it up.
4. Run unit tests and integration test using `SYNAPSENEST_DOCKER_TEST=1`.

### 4. Authenticated workspace API

**Files:** `src/auth-store.js`, `src/server.js`, `test/workspace-api.test.js`, `test/auth.test.js`

1. Write failing HTTP tests: unauthenticated workspace access is denied; bootstrap owner signup/login; create/list/get workspace; safe file read/write; runtime start/stop; snapshot/export.
2. Add password hashing using Node crypto scrypt, signed opaque sessions, CSRF protection for mutating browser requests, and owner-only routes for this first slice.
3. Compose stores/services into the existing server without breaking Genome endpoints.
4. Run all tests.

### 5. Responsive browser IDE and preview proxy

**Files:** `public/workspace.html`, `public/workspace.js`, `public/workspace.css`, `src/server.js`, `test/ui-structure.test.js`

1. Write static/UI contract tests for responsive panes, no unsafe iframe flags, workspace-relative API usage, and terminal WebSocket authentication.
2. Implement workspace selector, file tree, editor, lifecycle controls, snapshot controls, preview iframe, and a mobile single-pane mode.
3. Implement a server-side registered preview proxy and terminal relay bounded to the current workspace. Do not allow a user-selected target.
4. Verify desktop/mobile layout and full tests.

### 6. Deployable self-hosted edge configuration

**Files:** `deploy/cloudflared/config.yml`, `deploy/systemd/*`, `wrangler.jsonc`, `README.md`, `test/deploy-config.test.js`

1. Write config tests for no public Docker port exposure, localhost-only app binding, required Tunnel ingress, and Cloudflare Access instructions.
2. Add installation/config templates with placeholders only—no credentials committed.
3. Configure a named Cloudflare Tunnel and Access application interactively after the service is locally verified; use `synapsenest.eim-agent.com` as the default hostname unless the owner changes it.
4. Remove direct port 3000 ingress only after Tunnel health check succeeds.

### 7. Verification, commits, and handoff

1. Run `npm test`, Docker integration checks, service health check, and a manual authenticated workspace smoke test.
2. Commit each independently verifiable slice locally.
3. Attempt `git push origin main`; if GitHub credentials are still absent, retain the local commits and report the exact authentication requirement without exposing any secret.

