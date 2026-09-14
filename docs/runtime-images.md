# SynapseNest workspace runtime images

Reviewed Docker images used by `src/runtime-adapter.js`. Clients cannot pick
arbitrary images — only allowlisted profiles mapped from workspace templates.

## Profiles

| Template ID   | Runtime profile | Image (pinned) |
|---------------|-----------------|----------------|
| `static-site` | `static-preview` | `busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213` |
| `node-api`    | `node`           | `node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32` |
| `python-api`  | `python`         | `python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a` |

## Security posture (all Docker profiles)

- `--network none` at create; preview attaches only to internal `synapsenest-preview`
- no `--publish` / host ports
- `--cap-drop ALL`, `--security-opt no-new-privileges:true`
- `--read-only` root + bounded `/tmp` tmpfs
- `--cpus 0.50`, `--memory 256m`, `--pids-limit 64`
- non-root `--user` matching the app UID/GID
- writable bind mount limited to the workspace directory

## Host image pull (run on the VPS)

Pull pinned digests before first workspace start so cold starts are not
blocked on registry downloads:

```bash
docker pull busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213
docker pull node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
docker pull python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a
```

Verify:

```bash
docker image inspect \
  busybox@sha256:3c6ae8008e2c2eedd141725c30b20d9c36b026eb796688f88205845ef17aa213 \
  node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 \
  python:3.12-alpine@sha256:b64631e04e4920160c50fbe8d8df828f7f35f06f425cb44aa09bca53e708a35a \
  --format '{{.Id}} {{index .RepoDigests 0}}'
```

Re-pull after digest bumps in `RUNTIME_PROFILES` inside `runtime-adapter.js`.
