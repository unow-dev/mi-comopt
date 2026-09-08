import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  APPLICATION_SCHEMA_VERSION,
  DEFAULT_DB_PATH,
  MIGRATIONS_DIR,
  openCommentDatabase,
  resolveDatabasePath,
} from "../src/database/comment-database.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "comment-database-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    dbPath: path.join(root, "comments.sqlite3"),
    inputPath: path.join(root, "input.json"),
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runCli(inputPath, dbPath, extraArgs = [], options = {}) {
  return spawnSync(process.execPath, [
    cliScript,
    "import",
    "--input",
    inputPath,
    "--db",
    dbPath,
    ...extraArgs,
  ], {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
  });
}

function query(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).all(...parameters);
  } finally {
    db.close();
  }
}

function scalar(dbPath, sql, parameters = []) {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare(sql).get(...parameters);
  } finally {
    db.close();
  }
}

const observation = (overrides = {}) => ({
  source: "tiktok",
  postRef: "post:example",
  collectedAt: "2026-09-04T01:23:45Z",
  commentText: "comment body",
  ...overrides,
});

test("initializes the schema, indexes, foreign keys, and observation rows", (t) => {
  const { dbPath, inputPath } = makeCase(t);
  writeJson(inputPath, { schemaVersion: 1, observations: [observation(), observation({ commentText: "" })] });

  const result = runCli(inputPath, dbPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^imported payload=[0-9a-f]{64} observations=2\n$/);
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(scalar(dbPath, "PRAGMA user_version").user_version, APPLICATION_SCHEMA_VERSION);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 2);
  assert.deepEqual(
    query(dbPath, "SELECT source_index, comment_text FROM comment_observations ORDER BY source_index")
      .map((row) => [row.source_index, row.comment_text]),
    [[0, "comment body"], [1, ""]],
  );
  assert.match(scalar(dbPath, "SELECT imported_at FROM imports").imported_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(
    query(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name),
    ["authors", "comment_observations", "comments", "imports", "raw_inputs", "raw_snapshots", "snapshot_comment_observations", "snapshot_comment_three_class_labels", "snapshot_video_observations", "three_class_workset_snapshots", "three_class_worksets", "videos"],
  );
  assert.deepEqual(
    query(dbPath, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").map((row) => row.name),
    ["idx_comment_observations_collected_at", "idx_comment_observations_post_time", "idx_snapshot_comment_observations_comment"],
  );
  assert.deepEqual(
    query(dbPath, "PRAGMA table_info(comment_observations)").map((row) => row.name),
    ["observation_id", "import_id", "source_index", "source", "post_ref", "collected_at", "comment_text"],
  );
});

test("migrates a populated v1 database additively without losing v1 rows", async (t) => {
  const { dbPath } = makeCase(t);
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "001-init.sql"), "utf8"));
  legacy.prepare(
    `INSERT INTO imports
      (payload_sha256, imported_at, schema_version, observation_count)
     VALUES (?, ?, ?, ?)`,
  ).run("legacy-payload", "2026-09-04T00:00:00.000Z", 1, 1);
  legacy.prepare(
    `INSERT INTO comment_observations
      (import_id, source_index, source, post_ref, collected_at, comment_text)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(1, 0, "tiktok", "legacy-post", "2026-09-04T00:00:00.000Z", "legacy comment");
  legacy.close();

  const db = await openCommentDatabase(dbPath);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, APPLICATION_SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM imports").get().count, 1);
    assert.deepEqual(
      { ...db.prepare("SELECT source, post_ref, collected_at, comment_text FROM comment_observations").get() },
      {
        source: "tiktok",
        post_ref: "legacy-post",
        collected_at: "2026-09-04T00:00:00.000Z",
        comment_text: "legacy comment",
      },
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM raw_snapshots").get().count, 0);
  } finally {
    db.close();
  }
});

test("normalizes valid timestamps and rejects invalid timestamps without changing rows", (t) => {
  const { dbPath, inputPath } = makeCase(t);
  writeJson(inputPath, {
    schemaVersion: 1,
    observations: [
      observation({ collectedAt: "2026-09-04T01:23:45Z", commentText: "z" }),
      observation({ collectedAt: "2026-09-04T10:23:45+09:00", commentText: "offset" }),
      observation({ collectedAt: "2026-09-04T01:23:45.1Z", commentText: "tenths" }),
      observation({ collectedAt: "2026-09-04T01:23:45.123Z", commentText: "milliseconds" }),
    ],
  });
  assert.equal(runCli(inputPath, dbPath).status, 0);
  assert.deepEqual(
    query(dbPath, "SELECT collected_at FROM comment_observations ORDER BY source_index").map((row) => row.collected_at),
    [
      "2026-09-04T01:23:45.000Z",
      "2026-09-04T01:23:45.000Z",
      "2026-09-04T01:23:45.100Z",
      "2026-09-04T01:23:45.123Z",
    ],
  );

  const invalidValues = [
    "2026-09-04T01:23:45",
    "2026-09-04",
    "2026-02-30T00:00:00Z",
    "2026-09-04T01:23:45.1234Z",
    "not a date",
  ];
  for (const collectedAt of invalidValues) {
    writeJson(inputPath, { schemaVersion: 1, observations: [observation({ collectedAt })] });
    const result = runCli(inputPath, dbPath);
    assert.notEqual(result.status, 0, collectedAt);
    assert.match(result.stderr, /VALIDATION_ERROR/, collectedAt);
  }
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 4);
});

test("enforces the exact input shape while preserving an empty comment", (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const invalidPayloads = [
    [],
    { observations: [] },
    { schemaVersion: "1", observations: [] },
    { schemaVersion: 1, observations: [], extra: true },
    { schemaVersion: 1, observations: [{ source: "tiktok", postRef: "post", collectedAt: "2026-09-04T00:00:00Z" }] },
    { schemaVersion: 1, observations: [{ ...observation(), extra: true }] },
    { schemaVersion: 1, observations: [{ ...observation(), source: 1 }] },
    { schemaVersion: 1, observations: [{ ...observation(), postRef: null }] },
    { schemaVersion: 1, observations: [{ ...observation(), collectedAt: null }] },
    { schemaVersion: 1, observations: [{ ...observation(), commentText: null }] },
    { schemaVersion: 1, observations: [{ ...observation(), source: " \t\n" }] },
    { schemaVersion: 1, observations: [{ ...observation(), postRef: "\n  " }] },
  ];
  for (const [index, payload] of invalidPayloads.entries()) {
    writeJson(inputPath, payload);
    const result = runCli(inputPath, dbPath);
    assert.notEqual(result.status, 0, `invalid payload ${index}`);
    assert.match(result.stderr, /VALIDATION_ERROR/, `invalid payload ${index}`);
  }

  writeJson(inputPath, { schemaVersion: 1, observations: [observation({ commentText: "" })] });
  assert.equal(runCli(inputPath, dbPath).status, 0);
  assert.equal(scalar(dbPath, "SELECT comment_text FROM comment_observations").comment_text, "");
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 1);
});

test("canonical hashing ignores JSON formatting, property order, and observation order", (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const first = {
    schemaVersion: 1,
    observations: [
      observation({ commentText: "first" }),
      observation({ postRef: "post:other", collectedAt: "2026-09-04T02:00:00Z", commentText: "second" }),
    ],
  };
  writeJson(inputPath, first);
  const initial = runCli(inputPath, dbPath);
  assert.equal(initial.status, 0, initial.stderr);
  const firstHash = initial.stdout.match(/payload=([0-9a-f]{64})/)[1];

  const secondPath = path.join(root, "reformatted.json");
  const second = {
    observations: [
      {
        commentText: "second",
        collectedAt: "2026-09-04T02:00:00.000Z",
        postRef: "post:other",
        source: "tiktok",
      },
      {
        commentText: "first",
        collectedAt: "2026-09-04T10:23:45+09:00",
        postRef: "post:example",
        source: "tiktok",
      },
    ],
    schemaVersion: 1,
  };
  fs.writeFileSync(secondPath, `${JSON.stringify(second)}\n`);
  const repeated = runCli(secondPath, dbPath);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, new RegExp(`^already imported payload=${firstHash} observations=2\\n$`));
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 2);
});

test("keeps duplicate observations and allows repeated content across payloads", (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const repeated = observation({ commentText: "same observation" });
  writeJson(inputPath, { schemaVersion: 1, observations: [repeated] });
  const first = runCli(inputPath, dbPath);
  assert.equal(first.status, 0, first.stderr);
  const firstHash = first.stdout.match(/payload=([0-9a-f]{64})/)[1];

  const secondPath = path.join(root, "with-duplicates.json");
  writeJson(secondPath, {
    schemaVersion: 1,
    observations: [
      repeated,
      repeated,
      observation({ commentText: "another observation", collectedAt: "2026-09-04T02:00:00Z" }),
    ],
  });
  const second = runCli(secondPath, dbPath);
  assert.equal(second.status, 0, second.stderr);
  const secondHash = second.stdout.match(/payload=([0-9a-f]{64})/)[1];
  assert.notEqual(firstHash, secondHash);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 2);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 4);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations WHERE comment_text = ?", ["same observation"]).count, 3);
  assert.deepEqual(
    query(dbPath, "SELECT source_index FROM comment_observations WHERE import_id = 2 ORDER BY source_index").map((row) => row.source_index),
    [0, 1, 2],
  );
});

test("rolls back the complete payload after a controlled observation failure", async (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const db = await openCommentDatabase(dbPath);
  db.exec(`
    CREATE TRIGGER test_fail_second_observation
    BEFORE INSERT ON comment_observations
    WHEN NEW.source_index = 1
    BEGIN
      SELECT RAISE(ABORT, 'controlled test failure');
    END;
  `);
  db.close();

  writeJson(inputPath, { schemaVersion: 1, observations: [observation(), observation({ commentText: "second" })] });
  const result = runCli(inputPath, dbPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IMPORT_FAILED/);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 0);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 0);
});

test("enables and enforces foreign keys on application connections", async (t) => {
  const { dbPath } = makeCase(t);
  const db = await openCommentDatabase(dbPath);
  try {
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.throws(
      () => db.prepare(`
        INSERT INTO comment_observations
          (import_id, source_index, source, post_ref, collected_at, comment_text)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(999, 0, "tiktok", "post", "2026-09-04T00:00:00.000Z", "orphan"),
      /FOREIGN KEY/i,
    );
  } finally {
    db.close();
  }
});

