/**
 * SQL-only persistence helpers for verified keyword-candidate publications.
 * Validation, transaction ownership, and current-state decisions belong to the adapter layer.
 */

const PUBLICATION_COLUMNS = [
  "run_id",
  "snapshot_id",
  "request_id",
  "input_fingerprint",
  "source_dataset_artifact_sha256",
  "base_run_id",
  "published_at",
  "applied_at",
  "is_current",
  "handoff_manifest_json",
  "candidate_generation_request_json",
  "candidate_proposal_json",
  "run_manifest_json",
  "current_meta_json",
  "filter_keyword_candidates_json",
];

const PUBLICATION_SELECT = PUBLICATION_COLUMNS.join(", ");

export function readCurrentKeywordCandidatePublication(db) {
  return db.prepare(
    `SELECT ${PUBLICATION_SELECT}
     FROM keyword_candidate_publications
     WHERE is_current = 1`,
  ).get() ?? null;
}

export function readKeywordCandidatePublication(db, runId) {
  return db.prepare(
    `SELECT ${PUBLICATION_SELECT}
     FROM keyword_candidate_publications
     WHERE run_id = ?`,
  ).get(runId) ?? null;
}

export function insertKeywordCandidatePublication(db, record) {
  return db.prepare(
    `INSERT INTO keyword_candidate_publications
      (${PUBLICATION_COLUMNS.join(", ")})
     VALUES (${PUBLICATION_COLUMNS.map(() => "?").join(", ")})`,
  ).run(...PUBLICATION_COLUMNS.map((column) => record[column]));
}

export function clearCurrentKeywordCandidatePublication(db) {
  return db.prepare(
    `UPDATE keyword_candidate_publications
     SET is_current = 0
     WHERE is_current = 1`,
  ).run();
}
