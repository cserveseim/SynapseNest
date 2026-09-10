# SynapseNest — Project Genome Studio

SynapseNest is a local, self-hosted workspace for recording a project's
creation history as a portable **Project Genome**. Create projects, fork
synapses (experiments), compare their previews, select a winner, record a
publish event, and export the complete genome as JSON.

## Run locally

Requires a current Node.js LTS release.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser.

## Safety boundary

SynapseNest has no cloud account, API key, Docker, terminal, Git-provider, or
remote-deployment integration. It never executes project code or accepts
browser-supplied filesystem paths. Previews are deterministic metadata, not
host-level workspaces.

## Local data

Project data is stored locally in `data/project-genomes.json`. Keep this file
private if it contains project information; copy it to back up your workspace.
It is intentionally excluded from Git.

## API

- `GET /api/projects` — list projects
- `POST /api/projects` — create a project genome
- `GET /api/projects/:id` — retrieve a genome
- `POST /api/projects/:id/synapses` — fork a synapse
- `POST /api/projects/:id/winner` — choose a winning synapse
- `POST /api/projects/:id/publish` — record a publish event
- `GET /api/projects/:id/export` — download a portable JSON export

## Manual live validation

1. Run `npm run dev` and visit `http://localhost:3000`.
2. Create a project, then add a synapse from the initial one with an experiment note.
3. Compare the two synapses, select a winner, and record a publish event.
4. Export the selected project and confirm the downloaded JSON contains its project,
   lineage, winner, and publish history.
5. Refresh the browser and confirm the created project remains available.
