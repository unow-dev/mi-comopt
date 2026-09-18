-- Comment DB v3 additive migration.
-- This file is applied by the v3 state-control-plane bootstrap, not by the
-- legacy application schema-version path.  It intentionally does not
-- reinterpret or backfill any v2 row.
CREATE TABLE IF NOT EXISTS v3_release_bundles (
  release_id TEXT PRIMARY KEY,
  release_key TEXT NOT NULL UNIQUE,
  pins_json TEXT NOT NULL,
  projection_definition_version_id TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  materialization_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_release_artifacts (
  release_id TEXT NOT NULL,
  logical_path TEXT NOT NULL,
  blob_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  artifact_json TEXT NOT NULL,
  PRIMARY KEY (release_id, logical_path),
  FOREIGN KEY (release_id) REFERENCES v3_release_bundles(release_id)
);

CREATE TABLE IF NOT EXISTS v3_deployment_target_sequences (
  target TEXT PRIMARY KEY,
  next_sequence INTEGER NOT NULL CHECK (next_sequence >= 1)
);

CREATE TABLE IF NOT EXISTS v3_deployment_requests (
  deployment_request_id TEXT PRIMARY KEY,
  workflow_session_id TEXT NOT NULL DEFAULT '',
  accepted_promotion_decision_id TEXT NOT NULL,
  promotion_version_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  target TEXT NOT NULL,
  deployment_sequence INTEGER NOT NULL CHECK (deployment_sequence >= 1),
  status TEXT NOT NULL CHECK (status IN ('queued', 'active', 'succeeded', 'failed', 'cancelled', 'superseded')),
  external_run_ref TEXT,
  event_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (accepted_promotion_decision_id, target),
  UNIQUE (target, deployment_sequence)
);

CREATE TABLE IF NOT EXISTS v3_deployment_event_outbox (
  event_id TEXT PRIMARY KEY,
  deployment_request_id TEXT NOT NULL,
  workflow_session_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  request_sha256 TEXT NOT NULL,
  event_json TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('pending', 'delivered', 'dead_lettered')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  dead_lettered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_v3_deployment_fifo
  ON v3_deployment_requests(target, deployment_sequence, status);
CREATE INDEX IF NOT EXISTS idx_v3_deployment_events_pending
  ON v3_deployment_event_outbox(disposition, created_at, event_id);

CREATE TABLE IF NOT EXISTS v3_cutover_control (
  control_id TEXT PRIMARY KEY CHECK (control_id = 'comment-data-update'),
  state TEXT NOT NULL CHECK (state IN ('v2_open', 'v2_frozen', 'v2_drained', 'legacy_disabled', 'v3_enabled', 'smoke_verified', 'v3_frozen')),
  target_revision INTEGER NOT NULL CHECK (target_revision >= 3),
  target_definition_hash TEXT NOT NULL,
  provider_compatible INTEGER NOT NULL CHECK (provider_compatible IN (0, 1)),
  mandatory_verification_passed INTEGER NOT NULL CHECK (mandatory_verification_passed IN (0, 1)),
  v2_hashes_unchanged INTEGER NOT NULL CHECK (v2_hashes_unchanged IN (0, 1)),
  v2_hashes_json TEXT NOT NULL,
  legacy_writer_enabled INTEGER NOT NULL CHECK (legacy_writer_enabled IN (0, 1)),
  v2_starts_enabled INTEGER NOT NULL CHECK (v2_starts_enabled IN (0, 1)),
  v3_starts_enabled INTEGER NOT NULL CHECK (v3_starts_enabled IN (0, 1)),
  evidence_json TEXT NOT NULL,
  last_event_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v3_cutover_events (
  event_id TEXT PRIMARY KEY,
  control_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event_name TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (control_id) REFERENCES v3_cutover_control(control_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_cutover_events_created
  ON v3_cutover_events(control_id, created_at, event_id);
