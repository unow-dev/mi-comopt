import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CommentDatabaseError, openCommentDatabase } from "../../src/database/comment-database.js";
import {
  readSelectedSnapshots,
  resolveSelectedSnapshotRefs,
} from "../../src/database/raw-snapshot-repository.js";
import { readSnapshotThreeClassLabels } from "../../src/database/three-class-label-repository.js";
import { LABELS } from "../../src/three-class-workset/protocol.js";

function validateLabelCompleteness(selectedSnapshots, labelRows) {
  if (!Array.isArray(selectedSnapshots) || selectedSnapshots.length !== 1) {
    throw new CommentDatabaseError("THREE_CLASS_LABELS_INCOMPLETE", "exactly one snapshot is required");
  }

  const bundle = selectedSnapshots[0];
  const observations = bundle.observations;
  const loadedCount = Number(bundle.snapshot.loadedCount);
  if (!Array.isArray(observations) || !Array.isArray(labelRows) || observations.length !== loadedCount || labelRows.length !== loadedCount) {
    throw new CommentDatabaseError(
      "THREE_CLASS_LABELS_INCOMPLETE",
      "snapshot observations and three-class labels are incomplete",
    );
  }

  for (let index = 0; index < loadedCount; index += 1) {
    const observation = observations[index];
    const labelRow = labelRows[index];
    if (
      observation?.sourceIndex !== index
      || labelRow?.sourceIndex !== index
      || !LABELS.includes(labelRow?.label)
    ) {
      throw new CommentDatabaseError(
        "THREE_CLASS_LABELS_INCOMPLETE",
        `source_index ${index} is missing, misaligned, or invalid`,
      );
    }
  }
}

export function buildThreeClassLabelSummary(selectedSnapshots, labelRows) {
  validateLabelCompleteness(selectedSnapshots, labelRows);
  const snapshot = selectedSnapshots[0].snapshot;
  const counts = Object.fromEntries(LABELS.map((label) => [label, 0]));

  labelRows.forEach(({ label }) => {
    counts[label] += 1;
  });

  return {
    schema_version: 1,
    snapshot_ref: {
      payload_sha256: snapshot.payloadSha256,
      snapshot_index: snapshot.snapshotIndex,
    },
    total: labelRows.length,
    counts,
  };
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicReplaceJsonFile(outputPath, value) {
  const target = path.resolve(outputPath);
  const directory = path.dirname(target);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  let temporaryOwned = false;

  try {
    writeFileSync(temporary, prettyJson(value), { encoding: "utf8", flag: "wx" });
    temporaryOwned = true;
    renameSync(temporary, target);
    temporaryOwned = false;
  } catch (error) {
    throw new CommentDatabaseError("EXPORT_WRITE_FAILED", `${target}: ${error.message}`, { cause: error });
  } finally {
    if (temporaryOwned || existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Preserve the original export error.
      }
    }
  }
}

export async function exportThreeClassLabelSummaryUi({ dbPath, snapshotRef, outputPath }) {
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new CommentDatabaseError("VALIDATION_ERROR", "outputPath is required");
  }

  const db = await openCommentDatabase(dbPath);
  try {
    const selectedSnapshots = readSelectedSnapshots(db, resolveSelectedSnapshotRefs(db, { snapshotRefs: [snapshotRef] }));
    const labelRows = readSnapshotThreeClassLabels(db, selectedSnapshots[0].snapshot.snapshotId);
    const summary = buildThreeClassLabelSummary(selectedSnapshots, labelRows);
    atomicReplaceJsonFile(outputPath, summary);
    return {
      status: "exported",
      snapshotRef: `${summary.snapshot_ref.payload_sha256}:${summary.snapshot_ref.snapshot_index}`,
      total: summary.total,
      outputPath: path.resolve(outputPath),
    };
  } finally {
    db.close();
  }
}
