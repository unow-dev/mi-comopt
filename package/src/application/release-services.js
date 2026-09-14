import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { PERMISSIONS, STREAM_KEYS, requireContext, stepResult, typedCorpusHandler } from "./services.js";
import { normalizeArtifactBytes, MemoryReleaseArtifactStore } from "../release/artifact-store.js";

const RELEASE_MEMBER_ROLES = ["corpus", "classification", "keyword_selection", "projection_definition"];

function readRequiredVersion(controlPlane, versionId, role) {
  if (typeof versionId !== "string" || versionId.length === 0) throw stateError("EXPLICIT_VERSION_REQUIRED", `${role} version ID is required`);
  const version = controlPlane.readVersion(versionId);
  if (!version) throw stateError("VERSION_NOT_FOUND", `${role} version ${versionId} does not exist`);
  return version;
}

function assertVersionDomain(version, expectedDomain, role) {
  if (version.domain !== expectedDomain) throw stateError("VERSION_ROLE_INVALID", `${role} must reference ${expectedDomain} state`);
  return version;
}

function releaseRow(controlPlane, releaseId) {
  return controlPlane.db.prepare("SELECT * FROM release_bundles WHERE release_id = ?").get(releaseId) ?? null;
}

export class ReleaseApplicationService {
  constructor(controlPlane, { artifactStore = new MemoryReleaseArtifactStore(), artifactBuilder = undefined } = {}) {
    this.controlPlane = controlPlane;
    this.artifactStore = artifactStore;
    this.artifactBuilder = artifactBuilder;
  }

  build(ctx, request = {}) {
    requireContext(ctx, ["state:read", "release:build"]);
    const versions = {
      corpus: assertVersionDomain(readRequiredVersion(this.controlPlane, request.corpusVersionId, "corpus"), "corpus", "corpus"),
      classification: assertVersionDomain(readRequiredVersion(this.controlPlane, request.classificationVersionId, "classification"), "classification", "classification"),
      keyword_selection: assertVersionDomain(readRequiredVersion(this.controlPlane, request.keywordSelectionVersionId, "keyword-selection"), "keyword-selection", "keyword-selection"),
      projection_definition: assertVersionDomain(readRequiredVersion(this.controlPlane, request.projectionDefinitionVersionId, "projection-definition"), "projection-definition", "projection-definition"),
    };
    const policies = request.policyVersionIds ?? {
      classification: request.classificationPolicyVersionId,
      keyword_selection: request.keywordPolicyVersionId,
      account_candidate: request.accountPolicyVersionId,
    };
    const policyMembers = Object.entries(policies).filter(([, id]) => id !== undefined && id !== null).map(([role, versionId]) => ({ role: `policy:${role}`, versionId: assertVersionDomain(readRequiredVersion(this.controlPlane, versionId, `policy:${role}`), "policy", `policy:${role}`).versionId }));
    const members = [...RELEASE_MEMBER_ROLES.map((role) => ({ role, versionId: versions[role].versionId })), ...policyMembers].sort((left, right) => left.role.localeCompare(right.role));
    const bundle = {
      schema_version: 1,
      members,
      projectionDefinitionVersionId: versions.projection_definition.versionId,
      exact: true,
    };
    const bundleSha256 = semanticSha256(bundle);
    const releaseId = deterministicId("release", bundleSha256);
    const prior = releaseRow(this.controlPlane, releaseId);
    if (prior) return stepResult("reused", { releaseId }, request, bundleSha256, { bundleSha256, exact: true });
    const result = this.controlPlane.runIdempotent({ operationId: ctx.operationId, operationKind: "release.build", request: { ...request, members, bundleSha256 } }, (db) => {
      const again = releaseRow(this.controlPlane, releaseId);
      if (again) return { stateResult: "reused", releaseId, bundleSha256 };
      db.prepare("INSERT INTO release_bundles (release_id, bundle_sha256, projection_definition_version_id, bundle_json, created_at) VALUES (?, ?, ?, ?, ?)").run(releaseId, bundleSha256, versions.projection_definition.versionId, canonicalJson(bundle), this.controlPlane.now());
      const insert = db.prepare("INSERT INTO release_bundle_members (release_id, role, version_id) VALUES (?, ?, ?)");
      for (const member of members) insert.run(releaseId, member.role, member.versionId);
      return { stateResult: "created", releaseId, bundleSha256 };
    });
    return stepResult(result.stateResult, { releaseId }, request, bundleSha256, { bundleSha256, exact: true });
  }

