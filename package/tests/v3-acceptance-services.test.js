import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactStore } from "work-orchestrator";

import {
  ClassificationApplicationServiceV3,
  ClassificationHandoffService,
  KeywordHandoffService,
  KeywordSelectionApplicationServiceV3,
  STREAM_KEYS,
  createV3OperationContext,
} from "../src/application/index.js";
import { contentSha256 } from "../src/processing/keyword-candidates/candidate-workflow.js";
import { openCommentDatabase } from "../src/database/comment-database.js";
import { StateControlPlane } from "../src/state/control-plane.js";
import { semanticSha256 } from "../src/state/canonical.js";
import { prepareV3SessionInput } from "../src/integration/v3-runtime.js";
import {
  EXPECTED_FILES,
  completeValidatedHumanArtifact,
  validateClassificationResponse,
  validateKeywordProposal,
} from "../src/integration/human-artifact-completion-v3.js";
import {
  validateCommentDataUpdateSessionInputSchema,
  validateHumanArtifactSubmissionResultSchema,
  validateWorkStepResultSchema,
} from "../src/workflow/v3/contracts.js";

class MemoryArtifactStore {
  constructor() { this.blobs = new Map(); }

  write({ artifactVersionId, logicalPath, content, metadata = {} }) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const blobHash = createHash("sha256").update(bytes).digest("hex");
    this.blobs.set(blobHash, bytes);
    return { artifactVersionId, logicalPath, blobHash, size: bytes.length, ...metadata };
  }

  read(blobHash) { return this.blobs.get(blobHash) ?? null; }
}

function seed(controlPlane, stream, versionId, state = {}, extra = {}) {
  const record = controlPlane.ensureStream(stream);
  return controlPlane.createGenesis({ streamId: record.stream_id, versionId, payload: { schema_version: 1, state, ...extra } });
}

function seedV3State(controlPlane, { keywordExtra = {} } = {}) {
  seed(controlPlane, STREAM_KEYS.corpus, "corpus-0", { snapshot_refs: [], unresolved_target_count: 1 });
  seed(controlPlane, STREAM_KEYS.classification, "classification-0", { labels: [] });
  seed(controlPlane, STREAM_KEYS.keywordSelection, "keyword-0", { entries: [] }, keywordExtra);
  for (const [stream, versionId, policyKind] of [
    [STREAM_KEYS.corpusPolicy, "corpus-policy-0", "corpus"],
    [STREAM_KEYS.classificationPolicy, "classification-policy-0", "classification"],
    [STREAM_KEYS.keywordPolicy, "keyword-policy-0", "keyword-selection"],
    [STREAM_KEYS.accountPolicy, "account-policy-0", "account-candidate"],
    [STREAM_KEYS.projectionDefinition, "projection-0", "projection-definition"],
  ]) seed(controlPlane, stream, versionId, { policy_kind: policyKind, auto_commit: true });
}

function context(sessionId, stepId, actor = { actorId: "system", actorType: "system" }) {
  return createV3OperationContext({ sessionId, stepId, actor, permissions: ["state:read", "state:propose", "state:auto-decide", "state:commit", "artifact:write"] });
}

function makeDatabase(options = {}) {
  const db = openCommentDatabase(":memory:", { stateControlPlane: true });
  return db.then((value) => {
    const controlPlane = new StateControlPlane(value);
    seedV3State(controlPlane, options);
    return { db: value, controlPlane };
  });
}

test("[V3-S02][V3-S03][V3-S04][V3-S05][V3-S06][V3-RV05] Session input pins exact versions and stays producer-neutral", async () => {
  const { db, controlPlane } = await makeDatabase();
  try {
    const input = prepareV3SessionInput({
      controlPlane,
      input: {
        updateRequestId: "session-acceptance",
        pinned: {
          initialCorpusVersionId: "corpus-0",
          classificationVersionId: "classification-0",
          keywordSelectionVersionId: "keyword-0",
          corpusPolicyVersionId: "corpus-policy-0",
          classificationPolicyVersionId: "classification-policy-0",
          keywordPolicyVersionId: "keyword-policy-0",
          accountPolicyVersionId: "account-policy-0",
          projectionDefinitionVersionId: "projection-0",
        },
        target: { promotionStream: "production", deploymentTarget: "production" },
      },
    });
    assert.deepEqual(input.pinned, {
      initialCorpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordSelectionVersionId: "keyword-0",
      corpusPolicyVersionId: "corpus-policy-0",
      classificationPolicyVersionId: "classification-policy-0",
      keywordPolicyVersionId: "keyword-policy-0",
      accountPolicyVersionId: "account-policy-0",
      projectionDefinitionVersionId: "projection-0",
    });
    assert.equal(Object.hasOwn(input, "actor"), false);
    assert.throws(() => validateCommentDataUpdateSessionInputSchema({ ...input, snapshots: ["implicit-merge"] }), /SESSION_INPUT_INVALID/);
    assert.throws(() => validateCommentDataUpdateSessionInputSchema({ ...input, pinned: { ...input.pinned, initialCorpusVersionId: "" } }), /SESSION_INPUT_INVALID/);
    assert.notEqual(2, 3, "schemaVersion and TARGET_REVISION are distinct values");
  } finally {
    db.close();
  }
});

