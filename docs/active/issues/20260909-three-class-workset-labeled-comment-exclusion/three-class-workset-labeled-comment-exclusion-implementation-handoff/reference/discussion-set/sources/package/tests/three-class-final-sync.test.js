import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "three-class-final-sync-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dbPath: path.join(root, "comments.sqlite3") };
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return bytes;
}

function runCli(command, args) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
}

function importBatch(caseData, rows) {
  const inputPath = path.join(caseData.root, `batch-${Math.random()}.json`);
  const bytes = writeJson(inputPath, rows);
  const result = runCli("import-comment-batch", ["--input", inputPath, "--db", caseData.dbPath]);
  assert.equal(result.status, 0, result.stderr);
  return createHash("sha256").update(bytes).digest("hex");
}

function query(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...parameters).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

test("syncs exact comment keys and adopts the worst label for duplicate comments", (t) => {
  const caseData = makeCase(t);
  const targetSha = importBatch(caseData, [
    { username: "a", handle: "@a", comment: "same", postedAt: "1", postedDate: "2026-09-09" },
    { username: "b", handle: "@b", comment: "same", postedAt: "2", postedDate: "2026-09-09" },
    { username: "c", handle: "@c", comment: "reactive", postedAt: "3", postedDate: "2026-09-09" },
    { username: "d", handle: "@d", comment: " same", postedAt: "4", postedDate: "2026-09-09" },
  ]);
  const otherSha = importBatch(caseData, [
    { username: "e", handle: "@e", comment: "same", postedAt: "5", postedDate: "2026-09-09" },
  ]);
  const db = new DatabaseSync(caseData.dbPath);
  try {
    const observations = db.prepare(
      `SELECT sco.observation_id, rs.payload_sha256
       FROM snapshot_comment_observations sco
       JOIN raw_snapshots rs ON rs.snapshot_id = sco.snapshot_id
       ORDER BY sco.observation_id`,
    ).all();
    db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)").run(observations[0].observation_id, "normal");
    db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)").run(observations[2].observation_id, "normal");
    db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)").run(observations[3].observation_id, "normal");
  } finally {
    db.close();
  }

  const finalPath = path.join(caseData.root, "three_class_labeled.json");
  writeJson(finalPath, [
    { comment: "same", label: "normal" },
    { comment: "same", label: "direct_nuisance" },
    { comment: "reactive", label: "reactive" },
    { comment: " same", label: "normal" },
  ]);
  const result = runCli("sync-three-class-final", [
    "--input", finalPath,
    "--snapshot-ref", `${targetSha}:0`,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "synchronized",
    snapshotRef: `${targetSha}:0`,
    finalRecords: 4,
    uniqueComments: 3,
    conflictComments: 1,
    matchedComments: 3,
    unmatchedComments: 0,
    matchedObservations: 4,
    inserted: 1,
    updated: 2,
    unchanged: 1,
  });
  assert.deepEqual(query(caseData.dbPath, `SELECT rs.payload_sha256, sco.comment_text, labels.label
    FROM snapshot_comment_three_class_labels labels
    JOIN snapshot_comment_observations sco ON sco.observation_id=labels.observation_id
    JOIN raw_snapshots rs ON rs.snapshot_id=sco.snapshot_id
    ORDER BY labels.observation_id`), [
    { payload_sha256: targetSha, comment_text: "same", label: "direct_nuisance" },
    { payload_sha256: targetSha, comment_text: "same", label: "direct_nuisance" },
    { payload_sha256: targetSha, comment_text: "reactive", label: "reactive" },
    { payload_sha256: targetSha, comment_text: " same", label: "normal" },
  ]);
  assert.deepEqual(query(caseData.dbPath, `SELECT labels.label
    FROM snapshot_comment_three_class_labels labels
    JOIN snapshot_comment_observations sco ON sco.observation_id=labels.observation_id
    JOIN raw_snapshots rs ON rs.snapshot_id=sco.snapshot_id
    WHERE rs.payload_sha256=?`, [otherSha]), []);

  const replay = runCli("sync-three-class-final", [
    "--input", finalPath,
    "--snapshot-ref", `${targetSha}:0`,
    "--db", caseData.dbPath,
  ]);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).updated, 0);
  assert.equal(JSON.parse(replay.stdout).inserted, 0);
  assert.equal(JSON.parse(replay.stdout).unchanged, 4);
});

test("rejects an invalid final before changing the database", (t) => {
  const caseData = makeCase(t);
  const targetSha = importBatch(caseData, [
    { username: "a", handle: "@a", comment: "same", postedAt: "1", postedDate: "2026-09-09" },
  ]);
  const db = new DatabaseSync(caseData.dbPath);
  try {
    const observation = db.prepare("SELECT observation_id FROM snapshot_comment_observations").get();
    db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)").run(observation.observation_id, "normal");
  } finally {
    db.close();
  }
  const finalPath = path.join(caseData.root, "invalid.json");
  writeJson(finalPath, [{ comment: "same", label: "not-a-label" }]);
  const result = runCli("sync-three-class-final", [
    "--input", finalPath,
    "--snapshot-ref", `${targetSha}:0`,
    "--db", caseData.dbPath,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /THREE_CLASS_FINAL_INVALID/);
  assert.deepEqual(query(caseData.dbPath, "SELECT label FROM snapshot_comment_three_class_labels"), [{ label: "normal" }]);
});
