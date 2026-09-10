/**
 * SQL-only persistence helpers for three-class workset provenance and labels.
 * Workflow decisions (validation, conflicts, and transaction ownership) belong
 * to the adapter layer.
 */

export function worksetExists(db, worksetId) {
  const row = db.prepare(
    "SELECT 1 AS present FROM three_class_worksets WHERE workset_id = ?",
  ).get(worksetId);
  return row !== undefined;
}

export function registerWorkset(db, { worksetId, snapshotIds }) {
  db.prepare(
    "INSERT INTO three_class_worksets (workset_id) VALUES (?)",
  ).run(worksetId);
  const insertSnapshot = db.prepare(
    `INSERT INTO three_class_workset_snapshots
       (workset_id, snapshot_id)
     VALUES (?, ?)`,
  );
  for (const snapshotId of snapshotIds) {
    insertSnapshot.run(worksetId, snapshotId);
  }
}

export function readWorksetSnapshotRefs(db, worksetId) {
  return db.prepare(
    `SELECT rs.payload_sha256, rs.snapshot_index
     FROM three_class_workset_snapshots AS tws
     JOIN raw_snapshots AS rs
       ON rs.snapshot_id = tws.snapshot_id
     WHERE tws.workset_id = ?
     ORDER BY rs.payload_sha256, rs.snapshot_index`,
  ).all(worksetId).map((row) => ({
    payloadSha256: row.payload_sha256,
    snapshotIndex: Number(row.snapshot_index),
  }));
}

export function readTargetObservations(db, worksetId) {
  return db.prepare(
    `SELECT
        sco.observation_id,
        sco.comment_text
     FROM three_class_workset_snapshots AS tws
     JOIN snapshot_comment_observations AS sco
       ON sco.snapshot_id = tws.snapshot_id
     WHERE tws.workset_id = ?
     ORDER BY sco.snapshot_id, sco.source_index`,
  ).all(worksetId).map((row) => ({
    observationId: Number(row.observation_id),
    commentText: row.comment_text,
  }));
}

export function readExistingCommentLabels(db) {
  return db.prepare(
    `SELECT
        sco.comment_text,
        labels.label,
        MIN(labels.observation_id) AS example_observation_id
     FROM snapshot_comment_three_class_labels AS labels
     JOIN snapshot_comment_observations AS sco
       ON sco.observation_id = labels.observation_id
     GROUP BY sco.comment_text, labels.label`,
  ).all().map((row) => ({
    commentText: row.comment_text,
    label: row.label,
    exampleObservationId: Number(row.example_observation_id),
  }));
}

export function readExistingTargetLabels(db, worksetId) {
  return db.prepare(
    `SELECT
        sco.observation_id,
        labels.label
     FROM three_class_workset_snapshots AS tws
     JOIN snapshot_comment_observations AS sco
       ON sco.snapshot_id = tws.snapshot_id
     JOIN snapshot_comment_three_class_labels AS labels
       ON labels.observation_id = sco.observation_id
     WHERE tws.workset_id = ?
     ORDER BY sco.snapshot_id, sco.source_index`,
  ).all(worksetId).map((row) => ({
    observationId: Number(row.observation_id),
    label: row.label,
  }));
}

export function readSnapshotThreeClassLabels(db, snapshotId) {
  return db.prepare(
    `SELECT
        sco.source_index,
        labels.label
     FROM snapshot_comment_observations AS sco
     JOIN snapshot_comment_three_class_labels AS labels
       ON labels.observation_id = sco.observation_id
     WHERE sco.snapshot_id = ?
     ORDER BY sco.source_index ASC`,
  ).all(snapshotId).map((row) => ({
    sourceIndex: Number(row.source_index),
    label: row.label,
  }));
}

export function readSnapshotThreeClassLabelTargets(db, snapshotId) {
  return db.prepare(
    `SELECT
        sco.observation_id,
        sco.comment_text,
        labels.label
     FROM snapshot_comment_observations AS sco
     LEFT JOIN snapshot_comment_three_class_labels AS labels
       ON labels.observation_id = sco.observation_id
     WHERE sco.snapshot_id = ?
     ORDER BY sco.source_index ASC`,
  ).all(snapshotId).map((row) => ({
    observationId: Number(row.observation_id),
    commentText: row.comment_text,
    label: row.label,
  }));
}

export function insertObservationLabel(db, { observationId, label }) {
  return db.prepare(
    `INSERT INTO snapshot_comment_three_class_labels
       (observation_id, label)
     VALUES (?, ?)`,
  ).run(observationId, label);
}

export function updateObservationLabel(db, { observationId, label }) {
  return db.prepare(
    `UPDATE snapshot_comment_three_class_labels
     SET label = ?
     WHERE observation_id = ?`,
  ).run(label, observationId);
}
