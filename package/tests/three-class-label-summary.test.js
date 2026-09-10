import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInput, openCommentDatabase } from "../src/database/comment-database.js";
import { buildThreeClassLabelSummary } from "../scripts/adapters/three-class-label-summary.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cliScript, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "three-class-label-summary-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
  };
}

test("builds a deterministic three-class summary with all labels", () => {
  assert.deepEqual(buildThreeClassLabelSummary([
    {
      snapshot: {
        payloadSha256: "a".repeat(64),
        snapshotIndex: 0,
        loadedCount: 4,
      },
      observations: [
        { sourceIndex: 0 },
        { sourceIndex: 1 },
        { sourceIndex: 2 },
        { sourceIndex: 3 },
      ],
    },
  ], [
    { sourceIndex: 0, label: "normal" },
    { sourceIndex: 1, label: "direct_nuisance" },
    { sourceIndex: 2, label: "normal" },
    { sourceIndex: 3, label: "reactive" },
  ]), {
    schema_version: 1,
    snapshot_ref: {
      payload_sha256: "a".repeat(64),
      snapshot_index: 0,
    },
    total: 4,
    counts: {
      direct_nuisance: 1,
      reactive: 1,
      normal: 2,
    },
  });
});

test("exports the DB label summary for the selected snapshot", async (t) => {
  const caseData = makeCase(t);
  const inputBytes = Buffer.from(JSON.stringify([
    { username: "direct", handle: "@direct", comment: "direct", postedAt: "09:00", postedDate: "2026-09-10" },
    { username: "reactive", handle: "@reactive", comment: "reactive", postedAt: "09:01", postedDate: "2026-09-10" },
    { username: "normal", handle: "@normal", comment: "normal", postedAt: "09:02", postedDate: "2026-09-10" },
  ]), "utf8");
  const imported = await importRawInput(adaptCommentBatchBytes(inputBytes), { dbPath: caseData.dbPath });
  const db = await openCommentDatabase(caseData.dbPath);
  try {
    const snapshotId = db.prepare(
      "SELECT snapshot_id FROM raw_snapshots WHERE payload_sha256 = ? AND snapshot_index = 0",
    ).get(imported.payloadSha256).snapshot_id;
    const observations = db.prepare(
      "SELECT observation_id FROM snapshot_comment_observations WHERE snapshot_id = ? ORDER BY source_index",
    ).all(snapshotId);
    const insert = db.prepare(
      "INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)",
    );
    insert.run(observations[0].observation_id, "direct_nuisance");
    insert.run(observations[1].observation_id, "reactive");
    insert.run(observations[2].observation_id, "normal");
  } finally {
    db.close();
  }

  const output = path.join(caseData.root, "threeClassLabelSummary.json");
  const result = runCli([
    "export-three-class-label-summary-ui",
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--output", output,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), {
    schema_version: 1,
    snapshot_ref: {
      payload_sha256: imported.payloadSha256,
      snapshot_index: 0,
    },
    total: 3,
    counts: {
      direct_nuisance: 1,
      reactive: 1,
      normal: 1,
    },
  });

  const verified = new DatabaseSync(caseData.dbPath, { readOnly: true });
  try {
    assert.equal(verified.prepare("SELECT COUNT(*) AS count FROM snapshot_comment_three_class_labels").get().count, 3);
  } finally {
    verified.close();
  }
});