test("fails closed for a newer schema without writing payload rows", (t) => {
  const { dbPath, inputPath } = makeCase(t);
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA user_version = ${APPLICATION_SCHEMA_VERSION + 1}`);
  db.close();
  writeJson(inputPath, { schemaVersion: 1, observations: [observation()] });
  const result = runCli(inputPath, dbPath);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SCHEMA_VERSION_UNSUPPORTED/);
  assert.equal(scalar(dbPath, "PRAGMA user_version").user_version, APPLICATION_SCHEMA_VERSION + 1);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'imports'").count, 0);
});

test("resolves the default database and migrations from the repository, not process CWD", (t) => {
  assert.equal(resolveDatabasePath(), DEFAULT_DB_PATH);
  assert.equal(path.dirname(DEFAULT_DB_PATH), path.join(repositoryRoot, "var"));
  assert.equal(MIGRATIONS_DIR, path.join(packageRoot, "db", "comment-database"));
  assert.equal(fs.existsSync(path.join(MIGRATIONS_DIR, "001-init.sql")), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS_DIR, "002-raw-snapshots.sql")), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS_DIR, "003-rich-raw-inputs.sql")), true);

  const { dbPath, inputPath, root } = makeCase(t);
  const unrelatedCwd = path.join(root, "unrelated-cwd");
  fs.mkdirSync(unrelatedCwd);
  writeJson(inputPath, { schemaVersion: 1, observations: [observation()] });
  const result = runCli(inputPath, dbPath, [], { cwd: unrelatedCwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 1);
});

test("preserves strings exactly and supports empty observations", (t) => {
  const { dbPath, inputPath, root } = makeCase(t);
  const composed = "é";
  const decomposed = "e\u0301";
  const exact = observation({
    source: " TikTok ",
    postRef: "post:Case",
    commentText: `  Mixed CASE, punctuation!\n${composed}/${decomposed}  `,
  });
  writeJson(inputPath, { schemaVersion: 1, observations: [exact] });
  assert.equal(runCli(inputPath, dbPath).status, 0);
  const stored = scalar(dbPath, "SELECT source, post_ref, comment_text FROM comment_observations");
  assert.equal(stored.source, exact.source);
  assert.equal(stored.post_ref, exact.postRef);
  assert.equal(stored.comment_text, exact.commentText);

  const emptyPath = path.join(root, "empty.json");
  writeJson(emptyPath, { schemaVersion: 1, observations: [] });
  const firstEmpty = runCli(emptyPath, dbPath);
  const secondEmpty = runCli(emptyPath, dbPath);
  assert.equal(firstEmpty.status, 0, firstEmpty.stderr);
  assert.equal(secondEmpty.status, 0, secondEmpty.stderr);
  assert.match(firstEmpty.stdout, /observations=0/);
  assert.match(secondEmpty.stdout, /already imported/);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM imports").count, 2);
  assert.equal(scalar(dbPath, "SELECT COUNT(*) AS count FROM comment_observations").count, 1);
});

test("documents query limits, adapter boundary, privacy gate, and Git protection", () => {
  const documentation = fs.readFileSync(path.join(packageRoot, "docs", "comment-database.md"), "utf8");
  assert.match(documentation, /LIKE/);
  assert.match(documentation, /観測件数/);
  assert.match(documentation, /collector固有/);
  assert.match(documentation, /利用規約/);
  const gitignore = fs.readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^\/var\/\*\.sqlite3$/m);
  assert.match(gitignore, /^\/var\/\*\.sqlite3-\*$/m);
  assert.match(gitignore, /^\/var\/raw-snapshots\/$/m);
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(rootPackage.scripts["comment-db"], "npm --workspace package run comment-db --");
  assert.equal(packageJson.scripts["comment-db"], "node scripts/comment-database.mjs");
  assert.equal(Object.keys(packageJson.dependencies).some((name) => name.includes("sqlite")), false);
});

test("returns nonzero operator errors without a stack trace", () => {
  const result = spawnSync(process.execPath, [cliScript, "import"], { cwd: packageRoot, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_ERROR/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
