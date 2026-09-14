# synapsenest.yaml recipe schema v1

**Status:** Living product contract for Nest starter templates  
**Date:** 2026-09-13

Each reviewed starter under `templates/<id>/` ships a `synapsenest.yaml` recipe.
Nest loads these files at process start into the template catalog. Workspace
creation copies only the reviewed text starter files (never the recipe file
itself) into a new workspace Git repo.

## File location

```text
templates/<id>/synapsenest.yaml
templates/<id>/**/*   # starter files (html/css/js/md/…)
```

`<id>` must match `recipe.id` and use lowercase kebab-case.

## Schema

```yaml
schema: synapsenest.recipe/v1
id: landing-page
title: Product landing page
description: Hero, proof points, and a single call-to-action.
runtime: static-preview
previewPort: 8080
install: none
command: httpd
genomeTemplate: landing
tags:
  - marketing
  - static
```

### Fields

| Field | Required | Notes |
|-------|----------|-------|
| `schema` | yes | Must be `synapsenest.recipe/v1` |
| `id` | yes | Must equal the template directory name |
| `title` | yes | Human label for studio / workspace pickers |
| `description` | no | Short intent, ≤400 chars |
| `runtime` | yes | `static-preview` today; `stub`, `node`, `lxc-ubuntu` reserved |
| `previewPort` | no | Default `8080` |
| `install` | no | Declared install intent (`none`, later `npm-ci`) |
| `command` | no | Declared start command (`httpd`, later `npm start`) |
| `genomeTemplate` | no | Default genome studio template label/id |
| `tags` | no | Short string list for discovery |

## API

- `GET /api/templates` — public list of catalog entries (`id`, `title`,
  `description`, `runtime`, `recipe`, `tags`, …)
- `POST /api/workspaces` — `templateId` must be a catalog id; Nest stores the
  resolved `recipe` on the workspace record

## Mapping to Synapse Contract v0

| Recipe field | Contract field |
|--------------|----------------|
| `id` | `recipe.templateId` / Nest `nestTemplateId` |
| `runtime` | `recipe.runtime` |
| `previewPort` | `recipe.previewPort` |
| `install` / `command` | `recipe.install` / `recipe.command` |

## Parser limits

Nest uses a small YAML subset parser (maps, scalars, string lists). Full YAML
1.2 features (anchors, multi-doc, complex keys) are rejected on purpose so
recipes stay reviewable and dependency-free.
