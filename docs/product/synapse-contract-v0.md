# Synapse Contract v0 + Golden Path

**Product line:** Seal an identity in SYNAPSE; Nest gives it a private machine.  
**Status:** Product draft — no LXC/infra required to validate the path.  
**Date:** 2026-09-12

## Roles

| System | Role | Owns |
|--------|------|------|
| **Universe SYNAPSE** | Control plane of *meaning* | Mission, theater, rehearsal, guardian seal, ordinances |
| **SynapseNest** | Control plane of *matter* | Genome lineage, workspace files, runtime, IDE/APK, preview |
| **Continuum** | Fleet / production | Promote sealed work beyond the sandbox |

Law: **Identity travels. Hardware follows.** Nothing in Nest materializes without a Contract (even if v0 stubs the hardware).

---

## Synapse Contract (v0)

A Contract is the portable object that crosses the Universe → Nest boundary after a Guardian seal. It is *not* a Theater (rehearsal) and *not* a Workspace (runtime). It is the sealed permission for hardware to exist.

```json
{
  "schema": "synapse.contract/v0",
  "id": "contract_<uuid>",
  "rev": 1,
  "issuedAt": "2026-09-12T00:00:00.000Z",
  "issuer": {
    "planet": "SYNAPSE",
    "universe": "eimOS",
    "guardianFp": "<fingerprint of public guardian key>"
  },
  "identity": {
    "mission": "One-line human mission",
    "stance": "student|worker|institution|enterprise",
    "theaterKind": "school|enterprise|clinic|newsroom|civic|atelier|blank",
    "ordinanceId": "<signed ordinance id from SYNAPSE shelf>"
  },
  "lineage": {
    "genomeId": "project_<uuid>|null",
    "synapseId": "syn_<uuid>|null",
    "title": "Human title for Nest genome",
    "description": "Short description",
    "proofPath": ""
  },
  "recipe": {
    "templateId": "static-site|node-api|continuum-app|blank",
    "runtime": "static-preview|lxc-ubuntu|stub",
    "previewPort": 8080,
    "install": "none|npm-ci|deferred",
    "command": "httpd|npm start|deferred"
  },
  "limits": {
    "cpu": 1.0,
    "memoryMb": 1024,
    "diskMb": 4096,
    "pids": 256,
    "network": "none|preview|egress-allowlist",
    "ttlHours": 72
  },
  "policy": {
    "blastsAllowed": ["read", "write", "memory"],
    "blastsForbidden": ["external"],
    "needsDirectorGate": true,
    "promoteToContinuum": false
  },
  "backup": {
    "r2Key": ""
  },
  "seal": {
    "alg": "guardian-ordinance",
    "signature": "<detached or embedded ordinance signature>",
    "signedAt": "2026-09-12T00:00:00.000Z"
  }
}
```

### Field rules (v0)

- `schema` must be `synapse.contract/v0`.
- `issuer.guardianFp` must match a guardian public key known to SYNAPSE.
- `identity.mission` is required (non-empty).
- `recipe.runtime` may be `stub` while hardware is not ready — Nest still creates genome + workspace metadata.
- `limits` are *declared intent*; BusyBox today may clamp; LXC later honors them.
- `lineage.genomeId` null ⇒ Nest creates a new Project Genome on accept.
- `lineage.synapseId` null ⇒ Nest creates primary synapse and links workspace to it.
- Unsigned contracts are rejected. (Dev-only unsigned mode is opt-in and must log loudly.)

### Mapping today → Contract

| SYNAPSE today | Contract field |
|---------------|----------------|
| Theater.mission | identity.mission |
| Stance | identity.stance |
| Theater.kind | identity.theaterKind |
| Sealed ordinance id | identity.ordinanceId + seal.* |
| Guardian fingerprint | issuer.guardianFp |
| Rehearsal blasts / gates | policy.blasts* / needsDirectorGate |

| Nest today | Contract field |
|------------|----------------|
| ProjectGenome title/description/template | lineage.* + recipe.templateId |
| environment.runtime/install/command | recipe.* |
| Workspace.recipe / selectedSynapseId | recipe + lineage.synapseId |
| Runtime CPU/mem (hardcoded 0.5/256) | limits.* (future-honored) |

---

## Golden Path (v0 — product, stub-ok)

**Name:** Mission → Seal → Contract → Nest → Genome proof

```
1. COMPOSE   Human states intent in SYNAPSE
2. REHEARSE  Theater + laws + verdict (ready|warning|blocked)
3. GATE      Director approve (when needsGate)
4. SEAL      Guardian signs ordinance → shelf
5. ISSUE     SYNAPSE emits Synapse Contract v0
6. ACCEPT    Nest validates seal + schema
7. LINEAGE   Nest creates/links Project Genome + synapse
8. MATTER    Nest creates workspace (runtime=stub|static-preview|lxc)
9. PROOF     Nest publish proof URL tied to genome + contract id
10. (later)  Continuum promote if policy.promoteToContinuum
```

### Acceptance criteria for “golden path works”

Without waiting on Incus:

1. A sealed SYNAPSE ordinance can produce a Contract JSON document.
2. Nest accepts that document via one authenticated API (`POST /api/contracts/accept` — to build).
3. Accept creates (or links) a genome + workspace with `contractId` stored on the workspace record.
4. Workspace opens in `/workspace` IDE; proof page cites mission + contract id.
5. If `runtime=stub`, UI shows “Hardware deferred — identity sealed” instead of pretending BusyBox is the product.

### Explicit non-goals for v0 path

- Multi-tenant billing
- Arbitrary Docker images from the contract
- Full LXC provisioning (Phase infra, after path is felt)
- Auto Continuum production deploy

---

## Thin build slice (when you say go)

1. **Spec freeze** this doc as `synapse.contract/v0`.
2. Add `contractId` (+ optional `contract` snapshot) to Nest `workspaces.json` records.
3. `POST /api/contracts/accept` in Nest (owner auth): validate schema → genome → workspace.
4. SYNAPSE: “Send to Nest” after seal → POST Contract (same-host first: `127.0.0.1:3000`).
5. Proof page shows mission + contract id + guardianFp.
6. Only then: swap `runtime-adapter` for LXC that reads `limits` from the stored contract.

---

## One-liner tests of uniqueness

- Replit: *open editor → get machine.*  
- Us: *seal identity → machine may follow.*

If a user can skip seal and still get a blank Nest workspace as the default hero path, we have drifted back to a lookalike.


## Freeze notes (2026-09-12)

- `rev` required, start at 1; amendments increment.
- `lineage.proofPath` filled by Nest after publish.
- `backup.r2Key` set when Contract/genome copy lands in R2.
- Accept succeeds even if runtime is `stub`.