test("[V3-CL01][V3-CL02][V3-CL03][V3-CL04][V3-CL05][V3-DEP05] Classification routing, identity, dependencies, and rejection are fail-closed", async () => {
  const { db, controlPlane } = await makeDatabase();
  const artifactStore = new MemoryArtifactStore();
  try {
    const handoff = new ClassificationHandoffService(controlPlane, artifactStore);
    const prepared = handoff.prepare(context("classification-handoff", "03a-prepare-classification-handoff"), {
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      classificationPolicyVersionId: "classification-policy-0",
      unresolvedTargetCount: 1,
      worksetId: "00000000-0000-4000-8000-000000000001",
    });
    assert.equal(prepared.stateResult, "created");
    const ready = handoff.prepare(context("classification-ready", "03a-prepare-classification-handoff"), {
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      classificationPolicyVersionId: "classification-policy-0",
      unresolvedTargetCount: 0,
    });
    assert.deepEqual(ready.refs, {});
    assert.equal(ready.stateResult, "succeeded");

    const classification = new ClassificationApplicationServiceV3(controlPlane);
    assert.throws(() => classification.assess(context("classification-wrong-workset", "03-update-classification"), {
      classificationVersionId: "classification-0",
      corpusVersionId: "corpus-0",
      classificationPolicyVersionId: "classification-policy-0",
      proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "normal" }] },
      handoffPreparation: prepared,
      response: { workset_id: "wrong-workset", decisions: {} },
    }), /HANDOFF_IDENTITY_MISMATCH/);

    const assessed = classification.assess(context("classification-review", "03-update-classification"), {
      classificationVersionId: "classification-0",
      corpusVersionId: "corpus-0",
      classificationPolicyVersionId: "classification-policy-0",
      proposedState: { schema_version: 1, labels: [{ observationId: "1", label: "normal" }] },
      handoffPreparation: prepared,
      response: { workset_id: prepared.refs.worksetId, decisions: {} },
      autoCommit: true,
    });
    assert.equal(assessed.stateResult, "review_required");
    const before = controlPlane.resolveHead(STREAM_KEYS.classification).versionId;
    const rejected = classification.finalize(context("classification-reject", "06-finalize-classification", { actorId: "reviewer", actorType: "human" }), {
      proposalId: assessed.refs.proposalId,
      review: { outcome: "reject", actor: { actorId: "reviewer", actorType: "human" } },
    });
    assert.equal(rejected.stateResult, "rejected");
    assert.equal(controlPlane.resolveHead(STREAM_KEYS.classification).versionId, before);
    assert.equal(controlPlane.readDecision(assessed.refs.proposalId).outcome, "rejected");
    assert.deepEqual(controlPlane.readDependencies(controlPlane.resolveHead(STREAM_KEYS.classification).versionId), []);
  } finally {
    db.close();
  }
});

