CREATE TABLE keyword_candidate_publications (
    run_id TEXT PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,

    request_id TEXT NOT NULL,
    input_fingerprint TEXT NOT NULL,
    source_dataset_artifact_sha256 TEXT NOT NULL,
    base_run_id TEXT NOT NULL,

    published_at TEXT NOT NULL,
    applied_at TEXT NOT NULL,

    is_current INTEGER NOT NULL
        CHECK (is_current IN (0, 1)),

    handoff_manifest_json TEXT NOT NULL,
    candidate_generation_request_json TEXT NOT NULL,
    candidate_proposal_json TEXT NOT NULL,
    run_manifest_json TEXT NOT NULL,
    current_meta_json TEXT NOT NULL,
    filter_keyword_candidates_json TEXT NOT NULL,

    FOREIGN KEY (snapshot_id)
        REFERENCES raw_snapshots(snapshot_id)
) STRICT;

CREATE UNIQUE INDEX idx_keyword_candidate_publications_current
    ON keyword_candidate_publications(is_current)
    WHERE is_current = 1;

CREATE INDEX idx_keyword_candidate_publications_snapshot
    ON keyword_candidate_publications(snapshot_id);

PRAGMA user_version = 7;
