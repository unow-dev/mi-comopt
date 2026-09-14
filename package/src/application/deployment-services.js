import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { PERMISSIONS, STREAM_KEYS, requireContext, stepResult } from "./services.js";
import { assertDeploymentAdapter } from "../deployment/adapter.js";

function readPromotion(controlPlane) {
  const stream = controlPlane.ensureStream(STREAM_KEYS.promotion);
  const head = controlPlane.resolveHead(stream.stream_id);
  if (!head) throw stateError("PROMOTION_NOT_FOUND", "no promoted production release exists");
  return { stream, head, releaseId: head.payload?.state?.releaseId };
}

function readDeploymentHead(controlPlane) {
  const stream = controlPlane.ensureStream(STREAM_KEYS.deployment);
  return { stream, head: controlPlane.resolveHead(stream.stream_id) };
}

function validateEvent(event) {
  const eventKeys = ["eventType", "correlationKey", "payload"];
  const payloadKeys = ["deploymentRequestId", "target", "releaseId", "status", "externalRunRef", "completedAt"];
  if (!event || typeof event !== "object" || Object.keys(event).sort().join("\u001f") !== eventKeys.sort().join("\u001f") || event.eventType !== "deployment.completed" || typeof event.correlationKey !== "string" || !event.payload || Object.keys(event.payload).sort().join("\u001f") !== payloadKeys.sort().join("\u001f") || event.correlationKey !== event.payload.deploymentRequestId || event.payload.target !== "production" || !["succeeded", "failed", "cancelled"].includes(event.payload.status) || typeof event.payload.releaseId !== "string" || typeof event.payload.externalRunRef !== "string" || typeof event.payload.completedAt !== "string" || Number.isNaN(Date.parse(event.payload.completedAt))) throw stateError("INVALID_DEPLOYMENT_EVENT", "deployment event does not satisfy deployment-completed-event contract");
  return event;
}

export class DeploymentApplicationService {
  constructor(controlPlane, { adapter } = {}) { this.controlPlane = controlPlane; this.adapter = assertDeploymentAdapter(adapter); }

