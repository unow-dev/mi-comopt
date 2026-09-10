import { readFile } from "node:fs/promises";

import {
  CommentDatabaseError,
  openCommentDatabase,
} from "../../src/database/comment-database.js";
import { readSelectedSnapshots } from "../../src/database/raw-snapshot-repository.js";
import {
  insertObservationLabel,
  readSnapshotThreeClassLabelTargets,
  updateObservationLabel,
} from "../../src/database/three-class-label-repository.js";
import {
  THREE_CLASS_LABEL_PRIORITY,
  worseThreeClassLabel,
} from "../../src/three-class/label-resolution.js";

function syncError(code, message, options = {}) {
  return new CommentDatabaseError(code, message, options);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readFinalJson(bytes, inputPath) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw syncError("THREE_CLASS_FINAL_INVALID", `${inputPath} is not valid JSON: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(value)) {
    throw syncError("THREE_CLASS_FINAL_INVALID", `${inputPath} must be a JSON array`);
  }
  return value;
}

export function buildThreeClassFinalLabelMap(records) {
  const labelByComment = new Map();
  const commentsWithConflicts = new Set();

  records.forEach((record, index) => {
    if (!isRecord(record) || typeof record.comment !== "string") {
      throw syncError("THREE_CLASS_FINAL_INVALID", `records[${index}].comment must be a string`);
    }
    if (!THREE_CLASS_LABEL_PRIORITY.has(record.label)) {
      throw syncError("THREE_CLASS_FINAL_INVALID", `records[${index}].label is invalid`);
    }

    const current = labelByComment.get(record.comment);
    if (current !== undefined && current !== record.label) {
      commentsWithConflicts.add(record.comment);
    }
    labelByComment.set(record.comment, worseThreeClassLabel(current, record.label));
  });

  return { labelByComment, commentsWithConflicts };
}

function withImmediateTransaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  let committed = false;
  try {
    const result = action();
    db.exec("COMMIT");
    committed = true;
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original synchronization error.
      }
    }
  }
}

export async function syncThreeClassFinal({ dbPath, inputPath, snapshotRef }) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw syncError("VALIDATION_ERROR", "inputPath is required");
  }
  if (!isRecord(snapshotRef)) {
    throw syncError("VALIDATION_ERROR", "snapshotRef is required");
  }

  let bytes;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    throw syncError("INPUT_READ_FAILED", `${inputPath}: ${error.message}`, { cause: error });
  }
  const records = readFinalJson(bytes, inputPath);
  const { labelByComment, commentsWithConflicts } = buildThreeClassFinalLabelMap(records);

  const db = await openCommentDatabase(dbPath);
  try {
    const selectedSnapshots = readSelectedSnapshots(db, [snapshotRef]);
    if (selectedSnapshots.length !== 1) {
      throw syncError("SNAPSHOT_SELECTION_INVALID", "exactly one snapshot is required");
    }
    const snapshot = selectedSnapshots[0].snapshot;
    const targets = readSnapshotThreeClassLabelTargets(db, snapshot.snapshotId);

    return withImmediateTransaction(db, () => {
      const matchedComments = new Set();
      let matchedObservations = 0;
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      for (const target of targets) {
        const requestedLabel = labelByComment.get(target.commentText);
        if (requestedLabel === undefined) continue;
        matchedComments.add(target.commentText);
        matchedObservations += 1;

        if (target.label === undefined || target.label === null) {
          insertObservationLabel(db, {
            observationId: target.observationId,
            label: requestedLabel,
          });
          inserted += 1;
        } else if (target.label === requestedLabel) {
          unchanged += 1;
        } else {
          updateObservationLabel(db, {
            observationId: target.observationId,
            label: requestedLabel,
          });
          updated += 1;
        }
      }

      return {
        status: "synchronized",
        snapshotRef: `${snapshot.payloadSha256}:${snapshot.snapshotIndex}`,
        finalRecords: records.length,
        uniqueComments: labelByComment.size,
        conflictComments: commentsWithConflicts.size,
        matchedComments: matchedComments.size,
        unmatchedComments: labelByComment.size - matchedComments.size,
        matchedObservations,
        inserted,
        updated,
        unchanged,
      };
    });
  } finally {
    try {
      db.close();
    } catch {
      // Preserve the synchronization result or primary error.
    }
  }
}