  materialize(ctx, request = {}) {
    requireContext(ctx, ["release:build", "artifact:write"]);
    const release = releaseRow(this.controlPlane, request.releaseId);
    if (!release) throw stateError("RELEASE_NOT_FOUND", `release ${request.releaseId} does not exist`);
    const existingArtifacts = this.controlPlane.db.prepare("SELECT * FROM release_artifacts WHERE release_id = ? ORDER BY artifact_key").all(request.releaseId);
    if (release.materialized_at && existingArtifacts.length > 0) {
      const intact = existingArtifacts.every((artifact) => this.artifactStore.has({ releaseId: request.releaseId, artifactKey: artifact.artifact_key, sha256: artifact.artifact_sha256 }));
      if (!intact) throw stateError("ARTIFACT_INTEGRITY_ERROR", `materialized release ${request.releaseId} references missing or changed bytes`);
      return stepResult("already_materialized", { releaseId: request.releaseId }, request, release.bundle_sha256);
    }
    let artifacts = request.artifacts;
    if (!artifacts && typeof this.artifactBuilder === "function") artifacts = this.artifactBuilder({ releaseId: request.releaseId, bundle: JSON.parse(release.bundle_json) });
    if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts) || Object.keys(artifacts).length === 0) throw stateError("ARTIFACT_REQUIRED", "release materialization requires at least one release-owned artifact");
    const written = [];
    for (const key of Object.keys(artifacts).sort()) {
      if (!/^[a-z][a-z0-9_-]*$/.test(key)) throw stateError("ARTIFACT_INVALID", `unsafe artifact key ${key}`);
      const content = normalizeArtifactBytes(artifacts[key]);
      const metadata = this.artifactStore.write({ releaseId: request.releaseId, artifactKey: key, content });
      const stored = this.artifactStore.read({ releaseId: request.releaseId, artifactKey: key });
      if (!stored || prefixedSha256(stored) !== metadata.sha256 || stored.length !== metadata.byteLength) throw stateError("ARTIFACT_INTEGRITY_ERROR", `artifact ${key} failed independent verification`);
      written.push({ artifactKey: key, path: metadata.path, sha256: metadata.sha256, byteLength: metadata.byteLength });
    }
    const result = this.controlPlane.runIdempotent({ operationId: ctx.operationId, operationKind: "release.materialize", request: { releaseId: request.releaseId, artifacts: written } }, (db) => {
      const current = releaseRow(this.controlPlane, request.releaseId);
      const present = db.prepare("SELECT COUNT(*) AS count FROM release_artifacts WHERE release_id = ?").get(request.releaseId).count;
      if (current.materialized_at && Number(present) > 0) return { stateResult: "already_materialized", releaseId: request.releaseId, artifacts: written };
      const insert = db.prepare("INSERT INTO release_artifacts (release_id, artifact_key, artifact_path, artifact_sha256, byte_length) VALUES (?, ?, ?, ?, ?)");
      for (const artifact of written) insert.run(request.releaseId, artifact.artifactKey, artifact.path, artifact.sha256, artifact.byteLength);
      db.prepare("UPDATE release_bundles SET materialized_at = ? WHERE release_id = ?").run(this.controlPlane.now(), request.releaseId);
      return { stateResult: "materialized", releaseId: request.releaseId, artifacts: written };
    });
    return stepResult(result.stateResult, { releaseId: request.releaseId }, request, result.artifacts ?? written, { artifacts: result.artifacts ?? written });
  }

  verifyMaterialized(releaseId) {
    const release = releaseRow(this.controlPlane, releaseId);
    if (!release) throw stateError("RELEASE_NOT_FOUND", `release ${releaseId} does not exist`);
    const artifacts = this.controlPlane.db.prepare("SELECT * FROM release_artifacts WHERE release_id = ? ORDER BY artifact_key").all(releaseId);
    if (!release.materialized_at || artifacts.length === 0) return { verified: false, artifacts: [] };
    return {
      verified: artifacts.every((artifact) => this.artifactStore.has({ releaseId, artifactKey: artifact.artifact_key, sha256: artifact.artifact_sha256 })),
      artifacts: artifacts.map((artifact) => ({ artifactKey: artifact.artifact_key, path: artifact.artifact_path, sha256: artifact.artifact_sha256, byteLength: Number(artifact.byte_length) })),
    };
  }
}

export class PromotionApplicationService {
  constructor(controlPlane) { this.controlPlane = controlPlane; }

