# SynapseNest v1: Project Genome Studio

## Purpose

SynapseNest is a self-hosted creator workspace that treats a project as more
than source code. A Project Genome preserves its code, environment recipe,
experiment lineage, notes, preview state, and publish history as a portable
record of creation.

The v1 product is a runnable local dashboard that proves the Project Genome
workflow without requiring cloud accounts, API keys, Docker socket access, or
host-level execution.

## Audience and Constraints

The initial audience is independent creators who want private, self-hosted
spaces for building and comparing web projects.

- Fully self-hosted and free to run.
- No managed-hosting or AI-provider integration in v1; both are explicit
  future extensions.
- Data is persisted locally in a JSON store so a single `npm run dev` starts
  the product.
- Workspace execution is represented by safe, deterministic preview metadata,
  not arbitrary server-side shell execution.

## Core Experience

1. A creator creates a Project Genome with a title, description, and template.
2. The project starts with a primary synapse, its environment recipe, and a
   preview state.
3. The creator creates a synapse from any existing synapse, preserving its
   parent lineage and adding an experiment note.
4. The project view compares two live-preview representations side by side and
   marks one synapse as the current winner.
5. The creator publishes the selected synapse as a proof link and can export
   the full genome as portable JSON.

## Architecture

The app uses a Node.js HTTP server with zero runtime dependencies and a static
browser client.

```text
Browser UI
  -> JSON HTTP API
       -> ProjectGenome service
            -> local JSON persistence
            -> export serializer
```

The service owns validation, IDs, lineage, winner selection, publication
events, and export shape. The client is responsible only for rendering and
issuing API requests. This keeps the core domain independently testable with
Node's built-in test runner.

## HTTP Interface

- `GET /api/projects` lists project summaries.
- `POST /api/projects` creates a genome.
- `GET /api/projects/:id` returns a full genome.
- `POST /api/projects/:id/synapses` forks a synapse with a note.
- `POST /api/projects/:id/winner` selects the winning synapse.
- `POST /api/projects/:id/publish` adds a reversible publish event.
- `GET /api/projects/:id/export` downloads a portable genome JSON document.

## Data Model

A project contains a stable `id`, title, description, template, timestamps,
an environment recipe, an array of synapses, a current winner, and publish
events. A synapse has an ID, name, parent ID (or `null` for the root), note,
status, preview theme, and timestamp.

The export payload includes a schema version and the entire project. This is
the portable Project Genome contract for v1.

## Errors and Safety

Invalid API bodies return `400`; unknown projects or synapses return `404`.
The server only reads and writes its configured data file and never executes
project code or accepts filesystem paths from the browser.

## Test Plan

Domain tests cover project creation, lineage-preserving forks, winner
selection, publishing, and portable export. HTTP integration tests cover the
main creation and retrieval workflow. The production build is verified by
running the complete test suite and starting the server.

## Explicitly Deferred

Docker or VM workspaces, terminal access, Git providers, authentication,
remote deployment, managed hosting, and AI integration are deferred. The v1
interfaces deliberately leave room for those adapters without promising them
today.
