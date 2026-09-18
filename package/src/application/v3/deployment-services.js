import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../../state/canonical.js";
import { StateControlPlaneError, stateError } from "../../state/errors.js";
import { STREAM_KEYS, currentPolicyVersion, readExactPolicyVersion } from "../services.js";
import { assertDeploymentAdapter } from "../../deployment/adapter.js";
import { v3StepResult } from "./result.js";

export function externalEventCommandId(eventId) {
  if (typeof eventId !== "string" || eventId.length === 0) throw stateError("EVENT_ID_INVALID", "eventId is required");
  return `event:${eventId}`;
}

function deploymentRow(controlPlane, deploymentRequestId) { return controlPlane.db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId) ?? null; }
function promotionHead(controlPlane) { const stream = controlPlane.ensureStream(STREAM_KEYS.promotion); return { stream, head: controlPlane.resolveHead(stream.stream_id) }; }
function deploymentHead(controlPlane) { const stream = controlPlane.ensureStream(STREAM_KEYS.deployment); return { stream, head: controlPlane.resolveHead(stream.stream_id) }; }
function nonterminal(status) { return !["succeeded", "failed", "cancelled", "superseded"].includes(status); }

function statusFromAdapter(result) {
  if (result?.status === "failed") return "failed";
  if (result?.status === "cancelled") return "cancelled";
  if (result?.status === "succeeded" || result?.alreadyDeployed === true) return "succeeded";
  return "active";
}

export class DeploymentQueueServiceV3 {
  constructor(controlPlane, { adapter } = {}) { this.controlPlane = controlPlane; this.adapter = adapter ? assertDeploymentAdapter(adapter) : null; }

  ensureIntent(ctx, request = {}) {
    if (request.target !== undefined && request.target !== "production") throw stateError("VALIDATION_ERROR", "only production deployment is supported");
    if (typeof request.acceptedPromotionDecisionId !== "string" || request.acceptedPromotionDecisionId.length === 0) throw stateError("DECISION_REQUIRED", "acceptedPromotionDecisionId is required");
    if (typeof request.promotionVersionId !== "string" || request.promotionVersionId.length === 0 || typeof request.releaseId !== "string" || request.releaseId.length === 0) throw stateError("VERSION_REQUIRED", "promotionVersionId and releaseId are required");
    const target = "production";
    const existing = this.controlPlane.db.prepare("SELECT * FROM v3_deployment_requests WHERE accepted_promotion_decision_id = ? AND target = ?").get(request.acceptedPromotionDecisionId, target);
    if (existing) {
      if (existing.promotion_version_id !== request.promotionVersionId || existing.release_id !== request.releaseId) throw stateError("DEPLOYMENT_REQUEST_CONFLICT", "accepted Promotion Decision is bound to a different deployment intent");
      return existing;
    }
    return this.controlPlane._transaction((db) => {
      const raced = db.prepare("SELECT * FROM v3_deployment_requests WHERE accepted_promotion_decision_id = ? AND target = ?").get(request.acceptedPromotionDecisionId, target);
      if (raced) {
        if (raced.promotion_version_id !== request.promotionVersionId || raced.release_id !== request.releaseId) throw stateError("DEPLOYMENT_REQUEST_CONFLICT", "accepted Promotion Decision is bound to a different deployment intent");
        return raced;
      }
      const sequenceRow = db.prepare("SELECT next_sequence FROM v3_deployment_target_sequences WHERE target = ?").get(target);
      const sequence = sequenceRow ? Number(sequenceRow.next_sequence) : 1;
      if (sequenceRow) db.prepare("UPDATE v3_deployment_target_sequences SET next_sequence = ? WHERE target = ?").run(sequence + 1, target);
      else db.prepare("INSERT INTO v3_deployment_target_sequences (target, next_sequence) VALUES (?, ?)").run(target, sequence + 1);
      const id = request.deploymentRequestId ?? deterministicId("deployment-request-v3", `${request.acceptedPromotionDecisionId}:${target}`);
      const now = this.controlPlane.now();
      db.prepare("INSERT INTO v3_deployment_requests (deployment_request_id, workflow_session_id, accepted_promotion_decision_id, promotion_version_id, release_id, target, deployment_sequence, status, external_run_ref, event_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)").run(id, request.workflowSessionId ?? ctx?.workflowSessionId ?? "", request.acceptedPromotionDecisionId, request.promotionVersionId, request.releaseId, target, sequence, now, now);
      return db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(id);
    });
  }

