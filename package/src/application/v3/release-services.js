import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../../state/canonical.js";
import { StateControlPlaneError, stateError } from "../../state/errors.js";
import { STREAM_KEYS, currentPolicyVersion, readExactPolicyVersion, typedClassificationHandler } from "../services.js";
import { normalizeArtifactBytes, MemoryReleaseArtifactStore } from "../../release/artifact-store.js";
import { runV3Idempotent } from "./context.js";
import { v3StepResult } from "./result.js";

const PIN_STREAMS = {
  corpusVersionId: STREAM_KEYS.corpus,
  classificationVersionId: STREAM_KEYS.classification,
  keywordSelectionVersionId: STREAM_KEYS.keywordSelection,
  projectionDefinitionVersionId: STREAM_KEYS.projectionDefinition,
};
const POLICY_KINDS = {
  corpusPolicyVersionId: "corpus",
  classificationPolicyVersionId: "classification",
  keywordPolicyVersionId: "keyword-selection",
  accountPolicyVersionId: "account-candidate",
};

function readExact(controlPlane, id, name, expected) {
  if (typeof id !== "string" || id.length === 0) throw stateError("EXPLICIT_VERSION_REQUIRED", `${name} is required`);
  const value = controlPlane.readVersion(id);
  if (!value) throw stateError("VERSION_NOT_FOUND", `${name} ${id} does not exist`);
  if (expected && (value.domain !== expected.domain || value.streamKey !== expected.streamKey)) throw stateError("VERSION_STREAM_MISMATCH", `${name} references the wrong stream`);
  return value;
}

function readRelease(controlPlane, releaseId) { return controlPlane.db.prepare("SELECT * FROM v3_release_bundles WHERE release_id = ?").get(releaseId) ?? null; }

function pinsFromRequest(controlPlane, request) {
  const pins = {};
  for (const [name, expected] of Object.entries(PIN_STREAMS)) pins[name] = readExact(controlPlane, request[name], name, expected).versionId;
  for (const [name, kind] of Object.entries(POLICY_KINDS)) pins[name] = readExactPolicyVersion(controlPlane, request[name], kind).versionId;
  if (request.sourceDatasetArtifactSha256 !== undefined) {
    if (typeof request.sourceDatasetArtifactSha256 !== "string" || !/^(?:sha256:)?[0-9a-f]{64}$/.test(request.sourceDatasetArtifactSha256)) throw stateError("SOURCE_DATASET_IDENTITY_INVALID", "sourceDatasetArtifactSha256 must be a SHA-256 value");
    pins.sourceDatasetArtifactSha256 = request.sourceDatasetArtifactSha256.replace(/^sha256:/, "");
  }
  return pins;
}

function assertPinnedDependency(controlPlane, versionId, role, expectedVersionId) {
  const dependencies = controlPlane.readDependencies(versionId);
  const dependency = dependencies.find((item) => item.role === role);
  // Legacy genesis fixtures have no dependency rows.  When a dependency is
  // present, however, it is authoritative and must match the release pin.
  if (dependency && dependency.versionId !== expectedVersionId) {
    throw stateError("RELEASE_DEPENDENCY_MISMATCH", `${versionId} ${role} dependency does not match the release pin`);
  }
}

function assertReleaseDependencies(controlPlane, pins) {
  assertPinnedDependency(controlPlane, pins.classificationVersionId, "corpus", pins.corpusVersionId);
  assertPinnedDependency(controlPlane, pins.keywordSelectionVersionId, "corpus", pins.corpusVersionId);
  assertPinnedDependency(controlPlane, pins.keywordSelectionVersionId, "classification", pins.classificationVersionId);
  if (pins.sourceDatasetArtifactSha256) {
    for (const versionId of [pins.classificationVersionId, pins.keywordSelectionVersionId]) {
      const state = controlPlane.readVersion(versionId)?.payload?.state ?? {};
      const candidate = state.source_dataset_artifact_sha256 ?? state.sourceDatasetArtifactSha256;
      if (candidate !== undefined && String(candidate).replace(/^sha256:/, "") !== pins.sourceDatasetArtifactSha256) throw stateError("SOURCE_DATASET_IDENTITY_MISMATCH", `${versionId} source dataset SHA does not match the release pin`);
    }
  }
}

