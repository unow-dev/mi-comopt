import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openCommentDatabaseReadOnly } from "../src/database/comment-database.js";
import {
  buildOptimicomUiRelease,
  validateOptimicomUiArtifactBytes,
  validateOptimicomUiReleaseManifest,
} from "../src/processing/optimicom-ui-release/release.js";
import { publishOptimicomUiReleaseArtifacts } from "../scripts/export-optimicom-ui-release.mjs";
import { verifyDeployedOptimicomUiRelease } from "../scripts/verify-deployed-optimicom-ui-release.mjs";
import { serializeJson } from "../src/processing/account-block-candidates/account-block-candidate-workflow.js";
import { contentSha256 } from "../src/processing/keyword-candidates/candidate-workflow.js";

const keywordPolicyPath = path.resolve("contracts/keyword-candidates/evaluation-policy-1.0.0.json");
const accountPolicyPath = path.resolve("contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json");
const keywordPolicy = JSON.parse(fs.readFileSync(keywordPolicyPath, "utf8"));
const accountPolicyBytes = fs.readFileSync(accountPolicyPath);
const accountPolicy = JSON.parse(accountPolicyBytes.toString("utf8"));

function sourceRecords(extra = []) {
  return [
    { source_index: 0, username: "a", handle: "alice", comment: "one", postedAt: "2026-09-10T00:00:00Z", postedDate: "2026-09-10", label: "direct_nuisance" },
    { source_index: 1, username: "a", handle: "alice", comment: "two", postedAt: "2026-09-12T00:00:00Z", postedDate: "2026-09-12", label: "direct_nuisance" },
    ...extra.map((record, index) => { const { source_index: _ignored, ...rest } = record; return { source_index: index + 2, ...rest }; }),
  ];
}

function fixtureInputs(records = sourceRecords()) {
  const sourceDataset = { schema_version: 1, labeling_status: "published", snapshot_ref: { payload_sha256: "b".repeat(64), snapshot_index: 0 }, records };
  const sourceDatasetBytes = Buffer.from(serializeJson(sourceDataset), "utf8");
  const keywords = [{ candidate_id: "kw_123", keyword: "promo", variants: ["promo"], category_id: "link_spam", category: "リンクスパム", recommendation: "任意", match_type: "normalized_substring", direct_nuisance_hits: 1, reactive_hits: 0, normal_hits: 0, precision_excluding_reactive: 1, direct_recall_contribution: 0.1, normal_hit_rate: 0, utility_score: 1, introduced_at: null }];
  const keywordBytes = Buffer.from(JSON.stringify(keywords), "utf8");
  const currentMeta = { schema_version: 1, run_id: "run_123e4567-e89b-42d3-a456-426614174000", published_at: "2026-09-12T00:00:00Z", applied_at: "2026-09-12T00:00:01Z", candidates_content_sha256: contentSha256(keywords), evaluation_policy_version: keywordPolicy.policy_version, evaluation_policy_content_sha256: contentSha256(keywordPolicy) };
  return { sourceDataset, sourceDatasetBytes, keywords, keywordBytes, currentMeta, publication: { run_id: currentMeta.run_id, published_at: currentMeta.published_at, applied_at: currentMeta.applied_at, source_dataset_artifact_sha256: `sha256:${crypto.createHash("sha256").update(sourceDatasetBytes).digest("hex")}` }, accountPolicy, accountPolicyBytes, keywordPolicy, generatedAt: "2026-09-13T00:00:00Z" };
}

function buildFixture(records = sourceRecords()) {
  return buildOptimicomUiRelease(fixtureInputs(records));
}

test("UI database reader requires schema v8 and prevents writes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimicom-ui-readonly-test-"));
  const v7Path = path.join(root, "v7.sqlite3");
  const v7 = new DatabaseSync(v7Path);
  v7.exec("PRAGMA user_version = 7");
  v7.close();
  await assert.rejects(() => openCommentDatabaseReadOnly(v7Path), /SCHEMA_VERSION_REQUIRED/);

  const v8Path = path.join(root, "v8.sqlite3");
  const v8 = new DatabaseSync(v8Path);
  v8.exec("PRAGMA user_version = 8");
  v8.close();
  const db = await openCommentDatabaseReadOnly(v8Path);
  assert.equal(Number(db.prepare("PRAGMA query_only").get().query_only), 1);
  assert.throws(() => db.exec("CREATE TABLE forbidden_write (value TEXT)"), /readonly|query.only/i);
  db.close();
});

test("UI release artifacts preserve source bytes, overview gaps, and policy-derived accounts", () => {
  const release = buildFixture();
  validateOptimicomUiReleaseManifest(release.manifest);
  validateOptimicomUiArtifactBytes(release.manifest, release.dataArtifacts);
  assert.equal(release.manifest.artifacts.comments.record_count, 2);
  assert.equal(release.manifest.artifacts.overview.record_count, 30);
  assert.equal(release.manifest.artifacts.accounts.record_count, 1);
  const overview = JSON.parse(release.dataArtifacts.overview.toString("utf8"));
  assert.equal(overview.daily[28].observation_count, null);
  assert.equal(overview.periods["30d"].coverage, "partial");
});

test("account artifact count follows generated candidates rather than a fixed product count", () => {
  const release = buildFixture(sourceRecords([
    { username: "b", handle: "bob", comment: "three", postedAt: "2026-09-12T00:00:00Z", postedDate: "2026-09-12", label: "direct_nuisance" },
    { username: "b", handle: "bob", comment: "four", postedAt: "2026-09-13T00:00:00Z", postedDate: "2026-09-13", label: "direct_nuisance" },
  ]));
  assert.equal(release.manifest.artifacts.accounts.record_count, 2);
});

test("source SHA mismatch fails closed before publication data is accepted", () => {
  const inputs = fixtureInputs();
  inputs.publication = { ...inputs.publication, source_dataset_artifact_sha256: `sha256:${"f".repeat(64)}` };
  assert.throws(() => buildOptimicomUiRelease(inputs), /source dataset SHA/);
});

test("manifest-last publication leaves the active release unchanged on staging failure", () => {
  const release = buildFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimicom-ui-release-test-"));
  const releasePath = path.join(root, "optimicom-ui-release.json");
  fs.writeFileSync(releasePath, "old release", "utf8");
  assert.throws(() => publishOptimicomUiReleaseArtifacts(root, release, { beforeArtifactPublish: () => { throw new Error("injected failure"); } }), /injected failure/);
  assert.equal(fs.readFileSync(releasePath, "utf8"), "old release");
  publishOptimicomUiReleaseArtifacts(root, release);
  assert.equal(validateOptimicomUiReleaseManifest(JSON.parse(fs.readFileSync(releasePath, "utf8"))).schema_version, 1);
});

test("deployed verifier fetches the release root and all four artifacts", async () => {
  const release = buildFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimicom-ui-deployed-test-"));
  publishOptimicomUiReleaseArtifacts(root, release);
  const fetchImpl = async (url) => {
    const relative = new URL(url).pathname.replace(/^\//, "");
    const file = path.join(root, relative === "optimicom-ui-release.json" ? relative : relative);
    return new Response(fs.readFileSync(file), { status: 200 });
  };
  const result = await verifyDeployedOptimicomUiRelease({ url: "https://example.test/", expected: path.join(root, "optimicom-ui-release.json"), fetchImpl });
  assert.equal(result.status, "verified");
});