  propose(ctx, { releaseId, expectedHeadVersionId = null, target = "production" } = {}) {
    requireContext(ctx, ["state:read", "state:propose"]);
    if (target !== "production") throw stateError("VALIDATION_ERROR", "only production promotion is supported");
    const release = releaseRow(this.controlPlane, releaseId);
    if (!release || !release.materialized_at) throw stateError("RELEASE_NOT_MATERIALIZED", `release ${releaseId} is not materialized`);
    const stream = this.controlPlane.ensureStream(STREAM_KEYS.promotion);
    const payload = { schema_version: 1, state: { target, releaseId } };
    const proposalId = deterministicId("proposal", `${ctx.operationId}:promotion:${releaseId}`);
    this.controlPlane.createProposal({ proposalId, streamId: stream.stream_id, expectedHeadVersionId, proposedSemanticSha256: semanticSha256(payload.state), payload, assessmentRefs: { releaseId }, operationId: `${ctx.operationId}/proposal` });
    return stepResult("created", { proposalId, releaseId }, { releaseId, expectedHeadVersionId, target }, semanticSha256(payload.state));
  }

  finalize(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:commit"]);
    const proposal = this.controlPlane.readProposal(request.proposalId);
    if (!proposal) throw stateError("PROPOSAL_NOT_FOUND", `proposal ${request.proposalId} does not exist`);
    const releaseId = proposal.payload.state?.releaseId;
    const target = proposal.payload.state?.target;
    if (target !== "production" || releaseId !== request.releaseId) throw stateError("PROMOTION_PROPOSAL_MISMATCH", "promotion proposal and request do not match");
    const actor = request.review?.actor;
    if (!actor || actor.actorType !== "human") throw stateError("UNAUTHORIZED_ACTOR", "production promotion requires an authorized human");
    if (!request.review || !["accept", "reject"].includes(request.review.outcome)) throw stateError("INVALID_REVIEW_OUTCOME", "promotion review outcome must be accept or reject");
    const policy = request.transitionPolicyVersionId ? this.controlPlane.readVersion(request.transitionPolicyVersionId)?.payload ?? {} : {};
    const authorization = policy.authorization ?? policy.review_authorization ?? {};
    if (Array.isArray(authorization.allowed_actor_ids) && !authorization.allowed_actor_ids.includes(actor.actorId)) throw stateError("UNAUTHORIZED_ACTOR", "the promotion actor is not authorized by the Transition Policy");
    const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:promotion`), proposalId: proposal.proposalId, outcome: request.review.outcome === "accept" ? "accepted" : "rejected", authorityKind: "human", authorityRef: actor.actorId, transitionPolicyVersionId: request.transitionPolicyVersionId ?? "production-promotion-policy", rationale: request.review.rationale ?? null, operationId: `${ctx.operationId}/decision` });
    if (decision.outcome === "rejected") return stepResult("rejected", { proposalId: proposal.proposalId, decisionId: decision.decisionId, releaseId }, request, undefined, { outcome: "not_promoted" });
    const stream = this.controlPlane.ensureStream(STREAM_KEYS.promotion);
    const current = this.controlPlane.resolveHead(stream.stream_id);
    if (current?.payload?.state?.releaseId === releaseId) return stepResult("unchanged", { proposalId: proposal.proposalId, decisionId: decision.decisionId, promotionVersionId: current.versionId, releaseId }, request, current.semanticSha256, { outcome: "continue" });
    const payload = { schema_version: 1, state: { target, releaseId } };
    try {
      const commit = this.controlPlane.commitProposal({ proposalId: proposal.proposalId, decisionId: decision.decisionId, operationId: ctx.operationId, domainHandler: {
        validate: ({ proposal: candidate }) => { if (candidate.payload.state?.releaseId !== releaseId) throw stateError("DOMAIN_VALIDATION_ERROR", "promotion release mismatch"); if (semanticSha256(candidate.payload.state) !== candidate.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "promotion semantic fingerprint is invalid"); },
        persist: ({ db, versionId }) => db.prepare("INSERT INTO promotion_states (version_id, release_id, state_json) VALUES (?, ?, ?)").run(versionId, releaseId, canonicalJson(payload.state)),
      } });
      return stepResult(commit.stateResult, { proposalId: proposal.proposalId, decisionId: commit.decisionId, promotionVersionId: commit.versionId, releaseId }, request, commit.semanticSha256, { outcome: "continue" });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { proposalId: proposal.proposalId, decisionId: decision.decisionId, releaseId }, request, undefined, { outcome: "superseded", conflictAt: "promotion" });
      throw error;
    }
  }
}

export { releaseRow };