function releaseKeyObject(pins) {
  return {
    contract: "comment-db-release-key/v1",
    corpusVersionId: pins.corpusVersionId,
    classificationVersionId: pins.classificationVersionId,
    keywordSelectionVersionId: pins.keywordSelectionVersionId,
    corpusPolicyVersionId: pins.corpusPolicyVersionId,
    classificationPolicyVersionId: pins.classificationPolicyVersionId,
    keywordPolicyVersionId: pins.keywordPolicyVersionId,
    accountPolicyVersionId: pins.accountPolicyVersionId,
    projectionDefinitionVersionId: pins.projectionDefinitionVersionId,
    sourceDatasetArtifactSha256: pins.sourceDatasetArtifactSha256 ?? null,
  };
}

function artifactRecord(logicalPath, content, stored = {}) {
  const bytes = normalizeArtifactBytes(content);
  return { logicalPath, blobHash: (stored.blobHash ?? prefixedSha256(bytes)).replace(/^sha256:/, ""), size: stored.size ?? stored.byteLength ?? bytes.length, bytes };
}

export class ReleaseApplicationServiceV3 {
  constructor(controlPlane, { artifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined } = {}) { this.controlPlane = controlPlane; this.artifactStore = artifactStore; this.artifactBuilder = artifactBuilder; }