  async trigger(ctx, request = {}) {
    requireContext(ctx, ["state:read", "deployment:trigger"]);
    const target = request.target ?? "production";
    if (target !== "production") throw stateError("VALIDATION_ERROR", "only production deployment is supported");
    const promotion = readPromotion(this.controlPlane);
    if (promotion.releaseId !== request.releaseId) throw stateError("RELEASE_NOT_PROMOTED", `release ${request.releaseId} is not the desired production release`);
    const { head: deploymentHead } = readDeploymentHead(this.controlPlane);
    const deploymentRequestId = request.deploymentRequestId ?? deterministicId("deployment-request", `${ctx.workflowSessionId}:${request.releaseId}:${target}`);
    if (deploymentHead?.payload?.state?.releaseId === request.releaseId) return stepResult("already_deployed", { releaseId: request.releaseId, deploymentRequestId }, request, deploymentHead.semanticSha256, { outcome: "verify" });
    let ensured;
    try {
      ensured = await this.adapter.ensureDeployment({ deploymentRequestId, releaseId: request.releaseId, target });
    } catch (error) {
      throw stateError(error.code ?? "DEPLOYMENT_TRIGGER_FAILED", error.message, { cause: error });
    }
    const result = this.controlPlane.runIdempotent({ operationId: ctx.operationId, operationKind: "deployment.trigger", request: { deploymentRequestId, releaseId: request.releaseId, target } }, (db) => {
      const existing = db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
      if (existing) {
        const failed = existing.status === "failed" || existing.status === "cancelled";
        return { stateResult: failed ? "blocked" : existing.status === "succeeded" ? "already_deployed" : "triggered", releaseId: request.releaseId, deploymentRequestId, externalRunRef: existing.external_run_ref, outcome: failed ? "deployment_failed" : undefined };
      }
      db.prepare("INSERT INTO deployment_requests (deployment_request_id, release_id, target, external_run_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(deploymentRequestId, request.releaseId, target, ensured.externalRunRef ?? null, ensured.status === "succeeded" ? "succeeded" : "requested", this.controlPlane.now(), this.controlPlane.now());
      const failed = ensured.status === "failed" || ensured.status === "cancelled";
      return { stateResult: failed ? "blocked" : ensured.alreadyDeployed || ensured.status === "succeeded" ? "already_deployed" : "triggered", releaseId: request.releaseId, deploymentRequestId, externalRunRef: ensured.externalRunRef ?? null, outcome: failed ? "deployment_failed" : undefined };
    });
    return stepResult(result.stateResult, { releaseId: request.releaseId, deploymentRequestId: result.deploymentRequestId }, request, result.externalRunRef ?? result.deploymentRequestId, { outcome: result.outcome ?? (result.stateResult === "already_deployed" ? "verify" : "wait"), externalRunRef: result.externalRunRef });
  }

  receiveCompletedEvent(event) {
    validateEvent(event);
    const eventFingerprint = prefixedSha256(event);
    return this.controlPlane._transaction((db) => {
      const existing = db.prepare("SELECT * FROM deployment_completed_events WHERE event_fingerprint = ?").get(eventFingerprint);
      if (existing) return { duplicate: true, eventFingerprint, event: JSON.parse(existing.event_json) };
      db.prepare("INSERT INTO deployment_completed_events (event_fingerprint, deployment_request_id, event_json, received_at) VALUES (?, ?, ?, ?)").run(eventFingerprint, event.payload.deploymentRequestId, canonicalJson(event), this.controlPlane.now());
      db.prepare("UPDATE deployment_requests SET status = ?, external_run_ref = ?, updated_at = ? WHERE deployment_request_id = ? AND release_id = ?").run(event.payload.status, event.payload.externalRunRef, this.controlPlane.now(), event.payload.deploymentRequestId, event.payload.releaseId);
      return { duplicate: false, eventFingerprint, status: event.payload.status, deploymentRequestId: event.payload.deploymentRequestId };
    });
  }

  async verify(ctx, request = {}) {
    requireContext(ctx, ["state:read", "deployment:verify"]);
    const result = await this.adapter.verifyDeployment({ releaseId: request.releaseId, target: request.target ?? "production", externalRunRef: request.externalRunRef });
    const verified = result?.verified === true && result.servedReleaseId === request.releaseId;
    return stepResult(verified ? "verified" : "not_verified", { releaseId: request.releaseId, verificationRef: verified ? result.verificationRef : undefined }, request, verified ? result.verificationRef : undefined, { outcome: verified ? "continue" : "rejected", servedReleaseId: result?.servedReleaseId ?? null });
  }

  record(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:auto-decide", "state:commit"]);
    if (request.verified !== true || typeof request.verificationRef !== "string" || request.verificationRef.length === 0) return stepResult("not_verified", { releaseId: request.releaseId }, request, undefined, { outcome: "rejected" });
    const { stream, head } = readDeploymentHead(this.controlPlane);
    if (head?.payload?.state?.releaseId === request.releaseId) return stepResult("unchanged", { deploymentVersionId: head.versionId, releaseId: request.releaseId, verificationRef: request.verificationRef }, request, head.semanticSha256, { outcome: "continue" });
    const proposalId = deterministicId("proposal", `${ctx.operationId}:deployment:${request.releaseId}`);
    const payload = { schema_version: 1, state: { target: request.target ?? "production", releaseId: request.releaseId, verificationRef: request.verificationRef } };
    this.controlPlane.createProposal({ proposalId, streamId: stream.stream_id, expectedHeadVersionId: request.expectedDeploymentHeadVersionId ?? head?.versionId ?? null, proposedSemanticSha256: semanticSha256(payload.state), payload, assessmentRefs: { verificationRef: request.verificationRef }, operationId: `${ctx.operationId}/proposal` });
    const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:deployment`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "deployment-verify", transitionPolicyVersionId: request.transitionPolicyVersionId ?? "deployment-verify-policy", operationId: `${ctx.operationId}/decision` });
    try {
      const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: ctx.operationId, domainHandler: {
        validate: ({ proposal }) => { if (!proposal.payload.state?.verificationRef) throw stateError("UNVERIFIED_DEPLOYMENT", "verification evidence is required"); if (semanticSha256(proposal.payload.state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "deployment semantic fingerprint is invalid"); },
        persist: ({ db, versionId }) => db.prepare("INSERT INTO deployment_states (version_id, release_id, verification_ref, state_json) VALUES (?, ?, ?, ?)").run(versionId, request.releaseId, request.verificationRef, canonicalJson(payload.state)),
      } });
      return stepResult(commit.stateResult, { proposalId, decisionId: commit.decisionId, deploymentVersionId: commit.versionId, releaseId: request.releaseId, verificationRef: request.verificationRef }, request, commit.semanticSha256, { outcome: "continue" });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { proposalId }, request, undefined, { outcome: "superseded", conflictAt: "deployment" });
      throw error;
    }
  }
}

export { validateEvent as validateDeploymentCompletedEvent };
