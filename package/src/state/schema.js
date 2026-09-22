export const STATE_SCHEMA_VERSION = 1;

/**
 * Comment DB / Work Orchestrator v3 uses separate tables for release and
 * deployment queue concerns.  The state streams remain the authority for
 * business state; these tables only add v3 identity, materialization and
 * delivery bookkeeping.  Every statement is additive and idempotent.
 */
export const COMMENT_DB_V3_SQL = `
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
  state TEXT NOT NULL CHECK (state IN ('v2_open', 'v2_frozen', 'v2_drained', 'legacy_disabled', 'v3_enabled', 'smoke_verified', 'v3_frozen', 'recovery_frozen')),
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
`;

export const STATE_CONTROL_PLANE_SQL = `
CREATE TABLE IF NOT EXISTS state_schema (
  schema_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS state_streams (
  stream_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (domain, stream_key)
);

CREATE TABLE IF NOT EXISTS state_versions (
  version_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  semantic_sha256 TEXT NOT NULL,
  origin_kind TEXT NOT NULL CHECK (origin_kind IN ('genesis_migration', 'commit')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (stream_id, version_no),
  UNIQUE (stream_id, version_id),
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id)
);

CREATE TABLE IF NOT EXISTS state_stream_heads (
  stream_id TEXT PRIMARY KEY,
  head_version_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id),
  FOREIGN KEY (stream_id, head_version_id) REFERENCES state_versions(stream_id, version_id)
);

CREATE TABLE IF NOT EXISTS state_version_dependencies (
  version_id TEXT NOT NULL,
  dependency_role TEXT NOT NULL,
  dependency_version_id TEXT NOT NULL,
  PRIMARY KEY (version_id, dependency_role, dependency_version_id),
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id),
  FOREIGN KEY (dependency_version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS state_proposals (
  proposal_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  expected_head_version_id TEXT,
  proposed_semantic_sha256 TEXT NOT NULL,
  proposal_payload_json TEXT NOT NULL,
  proposal_sha256 TEXT NOT NULL,
  assessment_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id)
);

CREATE TABLE IF NOT EXISTS state_proposal_dependencies (
  proposal_id TEXT NOT NULL,
  dependency_role TEXT NOT NULL,
  dependency_version_id TEXT NOT NULL,
  PRIMARY KEY (proposal_id, dependency_role, dependency_version_id),
  FOREIGN KEY (proposal_id) REFERENCES state_proposals(proposal_id),
  FOREIGN KEY (dependency_version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS state_decisions (
  decision_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  authority_kind TEXT NOT NULL,
  authority_ref TEXT NOT NULL,
  transition_policy_version_id TEXT NOT NULL,
  rationale TEXT,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES state_proposals(proposal_id)
);

CREATE TABLE IF NOT EXISTS state_transitions (
  transition_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  from_version_id TEXT,
  to_version_id TEXT NOT NULL UNIQUE,
  decision_id TEXT NOT NULL UNIQUE,
  committed_at TEXT NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id),
  FOREIGN KEY (from_version_id) REFERENCES state_versions(version_id),
  FOREIGN KEY (to_version_id) REFERENCES state_versions(version_id),
  FOREIGN KEY (decision_id) REFERENCES state_decisions(decision_id)
);

CREATE TABLE IF NOT EXISTS application_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  operation_kind TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_assessments (
  assessment_id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  assessment_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id)
);

CREATE TABLE IF NOT EXISTS state_evidence (
  evidence_id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corpus_states (
  version_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS corpus_state_snapshots (
  version_id TEXT NOT NULL,
  snapshot_ref TEXT NOT NULL,
  PRIMARY KEY (version_id, snapshot_ref),
  FOREIGN KEY (version_id) REFERENCES corpus_states(version_id)
);

CREATE TABLE IF NOT EXISTS policy_states (
  version_id TEXT PRIMARY KEY,
  policy_kind TEXT NOT NULL,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS classification_states (
  version_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS classification_state_labels (
  version_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (version_id, observation_id),
  FOREIGN KEY (version_id) REFERENCES classification_states(version_id)
);

CREATE TABLE IF NOT EXISTS keyword_selection_states (
  version_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS keyword_selection_entries (
  version_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  selection_state TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  PRIMARY KEY (version_id, keyword),
  FOREIGN KEY (version_id) REFERENCES keyword_selection_states(version_id)
);

CREATE TABLE IF NOT EXISTS promotion_states (
  version_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS deployment_states (
  version_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  verification_ref TEXT NOT NULL,
  state_json TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS release_bundles (
  release_id TEXT PRIMARY KEY,
  bundle_sha256 TEXT NOT NULL UNIQUE,
  projection_definition_version_id TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  materialized_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_bundle_members (
  release_id TEXT NOT NULL,
  role TEXT NOT NULL,
  version_id TEXT NOT NULL,
  PRIMARY KEY (release_id, role),
  FOREIGN KEY (release_id) REFERENCES release_bundles(release_id),
  FOREIGN KEY (version_id) REFERENCES state_versions(version_id)
);

CREATE TABLE IF NOT EXISTS release_artifacts (
  release_id TEXT NOT NULL,
  artifact_key TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  PRIMARY KEY (release_id, artifact_key),
  FOREIGN KEY (release_id) REFERENCES release_bundles(release_id)
);

CREATE TABLE IF NOT EXISTS deployment_requests (
  deployment_request_id TEXT PRIMARY KEY,
  workflow_session_id TEXT NOT NULL DEFAULT '',
  promotion_version_id TEXT NOT NULL DEFAULT '',
  release_id TEXT NOT NULL,
  target TEXT NOT NULL,
  external_run_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('prepared', 'requested', 'succeeded', 'failed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_completed_events (
  event_fingerprint TEXT PRIMARY KEY,
  deployment_request_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_event_outbox (
  event_fingerprint TEXT PRIMARY KEY,
  deployment_request_id TEXT NOT NULL,
  workflow_session_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS state_cutovers (
  stream_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('backfilled', 'verified', 'cutover', 'legacy_read_compatibility', 'retired')),
  legacy_writer_enabled INTEGER NOT NULL CHECK (legacy_writer_enabled IN (0, 1)),
  recorded_at TEXT NOT NULL,
  notes_json TEXT NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES state_streams(stream_id)
);

CREATE INDEX IF NOT EXISTS idx_state_versions_stream_no ON state_versions(stream_id, version_no);
CREATE INDEX IF NOT EXISTS idx_state_dependencies_dependency ON state_version_dependencies(dependency_version_id);
CREATE INDEX IF NOT EXISTS idx_state_proposals_stream ON state_proposals(stream_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deployment_events_request ON deployment_completed_events(deployment_request_id);
`;

