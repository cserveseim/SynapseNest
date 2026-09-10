# Self-hosted workspaces design

## Decision

SynapseNest will run project environments on this server's Docker Engine, while
Cloudflare provides the public edge only: Tunnel, HTTPS, Access, D1 metadata,
and R2 artifacts. Cloudflare Containers and Sandbox are deliberately excluded
because they require a paid Workers plan.

## Product boundary

A **Project Genome** remains the durable record of experiments, branches,
notes, environment recipe, winner, and export. A **Workspace** is a separate,
short-lived working copy of one selected branch. Workspace state must never be
stored inside a Project Genome object.

The first production slice is single-user and self-hosted. It provides:

- a local account/session gate;
- a workspace created from an allowlisted starter template;
- an isolated Docker container with bounded CPU, memory, PIDs, disk, and no
  outbound network by default;
- a browser file tree and safe text editor API;
- a browser terminal attached only to that workspace container;
- a registered preview endpoint proxied by the application, not an arbitrary
  host URL or port;
- Git initialization, snapshot/branch creation, and export archive;
- an environment recipe retained alongside the project lineage.

Provider AI, plugins, and skills remain optional, user-selected helpers. They
cannot receive workspace filesystem access or terminal authority by default.

## Security invariants

1. The public web process accepts workspace IDs and safe relative paths only.
   It rejects absolute paths, traversal, symlink escapes, dotfiles, large or
   binary files, arbitrary images, commands, ports, and URLs.
2. The runtime controller owns Docker operations. It only starts fixed,
   reviewed template images and only executes approved workspace operations.
3. Containers have `--network none`, `--read-only` base filesystem, dropped
   capabilities, `no-new-privileges`, CPU/memory/PID limits, and a mounted
   workspace directory. Previews use a dedicated internal network only after
   the runtime explicitly starts one.
4. Preview proxy targets are server-registered container addresses. Browser
   iframes are sandboxed and cannot escape the app origin.
5. Session cookies are HttpOnly/SameSite/secure when behind HTTPS. Passwords
   are never stored as plaintext; initial bootstrap uses a local owner secret.
6. Docker group access is root-equivalent on the host. Before public launch,
   the web process must run as a non-Docker service user and call a narrowly
   scoped controller over a Unix socket. The current developer process is not
   claimed to be a hardened multi-tenant boundary.

## Delivery sequence

1. Implement and test local Workspace persistence, safe filesystem APIs,
   starter template creation, and Git snapshots.
2. Implement the Docker runtime adapter and a controller boundary with an
   integration test that is skipped when Docker is unavailable.
3. Add the workspace browser: files, terminal, and preview lifecycle.
4. Add a local owner account and authenticated workspace routes.
5. Add a Cloudflare Tunnel/Access deployment configuration, then migrate
   project metadata/artifacts to D1/R2 behind adapters.

## Explicit deferrals

Multi-user tenancy, arbitrary repository import, package installation from the
internet, public workspace sharing, arbitrary Docker images, and managed VM
provisioning are not included in the first safe self-hosted slice. They require
separate authorization and security review.