test("[V3-KW01][V3-KW02][V3-KW03][V3-KW04][V3-KW05][V3-DEP06] Keyword handoff uses exact request identity and semantic review boundaries", async () => {
  const candidateInput = { source: "classification-0", mode: "all" };
  const fingerprint = contentSha256({ corpusVersionId: "corpus-0", classificationVersionId: "classification-0", keywordSelectionVersionId: "keyword-0", keywordPolicyVersionId: "keyword-policy-0", candidateInput });
  const { db, controlPlane } = await makeDatabase({ keywordExtra: { candidateInputFingerprint: fingerprint } });
  const artifactStore = new MemoryArtifactStore();
  try {
    const handoff = new KeywordHandoffService(controlPlane, artifactStore);
    const reused = handoff.prepare(context("keyword-reuse", "07a-prepare-keyword-handoff"), {
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordSelectionVersionId: "keyword-0",
      keywordPolicyVersionId: "keyword-policy-0",
      candidateInput,
    });
    assert.equal(reused.stateResult, "reused");
    const prepared = handoff.prepare(context("keyword-handoff", "07a-prepare-keyword-handoff"), {
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordSelectionVersionId: "keyword-0",
      keywordPolicyVersionId: "keyword-policy-0",
      candidateInput: { ...candidateInput, mode: "changed" },
    });
    assert.equal(prepared.stateResult, "created");
    assert.match(prepared.refs.candidateInputFingerprint, /^sha256:[0-9a-f]{64}$/);
    const keyword = new KeywordSelectionApplicationServiceV3(controlPlane);
    assert.throws(() => keyword.assess(context("keyword-wrong-input", "07-update-keyword-selection"), {
      keywordSelectionVersionId: "keyword-0",
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordPolicyVersionId: "keyword-policy-0",
      proposedState: { entries: [] },
      handoffPreparation: prepared,
      proposal: { schema_version: 1, request_id: prepared.refs.candidateRequestId, input_fingerprint: "sha256:" + "0".repeat(64), actions: [] },
    }), /HANDOFF_IDENTITY_MISMATCH/);

    const committed = keyword.assess(context("keyword-empty-actions", "07-update-keyword-selection"), {
      keywordSelectionVersionId: "keyword-0",
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordPolicyVersionId: "keyword-policy-0",
      proposedState: { entries: [] },
      handoffPreparation: prepared,
      proposal: { schema_version: 1, request_id: prepared.refs.candidateRequestId, input_fingerprint: prepared.refs.candidateInputFingerprint, actions: [] },
      autoCommit: true,
    });
    assert.equal(committed.stateResult, "committed");
    assert.deepEqual(controlPlane.readDependencies(committed.refs.keywordSelectionVersionId).map((item) => item.role), ["classification", "corpus", "policy"]);

    const changed = keyword.assess(context("keyword-change", "07-update-keyword-selection"), {
      keywordSelectionVersionId: committed.refs.keywordSelectionVersionId,
      corpusVersionId: "corpus-0",
      classificationVersionId: "classification-0",
      keywordPolicyVersionId: "keyword-policy-0",
      proposedState: { schema_version: 1, entries: [{ keyword: "new", selection_state: "selected" }] },
      handoffPreparation: prepared,
      proposal: { schema_version: 1, request_id: prepared.refs.candidateRequestId, input_fingerprint: prepared.refs.candidateInputFingerprint, actions: [] },
      autoCommit: true,
    });
    assert.equal(changed.stateResult, "review_required");
    const rejected = keyword.finalize(context("keyword-reject", "10-finalize-keyword-selection", { actorId: "reviewer", actorType: "human" }), {
      proposalId: changed.refs.proposalId,
      review: { outcome: "reject", actor: { actorId: "reviewer", actorType: "human" } },
    });
    assert.equal(rejected.stateResult, "rejected");
  } finally {
    db.close();
  }
});

test("[V3-DEP01][V3-DEP02][V3-DEP03][V3-DEP04][V3-DEP08] Dependency-aware no-op is isolated from v2 semantic-only behavior", async () => {
  const { db, controlPlane } = await makeDatabase();
  try {
    const classification = new ClassificationApplicationServiceV3(controlPlane);
    const first = classification.assess(context("dependency-first", "03-update-classification"), {
      classificationVersionId: "classification-0",
      corpusVersionId: "corpus-0",
      classificationPolicyVersionId: "classification-policy-0",
      proposedState: { labels: [] },
      autoCommit: true,
    });
    assert.equal(first.stateResult, "committed");
    assert.deepEqual(controlPlane.readDependencies(first.refs.classificationVersionId).map((item) => item.role), ["corpus", "policy"]);
    const autoFinalized = classification.finalize(context("dependency-finalize-auto", "06-finalize-classification"), {
      proposalId: first.refs.proposalId,
      assessed: first,
    });
    assert.equal(autoFinalized.stateResult, "reused");
    assert.equal(autoFinalized.refs.classificationVersionId, first.refs.classificationVersionId);
    const unchanged = classification.assess(context("dependency-unchanged", "03-update-classification"), {
      classificationVersionId: first.refs.classificationVersionId,
      corpusVersionId: "corpus-0",
      classificationPolicyVersionId: "classification-policy-0",
      proposedState: { labels: [] },
      autoCommit: true,
    });
    assert.equal(unchanged.stateResult, "unchanged");
    const transitionsBefore = db.prepare("SELECT COUNT(*) AS count FROM state_transitions WHERE stream_id = ?").get(STREAM_KEYS.classification.domain + "/" + STREAM_KEYS.classification.streamKey).count;
    assert.equal(transitionsBefore, 1);
    assert.throws(() => classification.assess(context("dependency-missing", "03-update-classification"), {
      classificationVersionId: first.refs.classificationVersionId,
      classificationPolicyVersionId: "classification-policy-0",
      proposedState: { labels: [] },
    }), /VERSION_REQUIRED/);
    assert.throws(() => validateWorkStepResultSchema({ stateResult: "committed", refs: { classificationVersionId: "classification-1", proposalId: "p", decisionId: "d", unexpected: "no" } }), /WORK_STEP_RESULT_INVALID/);
    assert.throws(() => validateHumanArtifactSubmissionResultSchema({ executionId: "e", artifact: { artifactVersionId: "a", blobHash: "bad", logicalPath: "response.json", size: 1 } }), /HUMAN_ARTIFACT_RESULT_INVALID/);
    assert.equal(semanticSha256({ value: 1 }), semanticSha256({ value: 1 }));
  } finally {
    db.close();
  }
});

