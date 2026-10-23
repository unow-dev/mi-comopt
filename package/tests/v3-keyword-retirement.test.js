import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adaptCommentBatchBytes } from "../src/collector/comment-batch/comment-batch-adapter.js";
import { importRawInputIntoDatabase, openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { STREAM_KEYS, typedClassificationHandler } from "../src/application/services.js";
import { createV3OperationContext } from "../src/application/v3/context.js";
import { ReleaseApplicationServiceV3 } from "../src/application/v3/release-services.js";
import { createV3ApplicationServiceAgentAdapter } from "../src/integration/task-handlers-v3.js";
import { buildDbBackedUiRelease } from "../src/integration/v3-ui-release-builder.js";
import { buildCandidateView, contentSha256, evaluateCandidates, buildPublishedCandidates } from "../src/processing/keyword-candidates/candidate-workflow.js";
import { prefixedSha256 } from "../src/state/canonical.js";

const RETIRE_ID = "kw_123e4567-e89b-42d3-a456-426614174000";
const UPDATE_ID = "kw_223e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "cgr_123e4567-e89b-42d3-a456-426614174000";
const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const PERMISSIONS = ["state:read", "state:propose", "state:auto-decide", "state:commit"];

function seed(controlPlane, stream, versionId, state) {
  const record = controlPlane.ensureStream(stream);
  return controlPlane.createGenesis({ streamId: record.stream_id, versionId, payload: { schema_version: 1, state } });
}

function context(sessionId, stepId) {
  return createV3OperationContext({ sessionId, stepId, permissions: PERMISSIONS });
}

function handoffBytes(view, { corruptViewHash = false } = {}) {
  const request = { request_id: REQUEST_ID, input_fingerprint: FINGERPRINT };
  const files = {
    "candidate_generation_request.json": JSON.stringify(request),
    "candidate_view.json": JSON.stringify(view),
  };
  files["handoff_manifest.json"] = JSON.stringify({
    schema_version: 1,
    request_id: REQUEST_ID,
    input_fingerprint: FINGERPRINT,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, prefixedSha256(Buffer.from(bytes))])),
  });
  if (corruptViewHash) files["candidate_view.json"] = JSON.stringify({ ...view, candidates: [] });
  const zipped = spawnSync("python3", ["-c", `
import io, json, sys, zipfile
output = io.BytesIO()
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in json.load(sys.stdin).items():
        archive.writestr(name, content)
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(files) });
  assert.equal(zipped.status, 0, zipped.stderr.toString());
  return zipped.stdout;
}

async function fixture(options = {}) {
  const db = await openCommentDatabase(":memory:", { stateControlPlane: true });
  const controlPlane = new StateControlPlane(db);
  const root = await mkdtemp(path.join(tmpdir(), "v3-keyword-retirement-"));
  const policy = JSON.parse(await readFile(new URL("../contracts/keyword-candidates/evaluation-policy-1.0.0.json", import.meta.url), "utf8"));
  const taxonomy = JSON.parse(await readFile(new URL("../contracts/keyword-candidates/taxonomy-1.0.0.json", import.meta.url), "utf8"));
  const accountPolicy = JSON.parse(await readFile(new URL("../contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json", import.meta.url), "utf8"));
  const registry = {
    schema_version: 1,
    candidates: Object.fromEntries([[RETIRE_ID, "obsolete"], [UPDATE_ID, "keep"]].map(([id, keyword]) => [id, {
      status: "active", keyword, variants: [keyword], category_id: "hate_mockery",
      created_at: "2026-10-01T00:00:00Z", last_changed_at: "2026-10-01T00:00:00Z",
      first_publication_state: "published_at_unknown", introduced_at: null,
    }])),
  };
  await mkdir(path.join(root, "current"));
  await writeFile(path.join(root, "current", "candidate_registry.json"), JSON.stringify(registry));
  const rows = ["obsolete keep fresh", "obsolete keep fresh", "ordinary"].map((comment, index) => ({ username: `u${index}`, handle: `h${index}`, comment, postedAt: "2026-10-13", postedDate: "2026-10-13" }));
  const imported = importRawInputIntoDatabase(db, adaptCommentBatchBytes(Buffer.from(JSON.stringify(rows))));
  seed(controlPlane, STREAM_KEYS.corpus, "corpus-0", { schema_version: 2, snapshot_refs: [{ payloadSha256: imported.payloadSha256, snapshotIndex: 0 }] });
  const labels = db.prepare("SELECT observation_id FROM snapshot_comment_observations ORDER BY source_index").all().map((row, index) => ({ observationId: String(row.observation_id), label: index === 2 ? "normal" : "direct_nuisance" }));
  const classification = { schema_version: 2, labels };
  seed(controlPlane, STREAM_KEYS.classification, "classification-0", classification);
  typedClassificationHandler().persist({ db, versionId: "classification-0", proposal: { payload: { state: classification } } });
  seed(controlPlane, STREAM_KEYS.keywordSelection, "keyword-0", { entries: [] });
  for (const [stream, versionId, policyKind] of [
    [STREAM_KEYS.corpusPolicy, "corpus-policy-0", "corpus"],
    [STREAM_KEYS.classificationPolicy, "classification-policy-0", "classification"],
    [STREAM_KEYS.keywordPolicy, "keyword-policy-0", "keyword-selection"],
    [STREAM_KEYS.projectionDefinition, "projection-0", "projection-definition"],
  ]) seed(controlPlane, stream, versionId, { policy_kind: policyKind, auto_commit: true });
  seed(controlPlane, STREAM_KEYS.accountPolicy, "account-policy-0", { ...accountPolicy, policy_kind: "account-candidate" });
  const blobs = new Map();
  const artifactStore = {
    read(hash) { return blobs.get(hash); },
    write({ artifactVersionId, logicalPath, content }) {
      const bytes = Buffer.from(content);
      const blobHash = prefixedSha256(bytes).slice(7);
      blobs.set(blobHash, bytes);
      return { artifactVersionId, logicalPath, blobHash, size: bytes.length };
    },
  };
  const artifact = artifactStore.write({ artifactVersionId: "handoff", logicalPath: "keyword-candidate-handoff.zip", content: handoffBytes(buildCandidateView(registry), options) });
  const preparation = { refs: { candidateRequestId: REQUEST_ID, candidateInputFingerprint: FINGERPRINT }, details: { artifact, handoffContextFingerprint: "context" } };
  const actions = [
    { action: "add", keyword: "fresh", variants: ["fresh"], category_id: "hate_mockery" },
    { action: "update", candidate_id: UPDATE_ID, keyword: "keep", variants: ["keep", "kept"], category_id: "hate_mockery" },
    { action: "retire", candidate_id: RETIRE_ID },
  ];
  const proposal = { schema_version: 1, request_id: REQUEST_ID, input_fingerprint: FINGERPRINT, actions };
  const adapter = createV3ApplicationServiceAgentAdapter({ controlPlane, artifactStore });
  const input = { keywordSelectionVersionId: "keyword-0", corpusVersionId: "corpus-0", classificationVersionId: "classification-0", keywordPolicyVersionId: "keyword-policy-0", handoffPreparation: preparation };
  return {
    db, controlPlane, root, adapter, artifactStore, input, proposal, registry, policy, taxonomy, rows, labels,
    async assess(sessionId, value = proposal) {
      const submitted = artifactStore.write({ artifactVersionId: `proposal:${sessionId}`, logicalPath: "candidate_proposal.json", content: JSON.stringify(value) });
      return adapter.run({ session: { sessionId, workDefinitionId: "comment-data-update", definitionRevision: 3 }, task: { stepId: "07-update-keyword-selection", contract: { requiredCapabilities: ["keyword-selection.assess"] }, inputs: { ...input, proposal: { result: { artifact: submitted } } } }, grant: { permissions: PERMISSIONS } });
    },
    async close() { controlPlane.close(); await rm(root, { recursive: true, force: true }); },
  };
}

test("v3 preserves add, update and keyword-less retire through assessment, commit and UI publication", async () => {
  const f = await fixture();
  try {
    const assessed = await f.assess("retirement");
    assert.equal(assessed.status, "succeeded");
    assert.equal(assessed.outcome, "review_required");
    const proposal = f.controlPlane.readProposal(assessed.result.refs.proposalId);
    assert.equal(proposal.payload.state.entries.length, 3);
    const retire = proposal.payload.state.entries.find(entry => entry.action === "retire");
    assert.deepEqual(retire, { action: "retire", candidate_id: RETIRE_ID, keyword: "obsolete", selection_state: "retired" });
    const finalized = f.adapter.taskHandlers.services.keyword.finalize(context("retirement", "10-finalize-keyword-selection"), {
      proposalId: proposal.proposalId, assessed: assessed.result,
      review: { outcome: "accept", actor: { actorType: "human", actorId: "reviewer" }, rationale: "regression test" },
    });
    assert.equal(finalized.stateResult, "committed");
    const versionId = finalized.refs.keywordSelectionVersionId;
    const persisted = f.db.prepare("SELECT selection_state FROM keyword_selection_entries WHERE version_id=? AND keyword='obsolete'").get(versionId);
    assert.equal(persisted.selection_state, "retired");
    const release = new ReleaseApplicationServiceV3(f.controlPlane).build(context("retirement", "11-build-release-bundle"), {
      corpusVersionId: "corpus-0", classificationVersionId: "classification-0", keywordSelectionVersionId: versionId,
      corpusPolicyVersionId: "corpus-policy-0", classificationPolicyVersionId: "classification-policy-0",
      keywordPolicyVersionId: "keyword-policy-0", accountPolicyVersionId: "account-policy-0", projectionDefinitionVersionId: "projection-0",
    });
    const baselineEvaluation = evaluateCandidates({ registry: f.registry, dataset: f.rows.map((row, index) => ({ ...row, label: f.labels[index].label })), policy: f.policy, taxonomy: f.taxonomy, artifactSha256: contentSha256(f.rows) });
    const baselineKeywords = buildPublishedCandidates({ registry: f.registry, evaluation: baselineEvaluation, taxonomy: f.taxonomy });
    assert.ok(baselineKeywords.some(candidate => candidate.keyword === "obsolete"));
    const built = buildDbBackedUiRelease({ controlPlane: f.controlPlane, releaseId: release.refs.releaseId, publicationRoot: f.root });
    const keywords = JSON.parse(built.artifacts[built.manifest.artifacts.keywords.path]);
    assert.equal(keywords.some(candidate => candidate.keyword === "obsolete"), false);
    assert.ok(keywords.some(candidate => candidate.keyword === "keep"));
    assert.ok(keywords.some(candidate => candidate.keyword === "fresh"));
  } finally { await f.close(); }
});

test("v3 retire assessment rejects an unknown target and mismatched handoff identity without creating a proposal", async () => {
  const f = await fixture();
  try {
    const unknown = await f.assess("unknown-retirement", { ...f.proposal, actions: [{ action: "retire", candidate_id: "kw_323e4567-e89b-42d3-a456-426614174000" }] });
    assert.equal(unknown.status, "failed");
    assert.equal(unknown.failure.code, "HANDOFF_IDENTITY_MISMATCH");
    const mismatched = await f.assess("mismatched-retirement", { ...f.proposal, input_fingerprint: `sha256:${"b".repeat(64)}` });
    assert.equal(mismatched.status, "failed");
    assert.equal(mismatched.failure.code, "HANDOFF_IDENTITY_MISMATCH");
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM state_proposals").get().count, 0);
  } finally { await f.close(); }
});

test("v3 retire assessment rejects candidate-view bytes that differ from the handoff manifest", async () => {
  const f = await fixture({ corruptViewHash: true });
  try {
    const result = await f.assess("corrupt-retirement");
    assert.equal(result.status, "failed");
    assert.equal(result.failure.code, "HANDOFF_IDENTITY_MISMATCH");
    assert.equal(f.controlPlane.readReceipt("corrupt-retirement/07-update-keyword-selection"), null);
  } finally { await f.close(); }
});

test("corrected v3 assessment uses a new operation while retaining the incomplete receipt and proposal", async () => {
  const f = await fixture();
  try {
    const incompleteInput = { ...f.input, proposal: f.proposal, proposedState: { schema_version: 1, entries: f.proposal.actions.slice(0, 2).map(action => ({ ...action, selection_state: "selected" })) } };
    const incomplete = f.adapter.taskHandlers.services.keyword.assess(context("old-retirement", "07-update-keyword-selection"), incompleteInput);
    const oldReceipt = f.controlPlane.readReceipt("old-retirement/07-update-keyword-selection");
    const replay = await f.assess("old-retirement");
    assert.equal(replay.status, "failed");
    assert.equal(replay.failure.code, "IDEMPOTENCY_CONFLICT");
    const corrected = await f.assess("corrected-retirement");
    assert.equal(corrected.status, "succeeded");
    assert.notEqual(corrected.result.refs.proposalId, incomplete.refs.proposalId);
    assert.equal(f.controlPlane.readProposal(corrected.result.refs.proposalId).payload.state.entries.length, 3);
    assert.equal(f.controlPlane.readProposal(incomplete.refs.proposalId).payload.state.entries.length, 2);
    assert.deepEqual(f.controlPlane.readReceipt("old-retirement/07-update-keyword-selection"), oldReceipt);
    assert.equal(f.controlPlane.resolveHead(STREAM_KEYS.keywordSelection).versionId, "keyword-0");
  } finally { await f.close(); }
});