  async trigger(ctx, request = {}) {
    const row = this.ensureIntent(ctx, { ...request, workflowSessionId: request.workflowSessionId ?? ctx.workflowSessionId });
    const promotion = promotionHead(this.controlPlane);
    if ((promotion.head?.versionId ?? null) !== request.promotionVersionId || promotion.head?.payload?.state?.releaseId !== request.releaseId) {
      if (row.status === "queued") this.controlPlane._transaction((db) => db.prepare("UPDATE v3_deployment_requests SET status = 'superseded', updated_at = ? WHERE deployment_request_id = ? AND status = 'queued'").run(this.controlPlane.now(), row.deployment_request_id));
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { releaseId: request.releaseId, promotionVersionId: request.promotionVersionId } });
    }
    if (row.status === "superseded") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });
    if (["succeeded"].includes(row.status)) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "verify", stateResult: "already_deployed", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });

    // Claim the durable queue slot before crossing the external side-effect
    // boundary. A second dispatcher observing `active` must wait and may not
    // call the provider with the same request ID.
    const claim = this.controlPlane._transaction((db) => {
      const current = db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(row.deployment_request_id);
      if (!current) throw stateError("DEPLOYMENT_REQUEST_NOT_FOUND", "v3 deployment request is required");
      if (["succeeded", "failed", "cancelled", "superseded"].includes(current.status)) return { row: current, claimed: false };
      const earlier = db.prepare("SELECT * FROM v3_deployment_requests WHERE target = ? AND deployment_sequence < ? AND status NOT IN ('succeeded','failed','cancelled','superseded') ORDER BY deployment_sequence LIMIT 1").get(current.target, current.deployment_sequence);
      if (earlier) return { row: current, claimed: false, waitingFor: earlier.deployment_request_id };
      const latestPromotion = promotionHead(this.controlPlane);
      if ((latestPromotion.head?.versionId ?? null) !== current.promotion_version_id) {
        db.prepare("UPDATE v3_deployment_requests SET status = 'superseded', updated_at = ? WHERE deployment_request_id = ? AND status = 'queued'").run(this.controlPlane.now(), current.deployment_request_id);
        return { row: db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(current.deployment_request_id), claimed: false };
      }
      if (current.status !== "queued") return { row: current, claimed: false, alreadyActive: current.status === "active" };
      const result = db.prepare("UPDATE v3_deployment_requests SET status = 'active', updated_at = ? WHERE deployment_request_id = ? AND status = 'queued'").run(this.controlPlane.now(), current.deployment_request_id);
      if (result.changes !== 1) return { row: db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(current.deployment_request_id), claimed: false, alreadyActive: true };
      return { row: db.prepare("SELECT * FROM v3_deployment_requests WHERE deployment_request_id = ?").get(current.deployment_request_id), claimed: true };
    });
    if (!claim.claimed) {
      if (claim.row.status === "superseded") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { releaseId: claim.row.release_id, promotionVersionId: claim.row.promotion_version_id } });
      if (claim.row.status === "succeeded") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "verify", stateResult: "already_deployed", refs: { deploymentRequestId: claim.row.deployment_request_id, releaseId: claim.row.release_id, promotionVersionId: claim.row.promotion_version_id } });
      if (claim.row.status === "failed" || claim.row.status === "cancelled") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "deployment_failed", stateResult: "deployment_failed", refs: { deploymentRequestId: claim.row.deployment_request_id, releaseId: claim.row.release_id, promotionVersionId: claim.row.promotion_version_id } });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "wait", stateResult: "triggered", refs: { deploymentRequestId: claim.row.deployment_request_id, releaseId: claim.row.release_id, promotionVersionId: claim.row.promotion_version_id }, details: { ...(claim.waitingFor ? { waitingFor: claim.waitingFor } : { active: claim.alreadyActive === true }) } });
    }
    const claimedRow = claim.row;
    if (!this.adapter) throw stateError("CONFIGURATION_ERROR", "v3 deployment adapter is required");
    let ensured;
    try { ensured = await this.adapter.ensureDeployment({ deploymentRequestId: claimedRow.deployment_request_id, releaseId: claimedRow.release_id, target: claimedRow.target }); }
    catch (error) {
      this.controlPlane._transaction((db) => db.prepare("UPDATE v3_deployment_requests SET status = 'queued', updated_at = ? WHERE deployment_request_id = ? AND status = 'active'").run(this.controlPlane.now(), claimedRow.deployment_request_id));
      throw stateError(error.code ?? "DEPLOYMENT_EXECUTION_FAILED", error.message, { cause: error });
    }
    const status = statusFromAdapter(ensured);
    this.controlPlane._transaction((db) => db.prepare("UPDATE v3_deployment_requests SET status = ?, external_run_ref = COALESCE(external_run_ref, ?), updated_at = ? WHERE deployment_request_id = ? AND status NOT IN ('succeeded','failed','cancelled','superseded')").run(status, ensured?.externalRunRef ?? null, this.controlPlane.now(), claimedRow.deployment_request_id));
    const final = deploymentRow(this.controlPlane, claimedRow.deployment_request_id);
    if (final.status === "succeeded") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "verify", stateResult: "already_deployed", refs: { deploymentRequestId: final.deployment_request_id, releaseId: final.release_id, promotionVersionId: final.promotion_version_id } });
    if (final.status === "failed" || final.status === "cancelled") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "deployment_failed", stateResult: "deployment_failed", refs: { deploymentRequestId: final.deployment_request_id, releaseId: final.release_id, promotionVersionId: final.promotion_version_id } });
    return v3StepResult({ stepId: ctx.stepId, routingOutcome: "wait", stateResult: "triggered", refs: { deploymentRequestId: final.deployment_request_id, releaseId: final.release_id, promotionVersionId: final.promotion_version_id } });
  }

  receiveCompletedEvent(event) {
    if (!event || typeof event.eventId !== "string" || event.eventType !== "deployment.completed" || typeof event.correlationKey !== "string" || event.correlationKey !== event.payload?.deploymentRequestId) throw stateError("INVALID_DEPLOYMENT_EVENT", "deployment.completed event is invalid");
    const payload = event.payload;
    if (!payload || payload.target !== "production" || !["succeeded", "failed", "cancelled"].includes(payload.status) || typeof payload.releaseId !== "string" || typeof payload.externalRunRef !== "string" || payload.externalRunRef.length === 0) throw stateError("INVALID_DEPLOYMENT_EVENT", "deployment.completed payload is invalid");
    const row = deploymentRow(this.controlPlane, payload.deploymentRequestId);
    if (!row || row.release_id !== payload.releaseId) throw stateError("DEPLOYMENT_EVENT_CONFLICT", "deployment event does not match a v3 request");
    if (["succeeded", "failed", "cancelled", "superseded"].includes(row.status)) {
      if (row.status !== payload.status) throw stateError("DEPLOYMENT_EVENT_CONFLICT", "a terminal deployment request cannot change status");
      return { duplicate: true, eventId: event.eventId, commandId: externalEventCommandId(event.eventId), deploymentRequestId: row.deployment_request_id };
    }
    const eventJson = canonicalJson(event);
    const eventHash = semanticSha256(event);
    return this.controlPlane._transaction((db) => {
      const existing = db.prepare("SELECT * FROM v3_deployment_event_outbox WHERE event_id = ?").get(event.eventId);
      if (existing) {
        if (existing.request_sha256 !== eventHash) throw stateError("EVENT_HASH_CONFLICT", `event ${event.eventId} has a different payload`);
        return { duplicate: true, eventId: event.eventId, commandId: existing.command_id };
      }
      db.prepare("UPDATE v3_deployment_requests SET status = ?, external_run_ref = ?, event_json = ?, updated_at = ? WHERE deployment_request_id = ? AND status NOT IN ('succeeded','failed','cancelled','superseded')").run(payload.status, payload.externalRunRef, eventJson, this.controlPlane.now(), payload.deploymentRequestId);
      db.prepare("INSERT INTO v3_deployment_event_outbox (event_id, deployment_request_id, workflow_session_id, command_id, request_sha256, event_json, disposition, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)").run(event.eventId, row.deployment_request_id, row.workflow_session_id, externalEventCommandId(event.eventId), eventHash, eventJson, this.controlPlane.now());
      return { duplicate: false, eventId: event.eventId, commandId: externalEventCommandId(event.eventId), deploymentRequestId: row.deployment_request_id };
    });
  }

  async deliverPendingEvents(deliver, { registry = undefined, limit = 50, maxAttempts = 5 } = {}) {
    if (typeof deliver !== "function") throw stateError("CONFIGURATION_ERROR", "event delivery function is required");
    const rows = this.controlPlane.db.prepare("SELECT * FROM v3_deployment_event_outbox WHERE disposition = 'pending' ORDER BY created_at, event_id LIMIT ?").all(limit);
    const delivered = []; const deadLettered = [];
    for (const row of rows) {
      const event = JSON.parse(row.event_json);
      const receipt = typeof registry?.getReceipt === "function" ? registry.getReceipt(row.workflow_session_id, row.command_id) : null;
      try {
        if (receipt) {
          const receiptHash = receipt.requestSha256 ?? receipt.requestHash;
          if (receiptHash && receiptHash !== row.request_sha256) throw stateError("EVENT_HASH_CONFLICT", `receipt hash conflicts for ${row.event_id}`);
        } else await deliver(row.workflow_session_id, { ...event, eventId: row.event_id }, row.command_id, row.request_sha256);
        this.controlPlane._transaction((db) => db.prepare("UPDATE v3_deployment_event_outbox SET disposition = 'delivered', attempts = attempts + 1, last_error = NULL, delivered_at = ? WHERE event_id = ? AND disposition = 'pending'").run(this.controlPlane.now(), row.event_id));
        delivered.push(row.event_id);
      } catch (error) {
        const attempts = Number(row.attempts) + 1;
        const disposition = attempts >= maxAttempts ? "dead_lettered" : "pending";
        this.controlPlane._transaction((db) => db.prepare(`UPDATE v3_deployment_event_outbox SET disposition = ?, attempts = ?, last_error = ?, ${disposition === "dead_lettered" ? "dead_lettered_at" : "created_at"} = ? WHERE event_id = ? AND disposition = 'pending'`).run(disposition, attempts, String(error.message ?? error), this.controlPlane.now(), row.event_id));
        if (disposition === "dead_lettered") deadLettered.push(row.event_id);
      }
    }
    return { delivered, deadLettered };
  }

  async verify(ctx, request = {}) {
    const before = promotionHead(this.controlPlane);
    if (before.head?.versionId !== request.promotionVersionId) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { deploymentRequestId: request.deploymentRequestId, releaseId: request.releaseId, promotionVersionId: request.promotionVersionId } });
    const row = deploymentRow(this.controlPlane, request.deploymentRequestId);
    if (!row) throw stateError("DEPLOYMENT_REQUEST_NOT_FOUND", "v3 deployment request is required");
    if (["failed", "cancelled", "superseded"].includes(row.status)) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "deployment_failed", stateResult: "deployment_failed", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });
    if (!this.adapter) throw stateError("CONFIGURATION_ERROR", "v3 deployment adapter is required");
    const result = await this.adapter.verifyDeployment({ deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, target: row.target, externalRunRef: row.external_run_ref });
    const after = promotionHead(this.controlPlane);
    if (after.head?.versionId !== request.promotionVersionId) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });
    const verified = result?.verified === true && result.servedReleaseId === row.release_id && typeof result.verificationRef === "string" && result.verificationRef.length > 0;
    if (!verified) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "deployment_failed", stateResult: "not_verified", refs: { verificationRef: result?.verificationRef ?? `verification:${row.deployment_request_id}`, deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });
    return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "verified", refs: { verificationRef: result.verificationRef, deploymentRequestId: row.deployment_request_id, releaseId: row.release_id, promotionVersionId: row.promotion_version_id } });
  }

  record(ctx, request = {}) {
    const row = deploymentRow(this.controlPlane, request.deploymentRequestId);
    if (!row) throw stateError("DEPLOYMENT_REQUEST_NOT_FOUND", "v3 deployment request is required");
    const promotion = promotionHead(this.controlPlane);
    if (promotion.head?.versionId !== row.promotion_version_id) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id } });
    const { stream, head } = deploymentHead(this.controlPlane);
    const currentState = head?.payload?.state;
    if (currentState?.deploymentRequestId === row.deployment_request_id) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: "reused", refs: { deploymentVersionId: head.versionId, deploymentRequestId: row.deployment_request_id, releaseId: row.release_id } });
    if (Number(currentState?.deploymentSequence ?? 0) >= Number(row.deployment_sequence)) return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id } });
    const policyVersionId = request.deploymentPolicyVersionId
      ? readExactPolicyVersion(this.controlPlane, request.deploymentPolicyVersionId, "deployment-production").versionId
      : currentPolicyVersion(this.controlPlane, ctx, "deployment-production");
    const proposalId = deterministicId("proposal-v3", `${ctx.operationId}:deployment`);
    const state = { target: "production", releaseId: row.release_id, deploymentRequestId: row.deployment_request_id, deploymentSequence: Number(row.deployment_sequence), promotionVersionId: row.promotion_version_id, verificationRef: request.verificationRef };
    this.controlPlane.createProposal({ proposalId, streamId: stream.stream_id, expectedHeadVersionId: head?.versionId ?? null, proposedSemanticSha256: semanticSha256(state), payload: { schema_version: 1, state }, dependencies: [{ role: "policy", versionId: policyVersionId }], assessmentRefs: { verificationRef: request.verificationRef }, operationId: `${ctx.operationId}/proposal` });
    const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision-v3", `${ctx.operationId}:deployment`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "deployment-policy", transitionPolicyVersionId: policyVersionId, operationId: `${ctx.operationId}/decision` });
    try {
      const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: `${ctx.operationId}/commit`, domainHandler: { validate: ({ proposal }) => { if (semanticSha256(proposal.payload.state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "deployment state changed"); }, persist: ({ db, versionId, proposal }) => db.prepare("INSERT INTO deployment_states (version_id, release_id, verification_ref, state_json) VALUES (?, ?, ?, ?)").run(versionId, row.release_id, proposal.assessmentRefs.verificationRef, canonicalJson(proposal.payload.state)) } });
      return v3StepResult({ stepId: ctx.stepId, routingOutcome: "continue", stateResult: commit.stateResult === "unchanged" ? "reused" : "committed", refs: { deploymentVersionId: commit.versionId, deploymentRequestId: row.deployment_request_id, releaseId: row.release_id } });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return v3StepResult({ stepId: ctx.stepId, routingOutcome: "superseded", stateResult: "conflict", refs: { deploymentRequestId: row.deployment_request_id, releaseId: row.release_id } });
      throw error;
    }
  }
}