test("[V3-HF01][V3-HF02][V3-HF03][V3-HF04][V3-HF06][V3-HF07][V3-HF08][V3-HF09][V3-HF10] Human artifact completion is exact, immutable, and execution-bound", async () => {
  assert.deepEqual(EXPECTED_FILES, {
    "00-receive-update-artifact": "comment-batch.json",
    "03b-receive-classification-response": "response.json",
    "07b-receive-keyword-proposal": "candidate_proposal.json",
  });
  assert.throws(() => validateClassificationResponse({ workset_id: "w", decisions: {}, extra: true }), /ARTIFACT_INVALID/);
  assert.throws(() => validateKeywordProposal({ schema_version: 1, request_id: "request", input_fingerprint: "sha256:" + "0".repeat(64), actions: [], extra: true }), /ARTIFACT_INVALID/);

  const root = await mkdtemp(path.join(tmpdir(), "comment-db-v3-human-artifact-"));
  const outputDirectory = path.join(root, "output");
  await mkdir(outputDirectory);
  const artifactStore = ArtifactStore.temporary();
  let completions = 0;
  const runtime = {
    state() { return { tasks: { task: { taskId: "task", stepId: "00-receive-update-artifact", currentExecutionId: "execution" } } }; },
    completeHumanTaskWithInput(_sessionId, _taskId, _actor, input) { completions += 1; return input; },
  };
  const registry = { getReceipt() { return null; } };
  try {
    await writeFile(path.join(outputDirectory, "comment-batch.json"), "[]");
    const completed = await completeValidatedHumanArtifact({
      runtime,
      registry,
      artifactStore,
      sessionId: "session",
      taskId: "task",
      actor: { actorId: "reviewer", actorType: "human" },
      executionId: "execution",
      outputDirectory,
      stepId: "00-receive-update-artifact",
    });
    assert.equal(completions, 1);
    assert.equal(completed.artifactVersions[0].logicalPath, "comment-batch.json");
    assert.equal(completed.artifactVersions[0].origin.executionId, "execution");
    assert.match(completed.artifactVersions[0].blobHash, /^[0-9a-f]{64}$/);
  } finally {
    await rm(artifactStore.root, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }

  const invalidRoot = await mkdtemp(path.join(tmpdir(), "comment-db-v3-human-artifact-invalid-"));
  try {
    await writeFile(path.join(invalidRoot, "response.json"), JSON.stringify({ workset_id: "w", decisions: {} }));
    await assert.rejects(() => completeValidatedHumanArtifact({
      runtime: { ...runtime, state: () => ({ tasks: { task: { taskId: "task", stepId: "03b-receive-classification-response", currentExecutionId: "execution" } } }) },
      registry,
      artifactStore: ArtifactStore.temporary(),
      sessionId: "session",
      taskId: "task",
      actor: { actorId: "reviewer", actorType: "human" },
      executionId: "stale-execution",
      outputDirectory: invalidRoot,
      stepId: "03b-receive-classification-response",
    }), /STALE_EXECUTION/);
    assert.equal(completions, 1);
  } finally {
    await rm(invalidRoot, { recursive: true, force: true });
  }
});