  build(ctx, request = {}) {
    const run = () => {
      const pins = pinsFromRequest(this.controlPlane, request);
      assertReleaseDependencies(this.controlPlane, pins);
      const keyObject = releaseKeyObject(pins);
      const releaseKey = semanticSha256(keyObject);
      const releaseId = deterministicId("release-v3", releaseKey);
      const bundle = { schema_version: 2, contract: "comment-db-release/v3", releaseKey, pins: keyObject, exact: true };
      const existing = this.controlPlane.db.prepare("SELECT * FROM v3_release_bundles WHERE release_key = ?").get(releaseKey);
      if (existing) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "reused", refs: { releaseId: existing.release_id }, details: { releaseKey } });
      this.controlPlane._transaction((db) => {
        const raced = db.prepare("SELECT release_id FROM v3_release_bundles WHERE release_key = ?").get(releaseKey);
        if (raced) return;
        db.prepare("INSERT INTO v3_release_bundles (release_id, release_key, pins_json, projection_definition_version_id, bundle_sha256, bundle_json, materialization_json, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)").run(releaseId, releaseKey, canonicalJson(keyObject), pins.projectionDefinitionVersionId, semanticSha256(bundle), canonicalJson(bundle), this.controlPlane.now());
      });
      const final = this.controlPlane.db.prepare("SELECT release_id FROM v3_release_bundles WHERE release_key = ?").get(releaseKey);
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "created", refs: { releaseId: final.release_id }, details: { releaseKey } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.release.build", request, run);
  }

  materialize(ctx, request = {}) {
    const run = () => {
      const release = readRelease(this.controlPlane, request.releaseId);
      if (!release) throw stateError("RELEASE_NOT_FOUND", `release ${request.releaseId} does not exist`);
      const existing = release.materialization_json ? JSON.parse(release.materialization_json) : null;
      if (existing) {
        const intact = existing.artifacts.every((item) => this.artifactStore.has({ releaseId: request.releaseId, artifactKey: item.logicalPath, sha256: `sha256:${item.blobHash}` }));
        if (!intact) throw stateError("ARTIFACT_INTEGRITY_ERROR", `materialized release ${request.releaseId} is not intact`);
        return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "already_materialized", refs: { releaseId: request.releaseId } });
      }
      if (Object.hasOwn(request, "artifacts")) throw stateError("ARTIFACT_OVERRIDE_FORBIDDEN", "production release artifacts must be produced by the configured builder");
      const produced = typeof this.artifactBuilder === "function" ? this.artifactBuilder({ releaseId: request.releaseId, bundle: JSON.parse(release.bundle_json), pins: JSON.parse(release.pins_json) }) : null;
      if (!produced || typeof produced !== "object" || Array.isArray(produced) || Object.keys(produced).length === 0) throw stateError("ARTIFACT_REQUIRED", "v3 release materialization requires artifacts");
      const records = [];
      for (const logicalPath of Object.keys(produced).sort()) {
        if (!logicalPath || logicalPath.includes("..") || logicalPath.startsWith("/")) throw stateError("ARTIFACT_INVALID", `unsafe logicalPath ${logicalPath}`);
        const record = artifactRecord(logicalPath, produced[logicalPath]);
        const existingBytes = this.artifactStore.read({ releaseId: request.releaseId, artifactKey: logicalPath });
        if (existingBytes && prefixedSha256(existingBytes) !== `sha256:${record.blobHash}`) throw stateError("ARTIFACT_INTEGRITY_ERROR", `existing artifact ${logicalPath} differs`);
        if (!existingBytes) this.artifactStore.write({ releaseId: request.releaseId, artifactKey: logicalPath, content: record.bytes });
        const stored = this.artifactStore.read({ releaseId: request.releaseId, artifactKey: logicalPath });
        if (!stored || prefixedSha256(stored) !== `sha256:${record.blobHash}` || stored.length !== record.size) throw stateError("ARTIFACT_INTEGRITY_ERROR", `artifact ${logicalPath} failed verification`);
        records.push({ logicalPath, blobHash: record.blobHash, size: record.size });
      }
      const manifest = { projectionDefinitionVersionId: release.projection_definition_version_id, artifacts: records };
      this.controlPlane._transaction((db) => {
        const current = db.prepare("SELECT materialization_json FROM v3_release_bundles WHERE release_id = ?").get(request.releaseId);
        if (current?.materialization_json && current.materialization_json !== canonicalJson(manifest)) throw stateError("ARTIFACT_INTEGRITY_ERROR", "release materialization was concurrently changed");
        for (const record of records) {
          const existingArtifact = db.prepare("SELECT blob_hash, byte_length, artifact_json FROM v3_release_artifacts WHERE release_id = ? AND logical_path = ?").get(request.releaseId, record.logicalPath);
          if (existingArtifact && (existingArtifact.blob_hash !== record.blobHash || Number(existingArtifact.byte_length) !== record.size || existingArtifact.artifact_json !== canonicalJson(record))) throw stateError("ARTIFACT_INTEGRITY_ERROR", `release artifact ${record.logicalPath} was concurrently changed`);
          if (!existingArtifact) db.prepare("INSERT INTO v3_release_artifacts (release_id, logical_path, blob_hash, byte_length, artifact_json) VALUES (?, ?, ?, ?, ?)").run(request.releaseId, record.logicalPath, record.blobHash, record.size, canonicalJson(record));
        }
        if (!current?.materialization_json) db.prepare("UPDATE v3_release_bundles SET materialization_json = ? WHERE release_id = ?").run(canonicalJson(manifest), request.releaseId);
      });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "materialized", refs: { releaseId: request.releaseId }, details: { manifest } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.release.materialize", request, run);
  }
}

