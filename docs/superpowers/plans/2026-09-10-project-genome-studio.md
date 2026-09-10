# Project Genome Studio Implementation Plan

**Goal:** Deliver a runnable self-hosted SynapseNest dashboard for Project Genome creation, branching, comparison, publishing, and export.

**Architecture:** A dependency-free Node HTTP server serves a vanilla browser client and JSON API. A small domain store owns genome validation, persistence, synapse lineage, publication, and portable export.

**Tech Stack:** Node.js, built-in `http`, HTML, CSS, and browser JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-10-synapsenest-design.md`

## Execution Constraints

- Fully self-hosted and free to run.
- No cloud accounts, API keys, Docker socket access, or host-level execution.
- The user requested live validation instead of an automated test suite.
- Validate by starting the server and exercising project creation, synapse creation, winner selection, publishing, and export through its HTTP interface.

## Tasks

1. Create package metadata and a durable JSON-backed Project Genome domain store.
2. Implement the HTTP API for projects, synapses, winner selection, publishing, and export.
3. Create the browser dashboard with project creation, side-by-side synapse comparison, and live actions.
4. Add an operating README and run the full live workflow against a started server.
5. Commit the restored documentation and product build, then push the requested repository.
