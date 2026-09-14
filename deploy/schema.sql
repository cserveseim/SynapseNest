-- SynapseNest core schema — mapped to live JSON stores (2026-09-13)
-- Source of truth until USE_POSTGRES=1 is verified:
--   data/auth.json            → auth_owner + sessions
--   data/workspaces.json      → workspaces (file trees stay on disk)
--   data/project-genomes.json → project_genomes + project_synapses + project_publications
--
-- Safe to re-run. Does not drop tables or touch JSON files.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AuthStore: single owner (passwordSalt / passwordHash / createdAt)
CREATE TABLE IF NOT EXISTS auth_owner (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AuthStore sessions[]: tokenHash, csrfToken, expiresAt
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  csrf_token  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- WorkspaceStore workspaces[] metadata only (data/workspaces/<id>/ stays on disk)
CREATE TABLE IF NOT EXISTS workspaces (
  id                  UUID PRIMARY KEY,
  status              TEXT NOT NULL,
  template_id         TEXT NOT NULL,
  recipe              JSONB NOT NULL DEFAULT '{}'::jsonb,
  selected_branch     TEXT NOT NULL DEFAULT 'main',
  selected_synapse_id TEXT NOT NULL DEFAULT '',
  runtime_id          TEXT NOT NULL DEFAULT '',
  contract_id         TEXT NOT NULL DEFAULT '',
  contract_rev        INTEGER NOT NULL DEFAULT 0,
  contract            JSONB,
  backup_r2_key       TEXT NOT NULL DEFAULT '',
  proof_path          TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_updated_at_idx ON workspaces (updated_at DESC);
CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces (status);

-- ProjectGenomeStore projects[]
CREATE TABLE IF NOT EXISTS project_genomes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template    TEXT NOT NULL DEFAULT 'blank',
  environment JSONB NOT NULL DEFAULT '{}'::jsonb,
  winner_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_genomes_updated_at_idx ON project_genomes (updated_at DESC);

-- projects[].synapses[]
CREATE TABLE IF NOT EXISTS project_synapses (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project_genomes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  parent_id     TEXT,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  preview_theme TEXT,
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS project_synapses_project_id_idx ON project_synapses (project_id);

-- projects[].publications[]
CREATE TABLE IF NOT EXISTS project_publications (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES project_genomes(id) ON DELETE CASCADE,
  synapse_id   TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ NOT NULL,
  proof_url    TEXT
);

CREATE INDEX IF NOT EXISTS project_publications_project_id_idx ON project_publications (project_id);

INSERT INTO schema_migrations (id) VALUES ('001_core_stores')
ON CONFLICT (id) DO NOTHING;
