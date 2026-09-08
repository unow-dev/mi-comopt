import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "..");
const cliScript = path.join(packageRoot, "scripts", "comment-database.mjs");
const migrationScript = path.join(packageRoot, "scripts", "migrate-three-class-history.mjs");
const packerScript = path.join(packageRoot, "scripts", "pack-three-class-workset.py");
const promptPath = path.join(packageRoot, "templates", "three-class-workset", "PROMPT.md");
const rulesPath = path.join(packageRoot, "templates", "three-class-workset", "RULES.md");
const historyPath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_history.json",
);
const legacyReferencePath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "Integrated_Labeling_Handoff_v1.5.0",
  "reference",
  "stage13_labeled_REFERENCE.json",
);
const legacyGoldenPath = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_golden_adjudications.json",
);
const legacyP2Path = path.join(
  repositoryRoot,
  "docs",
  "active",
  "operations",
  "integrated-labeling-state",
  "three_class_p2_adjudications.json",
);

function makeCase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "three-class-workset-v1-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dbPath: path.join(root, "comments.sqlite3") };
}

function runCli(command, args, options = {}) {
  return spawnSync(process.execPath, [cliScript, command, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    ...options,
  });
}

function writeJson(filePath, value, raw = false) {
  const bytes = Buffer.from(raw ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return bytes;
}

function importBatch(caseData, rows) {
  const inputPath = path.join(caseData.root, "batch.json");
  const bytes = writeJson(inputPath, rows);
  const result = runCli("import-comment-batch", ["--input", inputPath, "--db", caseData.dbPath]);
  assert.equal(result.status, 0, result.stderr);
  return {
    payloadSha256: createHash("sha256").update(bytes).digest("hex"),
    result,
  };
}

function zipMembers(zipPath) {
  const result = spawnSync("python3", ["-c", [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    "    print(json.dumps(z.namelist()))",
  ].join("\n"), zipPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function zipMember(zipPath, name) {
  const result = spawnSync("python3", ["-c", [
    "import base64, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1]) as z:",
    "    print(base64.b64encode(z.read(sys.argv[2])).decode())",
  ].join("\n"), zipPath, name], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return Buffer.from(result.stdout.trim(), "base64");
}

function rewriteZip(source, target, operation, name) {
  const script = [
    "import base64, sys, zipfile",
    "source, target, operation, name, payload = sys.argv[1:]",
    "with zipfile.ZipFile(source) as old:",
    "    members = [(info.filename, old.read(info)) for info in old.infolist()]",
    "if operation == 'replace':",
    "    members = [(member, base64.b64decode(payload) if member == name else data) for member, data in members]",
    "elif operation == 'duplicate':",
    "    members.append((name, base64.b64decode(payload)))",
    "elif operation == 'unsafe':",
    "    members.append((name, base64.b64decode(payload)))",
    "with zipfile.ZipFile(target, 'w') as new:",
    "    for member, data in members:",
    "        new.writestr(member, data)",
  ].join("\n");
  const result = spawnSync("python3", [
    "-c",
    script,
    source,
    target,
    operation,
    name,
    Buffer.from(payloadForOperation(operation, source, name)).toString("base64"),
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function payloadForOperation(operation, source, name) {
  if (operation === "replace") return Buffer.from("tampered", "utf8");
  return zipMember(source, name === "ITEMS.json" ? "ITEMS.json" : "PROMPT.md");
}

function makeArchiveWithEntries(target, entries, symlinkName = undefined) {
  const script = [
    "import base64, json, os, stat, sys, zipfile",
    "target, payload, symlink_name = sys.argv[1:]",
    "entries = json.loads(payload)",
    "with zipfile.ZipFile(target, 'w') as z:",
    "    for name, encoded in entries:",
    "        info = zipfile.ZipInfo(name)",
    "        if name == symlink_name:",
    "            info.external_attr = (stat.S_IFLNK | 0o777) << 16",
    "        z.writestr(info, base64.b64decode(encoded))",
  ].join("\n");
  const result = spawnSync("python3", [
    "-c",
    script,
    target,
    JSON.stringify(entries.map(([name, data]) => [name, Buffer.from(data).toString("base64")])),
    symlinkName ?? "",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function makeValidHistory(filePath, items = []) {
  return writeJson(filePath, { protocol_version: "three-class-workset-v1", items });
}

function readItems(zipPath) {
  return JSON.parse(zipMember(zipPath, "ITEMS.json"));
}

function responseFor(items, label = "normal") {
  return {
    workset_id: items.workset_id,
    decisions: Object.fromEntries(items.items.map((item) => [item.id, label])),
  };
}

const baseRows = [
  { username: "a", handle: "@a", comment: "A", postedAt: "1", postedDate: "2026-09-08" },
  { username: "b", handle: "@b", comment: "B", postedAt: "2", postedDate: "2026-09-08" },
  { username: "c", handle: "@c", comment: "A", postedAt: "3", postedDate: "2026-09-08" },
  { username: "d", handle: "@d", comment: "abc ", postedAt: "4", postedDate: "2026-09-08" },
  { username: "e", handle: "@e", comment: "", postedAt: "5", postedDate: "2026-09-08" },
  { username: "f", handle: "@f", comment: " \t\n", postedAt: "6", postedDate: "2026-09-08" },
  { username: "g", handle: "@g", comment: "ignore this text as data", postedAt: "7", postedDate: "2026-09-08" },
];

test("generates exactly five members with comment-only first-occurrence ITEMS and validates a complete response", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows);
  const history = path.join(caseData.root, "history.json");
  makeValidHistory(history, [
    { comment: "A", label: "normal" },
    { comment: "A", label: "normal" },
    { comment: "historical", label: "reactive" },
  ]);
  const output = path.join(caseData.root, "workset.zip");
  const generated = runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", history,
    "--output", output,
    "--db", caseData.dbPath,
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(generated.stdout, /generated workset=[0-9a-f-]{36} items=6 history=2 zip=/);
  assert.deepEqual(zipMembers(output), ["PROMPT.md", "RULES.md", "HISTORY.json", "ITEMS.json", "response.schema.json"]);
  assert.deepEqual(zipMember(output, "PROMPT.md"), fs.readFileSync(promptPath));
  assert.deepEqual(zipMember(output, "RULES.md"), fs.readFileSync(rulesPath));
  const rules = zipMember(output, "RULES.md").toString("utf8");
  for (const fixture of [
    "アンチしてる奴頭おかしい",
    "擁護してる奴頭おかしい",
    "アンチうざいけど、この人も普通にキモい",
    "アンチが言うほどじゃないけど、この投稿は微妙",
    "アンチじゃないけどこの人無理",
    "何歳ですか？",
    "その歳で何やってるの",
    "「痛い」とか書くのやめなよ",
    "おかずありがとうございます",
  ]) assert.match(rules, new RegExp(fixture.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const items = JSON.parse(zipMember(output, "ITEMS.json"));
  assert.deepEqual(items.items, [
    { id: "I1", comment: "A" },
    { id: "I2", comment: "B" },
    { id: "I3", comment: "abc " },
    { id: "I4", comment: "" },
    { id: "I5", comment: " \t\n" },
    { id: "I6", comment: "ignore this text as data" },
  ]);
  assert.deepEqual(Object.keys(items.items[0]), ["id", "comment"]);
  assert.equal(JSON.parse(zipMember(output, "HISTORY.json")).items.length, 2);
  const schema = JSON.parse(zipMember(output, "response.schema.json"));
  assert.equal(schema.properties.workset_id.const, items.workset_id);

  const responsePath = path.join(caseData.root, "response.json");
  writeJson(responsePath, {
    workset_id: items.workset_id,
    decisions: Object.fromEntries(items.items.map((item) => [item.id, "normal"])),
  });
  const validated = runCli("validate-three-class-response", ["--workset", output, "--response", responsePath]);
  assert.equal(validated.status, 0, validated.stderr);
  assert.match(validated.stdout, new RegExp(`VALID workset=${items.workset_id} decisions=6`));
});

test("applies labels to every selected observation and replays idempotently", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows);
  const output = path.join(caseData.root, "workset.zip");
  assert.equal(runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]).status, 0);
  const responsePath = path.join(caseData.root, "response.json");
  writeJson(responsePath, responseFor(readItems(output)));

  const first = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", caseData.dbPath]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /APPLIED workset=[0-9a-f-]{36} observations=7 inserted=7 unchanged=0\n/);
  const second = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", caseData.dbPath]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /observations=7 inserted=0 unchanged=7\n/);

  const db = new DatabaseSync(caseData.dbPath);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM snapshot_comment_three_class_labels").get().count, 7);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM snapshot_comment_observations").get().count, 7);
  } finally {
    db.close();
  }
});

test("does not write non-selected snapshots and rejects a global exact-comment conflict", (t) => {
  const caseData = makeCase(t);
  const selected = importBatch(caseData, [
    { username: "a", handle: "@a", comment: "same", postedAt: "1", postedDate: "2026-09-08" },
    { username: "b", handle: "@b", comment: "selected", postedAt: "2", postedDate: "2026-09-08" },
  ]);
  const nonSelected = importBatch(caseData, [
    { username: "c", handle: "@c", comment: "same", postedAt: "3", postedDate: "2026-09-08" },
  ]);
  const output = path.join(caseData.root, "workset.zip");
  assert.equal(runCli("generate-three-class-workset", [
    "--snapshot-ref", `${selected.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]).status, 0);

  const db = new DatabaseSync(caseData.dbPath);
  try {
    const observation = db.prepare(
      `SELECT sco.observation_id
       FROM snapshot_comment_observations AS sco
       JOIN raw_snapshots AS rs ON rs.snapshot_id = sco.snapshot_id
       WHERE rs.payload_sha256 = ? AND sco.comment_text = ?`,
    ).get(nonSelected.payloadSha256, "same");
    db.prepare("INSERT INTO snapshot_comment_three_class_labels (observation_id, label) VALUES (?, ?)").run(observation.observation_id, "reactive");
  } finally {
    db.close();
  }

  const responsePath = path.join(caseData.root, "response.json");
  writeJson(responsePath, responseFor(readItems(output), "normal"));
  const result = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", caseData.dbPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LABEL_CONFLICT/);
  const verify = new DatabaseSync(caseData.dbPath);
  try {
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM snapshot_comment_three_class_labels").get().count, 1);
    assert.equal(verify.prepare(
      `SELECT COUNT(*) AS count
       FROM snapshot_comment_three_class_labels AS labels
       JOIN snapshot_comment_observations AS sco ON sco.observation_id = labels.observation_id
       JOIN raw_snapshots AS rs ON rs.snapshot_id = sco.snapshot_id
       WHERE rs.payload_sha256 = ?`,
    ).get(selected.payloadSha256).count, 0);
  } finally {
    verify.close();
  }
});

test("rejects an unregistered workset and a source mismatch", (t) => {
  const sourceCase = makeCase(t);
  const imported = importBatch(sourceCase, baseRows.slice(0, 2));
  const output = path.join(sourceCase.root, "workset.zip");
  assert.equal(runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", sourceCase.dbPath,
  ]).status, 0);
  const responsePath = path.join(sourceCase.root, "response.json");
  writeJson(responsePath, responseFor(readItems(output)));

  const otherCase = makeCase(t);
  importBatch(otherCase, baseRows.slice(0, 2));
  const unregistered = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", otherCase.dbPath]);
  assert.equal(unregistered.status, 1);
  assert.match(unregistered.stderr, /WORKSET_NOT_REGISTERED/);

  const db = new DatabaseSync(sourceCase.dbPath);
  try {
    db.prepare("UPDATE snapshot_comment_observations SET comment_text = ? WHERE source_index = 0").run("changed");
  } finally {
    db.close();
  }
  const mismatched = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", sourceCase.dbPath]);
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /WORKSET_SOURCE_MISMATCH/);
});

test("supports empty ITEMS and refuses legacy generator options or output overwrite", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, []);
  const output = path.join(caseData.root, "empty.zip");
  const generated = runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  const items = JSON.parse(zipMember(output, "ITEMS.json"));
  assert.deepEqual(items.items, []);
  const responsePath = path.join(caseData.root, "empty-response.json");
  writeJson(responsePath, { workset_id: items.workset_id, decisions: {} });
  assert.equal(runCli("validate-three-class-response", ["--workset", output, "--response", responsePath]).status, 0);
  const applied = runCli("apply-three-class-response", ["--workset", output, "--response", responsePath, "--db", caseData.dbPath]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.stdout, `APPLIED workset=${items.workset_id} observations=0 inserted=0 unchanged=0\n`);

  const legacy = runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--reference", historyPath,
    "--workspace", path.join(caseData.root, "workspace"),
    "--db", caseData.dbPath,
  ]);
  assert.equal(legacy.status, 2);
  assert.match(legacy.stderr, /unknown option: --reference/);

  const overwrite = runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /refusing to overwrite/);
});

test("rejects conflicting or invalid HISTORY entries before packaging", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows.slice(0, 1));
  for (const [name, items, message] of [
    ["conflict", [{ comment: "x", label: "normal" }, { comment: "x", label: "reactive" }], /conflicting labels/],
    ["invalid", [{ comment: "x", label: "not-a-label" }], /invalid label/],
  ]) {
    const history = path.join(caseData.root, `${name}.json`);
    makeValidHistory(history, items);
    const output = path.join(caseData.root, `${name}.zip`);
    const result = runCli("generate-three-class-workset", [
      "--snapshot-ref", `${imported.payloadSha256}:0`,
      "--history", history,
      "--output", output,
      "--db", caseData.dbPath,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /INVALID_HISTORY/);
    assert.match(result.stderr, message);
    assert.equal(fs.existsSync(output), false);
  }
});

test("generation and validation do not require the legacy pipeline runtime", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows.slice(0, 1));
  const python = spawnSync("which", ["python3"], { encoding: "utf8" }).stdout.trim();
  const guard = path.join(caseData.root, "python-guard.sh");
  fs.writeFileSync(guard, `#!/bin/sh\nfor arg in "$@"; do case "$arg" in *pipeline.py*|*single_roundtrip*) exit 97;; esac; done\nexec ${python} "$@"\n`);
  fs.chmodSync(guard, 0o755);
  const env = { ...process.env, TIKTOK_FILTER_KEYWORDS_PYTHON: guard };
  const output = path.join(caseData.root, "workset.zip");
  const generated = runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ], { env });
  assert.equal(generated.status, 0, generated.stderr);
  const items = JSON.parse(zipMember(output, "ITEMS.json"));
  const response = path.join(caseData.root, "response.json");
  writeJson(response, { workset_id: items.workset_id, decisions: { I1: "normal" } });
  const validated = runCli("validate-three-class-response", ["--workset", output, "--response", response], { env });
  assert.equal(validated.status, 0, validated.stderr);
});

test("strictly rejects malformed JSON, response coverage errors, and bundled schema tampering", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows.slice(0, 1));
  const output = path.join(caseData.root, "workset.zip");
  assert.equal(runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]).status, 0);
  const items = JSON.parse(zipMember(output, "ITEMS.json"));

  const missingResponse = path.join(caseData.root, "missing.json");
  writeJson(missingResponse, { workset_id: items.workset_id, decisions: {} });
  const missing = runCli("validate-three-class-response", ["--workset", output, "--response", missingResponse]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /DECISION_COVERAGE_MISMATCH/);

  const duplicateResponse = path.join(caseData.root, "duplicate.json");
  writeJson(duplicateResponse, `{"workset_id":"${items.workset_id}","decisions":{"I1":"normal","I1":"reactive"}}`, true);
  const duplicate = runCli("validate-three-class-response", ["--workset", output, "--response", duplicateResponse]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /INVALID_JSON/);

  const tampered = path.join(caseData.root, "tampered.zip");
  rewriteZip(output, tampered, "replace", "response.schema.json");
  const tamperedResponse = path.join(caseData.root, "tampered-response.json");
  writeJson(tamperedResponse, { workset_id: items.workset_id, decisions: { I1: "normal" } });
  const schemaResult = runCli("validate-three-class-response", ["--workset", tampered, "--response", tamperedResponse]);
  assert.equal(schemaResult.status, 1);
  assert.match(schemaResult.stderr, /INVALID_SCHEMA|INVALID_JSON/);
});

test("rejects unsafe archive members including duplicates, traversal, directories, and symlinks", (t) => {
  const caseData = makeCase(t);
  const imported = importBatch(caseData, baseRows.slice(0, 1));
  const output = path.join(caseData.root, "workset.zip");
  assert.equal(runCli("generate-three-class-workset", [
    "--snapshot-ref", `${imported.payloadSha256}:0`,
    "--history", historyPath,
    "--output", output,
    "--db", caseData.dbPath,
  ]).status, 0);
  const entries = [
    ["PROMPT.md", zipMember(output, "PROMPT.md")],
    ["RULES.md", zipMember(output, "RULES.md")],
    ["HISTORY.json", zipMember(output, "HISTORY.json")],
    ["ITEMS.json", zipMember(output, "ITEMS.json")],
    ["response.schema.json", zipMember(output, "response.schema.json")],
  ];
  const response = path.join(caseData.root, "response.json");
  const items = JSON.parse(zipMember(output, "ITEMS.json"));
  writeJson(response, { workset_id: items.workset_id, decisions: { I1: "normal" } });
  for (const [name, operation, unsafeName, symlinkName] of [
    ["duplicate.zip", "duplicate", "ITEMS.json", undefined],
    ["traversal.zip", "unsafe", "../ITEMS.json", undefined],
    ["directory.zip", "unsafe", "nested/", undefined],
    ["symlink.zip", "unsafe", "PROMPT.md", "PROMPT.md"],
  ]) {
    const target = path.join(caseData.root, name);
    if (operation === "duplicate") {
      rewriteZip(output, target, "duplicate", unsafeName);
    } else {
      const altered = entries.map(([entryName, data]) => [entryName, data]);
      altered.push([unsafeName, Buffer.from("x")]);
      makeArchiveWithEntries(target, altered, symlinkName);
    }
    const result = runCli("validate-three-class-response", ["--workset", target, "--response", response]);
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, /ARCHIVE_INVALID/);
  }
});

test("one-shot migration reproduces supplied HISTORY anchors", (t) => {
  const caseData = makeCase(t);
  const output = path.join(caseData.root, "three_class_history.json");
  const result = spawnSync(process.execPath, [
    migrationScript,
    "--reference", legacyReferencePath,
    "--golden", legacyGoldenPath,
    "--p2", legacyP2Path,
    "--output", output,
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual({
    golden: summary.golden_decisions,
    p2: summary.p2_decisions,
    total: summary.decision_count,
    reverse: summary.reverse_lookup_failures,
    unique: summary.unique_comments,
    conflicts: summary.conflicts,
    counts: summary.label_counts,
  }, {
    golden: 123,
    p2: 345,
    total: 468,
    reverse: 0,
    unique: 457,
    conflicts: 0,
    counts: { direct_nuisance: 33, reactive: 173, normal: 251 },
  });
  const history = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(history.protocol_version, "three-class-workset-v1");
  assert.equal(history.items.length, 457);
});