export class PromotionApplicationServiceV3 {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  propose(ctx, request = {}) {
    const run = () => {
      const release = readRelease(this.controlPlane, request.releaseId);
      if (!release?.materialization_json) throw stateError("RELEASE_NOT_MATERIALIZED", `release ${request.releaseId} is not materialized`);
      const promotionStream = this.controlPlane.ensureStream(STREAM_KEYS.promotion);
      const expected = request.expectedPromotionHeadVersionId ?? this.controlPlane.resolveHead(promotionStream.stream_id)?.versionId ?? null;
      const proposalId = deterministicId("proposal-v3", `${ctx.operationId}:${request.releaseId}:${request.promotionStream ?? "production"}`);
      const reviewedRelease = {
        releaseId: release.release_id,
        releaseKey: release.release_key,
        pins: JSON.parse(release.pins_json),
        bundleSha256: release.bundle_sha256,
        materialization: JSON.parse(release.materialization_json),
        target: "production",
      };
      try {
        this.controlPlane.createProposal({ proposalId, streamId: promotionStream.stream_id, expectedHeadVersionId: expected, proposedSemanticSha256: semanticSha256({ target: "production", releaseId: request.releaseId }), payload: { schema_version: 1, state: { target: "production", releaseId: request.releaseId } }, dependencies: [], assessmentRefs: { releaseId: request.releaseId, promotionStream: request.promotionStream ?? "production", target: "production", reviewedRelease }, operationId: `${ctx.operationId}/proposal` });
      } catch (error) {
        if (!(error instanceof StateControlPlaneError && error.code === "IMMUTABLE_VIOLATION")) throw error;
      }
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "created", refs: { proposalId, releaseId: request.releaseId } });
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.promotion.propose", request, run);
  }

  finalize(ctx, request = {}) {
    const run = () => {
      const proposal = this.controlPlane.readProposal(request.proposalId);
      if (!proposal) throw stateError("PROPOSAL_NOT_FOUND", "promotion proposal is required");
      const releaseId = proposal.payload?.state?.releaseId;
      if (releaseId !== request.releaseId || proposal.payload?.state?.target !== "production") throw stateError("PROMOTION_PROPOSAL_MISMATCH", "promotion proposal does not match the reviewed release");
      const review = request.review;
      if (!review || !["accept", "reject"].includes(review.outcome) || review.actor?.actorType !== "human") throw stateError("UNAUTHORIZED_ACTOR", "a human promotion review is required");
      const promotion = this.controlPlane.ensureStream(STREAM_KEYS.promotion);
      const transitionPolicyVersionId = request.transitionPolicyVersionId ?? currentPolicyVersion(this.controlPlane, ctx, "promotion-production");
      const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:${proposal.proposalId}`), proposalId: proposal.proposalId, outcome: review.outcome === "accept" ? "accepted" : "rejected", authorityKind: "human", authorityRef: review.actor.actorId, transitionPolicyVersionId, rationale: review.rationale ?? null, operationId: `${ctx.operationId}/decision` });
      if (decision.outcome === "rejected") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "rejected", stateResult: "rejected", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, releaseId } });
      const current = this.controlPlane.resolveHead(promotion.stream_id);
      if ((current?.versionId ?? null) !== (proposal.expectedHeadVersionId ?? null)) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, releaseId } });
      if (current?.payload?.state?.releaseId === releaseId) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "reused", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, promotionVersionId: current.versionId, releaseId } });
      const payload = { schema_version: 1, state: { target: "production", releaseId } };
      try {
        const commit = this.controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: `${ctx.operationId}/commit`, domainHandler: { validate: ({ proposal: item }) => { if (semanticSha256(item.payload.state) !== item.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "promotion payload changed"); }, persist: ({ db, versionId }) => db.prepare("INSERT INTO promotion_states (version_id, release_id, state_json) VALUES (?, ?, ?)").run(versionId, releaseId, canonicalJson(payload.state)) } });
        return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "committed", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, promotionVersionId: commit.versionId, releaseId } });
      } catch (error) {
        if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { proposalId: proposal.proposalId, decisionId: decision.decisionId, releaseId } });
        throw error;
      }
    };
    return runV3Idempotent(this.controlPlane, ctx, "comment-data-update.v3.promotion.finalize", request, run);
  }
}