function migrateLegacyV3CutoverRecoveryState(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'v3_cutover_control'").get();
  if (!row?.sql || row.sql.includes("'recovery_frozen'")) return;

  db.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    db.exec("DROP INDEX IF EXISTS idx_v3_cutover_events_created");
    db.exec("ALTER TABLE v3_cutover_events RENAME TO v3_cutover_events_legacy_recovery");
    db.exec("ALTER TABLE v3_cutover_control RENAME TO v3_cutover_control_legacy_recovery");
    db.exec(`
      CREATE TABLE v3_cutover_control (
        control_id TEXT PRIMARY KEY CHECK (control_id = 'comment-data-update'),
        state TEXT NOT NULL CHECK (state IN ('v2_open', 'v2_frozen', 'v2_drained', 'legacy_disabled', 'v3_enabled', 'smoke_verified', 'v3_frozen', 'recovery_frozen')),
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
      )
    `);
    db.exec(`
      CREATE TABLE v3_cutover_events (
        event_id TEXT PRIMARY KEY,
        control_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        event_name TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (control_id) REFERENCES v3_cutover_control(control_id)
      )
    `);
    db.exec(`
      INSERT INTO v3_cutover_control
        (control_id, state, target_revision, target_definition_hash, provider_compatible,
         mandatory_verification_passed, v2_hashes_unchanged, v2_hashes_json,
         legacy_writer_enabled, v2_starts_enabled, v3_starts_enabled, evidence_json,
         last_event_id, updated_at)
      SELECT control_id, state, target_revision, target_definition_hash, provider_compatible,
         mandatory_verification_passed, v2_hashes_unchanged, v2_hashes_json,
         legacy_writer_enabled, v2_starts_enabled, v3_starts_enabled, evidence_json,
         last_event_id, updated_at
        FROM v3_cutover_control_legacy_recovery
    `);
    db.exec(`
      INSERT INTO v3_cutover_events
        (event_id, control_id, from_state, to_state, event_name, evidence_json, created_at)
      SELECT event_id, control_id, from_state, to_state, event_name, evidence_json, created_at
        FROM v3_cutover_events_legacy_recovery
    `);
    db.exec("DROP TABLE v3_cutover_events_legacy_recovery");
    db.exec("DROP TABLE v3_cutover_control_legacy_recovery");
    db.exec("CREATE INDEX idx_v3_cutover_events_created ON v3_cutover_events(control_id, created_at, event_id)");
    db.exec("COMMIT");
    committed = true;
  } finally {
    if (!committed) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the migration error */ }
    }
  }
}

export function ensureStateControlPlane(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("a node:sqlite DatabaseSync connection is required");
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(STATE_CONTROL_PLANE_SQL);
  db.exec(COMMENT_DB_V3_SQL);
  migrateLegacyV3CutoverRecoveryState(db);
  const v3Columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!v3Columns("v3_deployment_requests").has("workflow_session_id")) db.exec("ALTER TABLE v3_deployment_requests ADD COLUMN workflow_session_id TEXT NOT NULL DEFAULT ''");
  const deploymentTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'deployment_requests'").get();
  if (deploymentTable?.sql && !deploymentTable.sql.includes("'prepared'")) {
    db.exec("ALTER TABLE deployment_requests RENAME TO deployment_requests_legacy");
    db.exec(`CREATE TABLE deployment_requests (
      deployment_request_id TEXT PRIMARY KEY,
      workflow_session_id TEXT NOT NULL DEFAULT '',
      promotion_version_id TEXT NOT NULL DEFAULT '',
      release_id TEXT NOT NULL,
      target TEXT NOT NULL,
      external_run_ref TEXT,
      status TEXT NOT NULL CHECK (status IN ('prepared', 'requested', 'succeeded', 'failed', 'cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.exec(`INSERT INTO deployment_requests (deployment_request_id, workflow_session_id, promotion_version_id, release_id, target, external_run_ref, status, created_at, updated_at)
      SELECT deployment_request_id, '', '', release_id, target, external_run_ref, status, created_at, updated_at FROM deployment_requests_legacy`);
    db.exec("DROP TABLE deployment_requests_legacy");
  }
  const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  const ensureColumn = (table, name, definition) => { if (!columns(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); };
  ensureColumn("deployment_requests", "workflow_session_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("deployment_requests", "promotion_version_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("deployment_event_outbox", "attempts", "INTEGER NOT NULL DEFAULT 0");
  const existing = db.prepare("SELECT schema_version FROM state_schema LIMIT 1").get();
  if (existing === undefined) db.prepare("INSERT INTO state_schema (schema_version) VALUES (?)").run(STATE_SCHEMA_VERSION);
  else if (Number(existing.schema_version) !== STATE_SCHEMA_VERSION) throw new Error(`unsupported state schema version: ${existing.schema_version}`);
  return db;
}
