import { canonicalJson, deterministicId, prefixedSha256, semanticSha256 } from "../state/canonical.js";
import { StateControlPlaneError, stateError } from "../state/errors.js";
import { currentPolicyVersion, isV2Context, readExactPolicyVersion, requireContext, stepResult, STREAM_KEYS } from "./services.js";
import { assertDeploymentAdapter } from "../deployment/adapter.js";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const ALLOWED_STATUSES = new Set(["prepared", "requested", ...TERMINAL_STATUSES]);

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
  if (!event || typeof event !== "object" || Object.keys(event).sort().join("\u001f") !== eventKeys.sort().join("\u001f") || event.eventType !== "deployment.completed" || typeof event.correlationKey !== "string" || !event.payload || Object.keys(event.payload).sort().join("\u001f") !== payloadKeys.sort().join("\u001f") || event.correlationKey !== event.payload.deploymentRequestId || event.payload.target !== "production" || !["succeeded", "failed", "cancelled"].includes(event.payload.status) || typeof event.payload.releaseId !== "string" || typeof event.payload.externalRunRef !== "string" || event.payload.externalRunRef.length === 0 || typeof event.payload.completedAt !== "string" || Number.isNaN(Date.parse(event.payload.completedAt))) throw stateError("INVALID_DEPLOYMENT_EVENT", "deployment event does not satisfy deployment-completed-event contract");
  return event;
}

function eventIdentity(event) {
  return { eventType: event.eventType, deploymentRequestId: event.payload.deploymentRequestId, target: event.payload.target, releaseId: event.payload.releaseId, status: event.payload.status, externalRunRef: event.payload.externalRunRef };
}

function statusFromAdapter(result) {
  if (result?.status === "failed" || result?.status === "cancelled") return result.status;
  if (result?.status === "succeeded" || result?.alreadyDeployed === true) return "succeeded";
  return "requested";
}

function reconcileStatus(existingStatus, incomingStatus) {
  if (!ALLOWED_STATUSES.has(existingStatus) || !ALLOWED_STATUSES.has(incomingStatus)) throw stateError("DEPLOYMENT_STATE_INVALID", "deployment request status is invalid");
  if (TERMINAL_STATUSES.has(existingStatus)) {
    if (TERMINAL_STATUSES.has(incomingStatus) && existingStatus !== incomingStatus) throw stateError("DEPLOYMENT_STATE_CONFLICT", `terminal deployment status cannot change from ${existingStatus} to ${incomingStatus}`);
    return existingStatus;
  }
  if (TERMINAL_STATUSES.has(incomingStatus)) return incomingStatus;
  if (existingStatus === "requested" || incomingStatus === "requested") return "requested";
  return "prepared";
}

function assertExternalRunRef(existing, incoming) {
  if (existing && incoming && existing !== incoming) throw stateError("DEPLOYMENT_STATE_CONFLICT", "deployment request has conflicting external run references");
  return existing ?? incoming ?? null;
}

function triggerOperationReceipt(controlPlane, operationId, request) {
  const receipt = controlPlane.readReceipt(operationId);
  if (!receipt) return null;
  if (receipt.operationKind !== "deployment.trigger" || receipt.requestSha256 !== semanticSha256(request)) throw stateError("IDEMPOTENCY_CONFLICT", `operation ${operationId} was already completed with a different deployment request`);
  return receipt.result;
}

function insertTriggerReceipt(db, controlPlane, { operationId, request, result }) {
  db.prepare("INSERT INTO application_operation_receipts (operation_id, operation_kind, request_sha256, result_json, completed_at) VALUES (?, ?, ?, ?, ?)").run(operationId, "deployment.trigger", semanticSha256(request), canonicalJson(result), controlPlane.now());
}

function rowIdentityMatches(row, identity) {
  return row.workflow_session_id === identity.workflowSessionId && row.promotion_version_id === identity.promotionVersionId && row.release_id === identity.releaseId && row.target === identity.target;
}

function routingForLedger(row) {
  if (row.status === "succeeded") return { stateResult: "already_deployed", outcome: "verify" };
  if (row.status === "failed" || row.status === "cancelled") return { stateResult: "deployment_failed", outcome: "deployment_failed" };
  return { stateResult: "triggered", outcome: "wait" };
}

export class DeploymentApplicationService {
  constructor(controlPlane, { adapter } = {}) { this.controlPlane = controlPlane; this.adapter = assertDeploymentAdapter(adapter); }

  async trigger(ctx, request = {}) {
    requireContext(ctx, ["state:read", "deployment:trigger"]);
    const target = request.target ?? "production";
    if (target !== "production") throw stateError("VALIDATION_ERROR", "only production deployment is supported");
    if (isV2Context(ctx) && (typeof request.promotionVersionId !== "string" || request.promotionVersionId.length === 0)) throw stateError("EXPLICIT_VERSION_REQUIRED", "promotionVersionId is required for deployment trigger");
    const deploymentRequestId = request.deploymentRequestId ?? deterministicId("deployment-request", `${ctx.workflowSessionId}:${request.releaseId}:${target}`);
    const knownPromotionVersionId = request.promotionVersionId;
    const promotion = knownPromotionVersionId ? null : readPromotion(this.controlPlane);
    const promotionVersionId = knownPromotionVersionId ?? promotion.head.versionId;
    const operationRequest = { workflowSessionId: ctx.workflowSessionId, promotionVersionId, releaseId: request.releaseId, target, deploymentRequestId };
    const prior = triggerOperationReceipt(this.controlPlane, ctx.operationId, operationRequest);
    if (prior) return prior;
    const currentPromotion = promotion ?? readPromotion(this.controlPlane);
    const identity = { workflowSessionId: ctx.workflowSessionId, promotionVersionId, releaseId: request.releaseId, target };
    if (currentPromotion.head.versionId !== promotionVersionId || currentPromotion.releaseId !== request.releaseId) {
      const result = stepResult("conflict", { releaseId: request.releaseId, promotionVersionId, deploymentRequestId }, request, undefined, { outcome: "superseded", conflictAt: "promotion" });
      this.controlPlane._transaction((db) => insertTriggerReceipt(db, this.controlPlane, { operationId: ctx.operationId, request: operationRequest, result }));
      return result;
    }
    const { head: deploymentHead } = readDeploymentHead(this.controlPlane);
    if (deploymentHead?.payload?.state?.releaseId === request.releaseId) {
      const result = stepResult("already_deployed", { releaseId: request.releaseId, promotionVersionId, deploymentRequestId }, request, deploymentHead.semanticSha256, { outcome: "verify" });
      this.controlPlane._transaction((db) => insertTriggerReceipt(db, this.controlPlane, { operationId: ctx.operationId, request: operationRequest, result }));
      return result;
    }

    let ledger = this.controlPlane.db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
    if (ledger && !rowIdentityMatches(ledger, identity)) throw stateError("DEPLOYMENT_IDEMPOTENCY_CONFLICT", `deployment request ${deploymentRequestId} is bound to another workflow intent`);
    if (!ledger) {
      this.controlPlane._transaction((db) => {
        const existing = db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
        if (existing) {
          if (!rowIdentityMatches(existing, identity)) throw stateError("DEPLOYMENT_IDEMPOTENCY_CONFLICT", `deployment request ${deploymentRequestId} is bound to another workflow intent`);
          return;
        }
        const now = this.controlPlane.now();
        db.prepare("INSERT INTO deployment_requests (deployment_request_id, workflow_session_id, promotion_version_id, release_id, target, external_run_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(deploymentRequestId, identity.workflowSessionId, identity.promotionVersionId, identity.releaseId, identity.target, null, "prepared", now, now);
      });
      ledger = this.controlPlane.db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
    }

    let ensured;
    try {
      ensured = TERMINAL_STATUSES.has(ledger.status) ? { status: ledger.status, externalRunRef: ledger.external_run_ref } : await this.adapter.ensureDeployment({ deploymentRequestId, releaseId: request.releaseId, target });
    } catch (error) {
      throw stateError(error.code ?? "DEPLOYMENT_TRIGGER_FAILED", error.message, { cause: error });
    }
    const incomingStatus = statusFromAdapter(ensured);
    return this.controlPlane._transaction((db) => {
      const current = db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
      if (!current || !rowIdentityMatches(current, identity)) throw stateError("DEPLOYMENT_IDEMPOTENCY_CONFLICT", `deployment request ${deploymentRequestId} identity changed`);
      const status = reconcileStatus(current.status, incomingStatus);
      const externalRunRef = assertExternalRunRef(current.external_run_ref, ensured?.externalRunRef);
      db.prepare("UPDATE deployment_requests SET external_run_ref = ?, status = ?, updated_at = ? WHERE deployment_request_id = ?").run(externalRunRef, status, this.controlPlane.now(), deploymentRequestId);
      const route = routingForLedger({ ...current, external_run_ref: externalRunRef, status });
      const response = stepResult(route.stateResult, { releaseId: request.releaseId, promotionVersionId, deploymentRequestId }, request, externalRunRef ?? deploymentRequestId, { outcome: route.outcome, externalRunRef });
      insertTriggerReceipt(db, this.controlPlane, { operationId: ctx.operationId, request: operationRequest, result: response });
      return response;
    });
  }

  receiveCompletedEvent(event) {
    validateEvent(event);
    const deploymentRequestId = event.payload.deploymentRequestId;
    const eventFingerprint = prefixedSha256(eventIdentity(event));
    return this.controlPlane._transaction((db) => {
      const request = db.prepare("SELECT * FROM deployment_requests WHERE deployment_request_id = ?").get(deploymentRequestId);
      if (!request) throw stateError("DEPLOYMENT_REQUEST_NOT_FOUND", `deployment request ${deploymentRequestId} does not exist`);
      if (request.release_id !== event.payload.releaseId || request.target !== event.payload.target) throw stateError("DEPLOYMENT_EVENT_CONFLICT", "deployment event does not match ledger identity");
      const existing = db.prepare("SELECT * FROM deployment_completed_events WHERE event_fingerprint = ?").get(eventFingerprint);
      if (existing) return { duplicate: true, eventFingerprint, event: JSON.parse(existing.event_json) };
      const priorEvents = db.prepare("SELECT event_json FROM deployment_completed_events WHERE deployment_request_id = ?").all(deploymentRequestId);
      for (const row of priorEvents) {
        const prior = JSON.parse(row.event_json).payload;
        if (prior.status !== event.payload.status || (prior.externalRunRef && prior.externalRunRef !== event.payload.externalRunRef)) throw stateError("DEPLOYMENT_EVENT_CONFLICT", "deployment request already has a conflicting terminal event");
      }
      const status = reconcileStatus(request.status, event.payload.status);
      const externalRunRef = assertExternalRunRef(request.external_run_ref, event.payload.externalRunRef);
      const eventJson = canonicalJson(event);
      db.prepare("INSERT INTO deployment_completed_events (event_fingerprint, deployment_request_id, event_json, received_at) VALUES (?, ?, ?, ?)").run(eventFingerprint, deploymentRequestId, eventJson, this.controlPlane.now());
      db.prepare("UPDATE deployment_requests SET external_run_ref = ?, status = ?, updated_at = ? WHERE deployment_request_id = ?").run(externalRunRef, status, this.controlPlane.now(), deploymentRequestId);
      db.prepare("INSERT INTO deployment_event_outbox (event_fingerprint, deployment_request_id, workflow_session_id, event_json, status, attempts, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?)").run(eventFingerprint, deploymentRequestId, request.workflow_session_id, eventJson, this.controlPlane.now());
      return { duplicate: false, eventFingerprint, eventId: eventFingerprint, status, deploymentRequestId, workflowSessionId: request.workflow_session_id };
    });
  }

  async deliverPendingEvents(deliver, { limit = 50 } = {}) {
    if (typeof deliver !== "function") throw stateError("CONFIGURATION_ERROR", "an external-event delivery function is required");
    const rows = this.controlPlane.db.prepare("SELECT * FROM deployment_event_outbox WHERE status = 'pending' ORDER BY created_at, event_fingerprint LIMIT ?").all(limit);
    const delivered = [];
    for (const row of rows) {
      const event = JSON.parse(row.event_json);
      const providerEvent = { eventId: row.event_fingerprint, eventType: event.eventType, correlationKey: event.correlationKey, payload: event.payload };
      try {
        await deliver(row.workflow_session_id, providerEvent, row.event_fingerprint);
        this.controlPlane._transaction((db) => db.prepare("UPDATE deployment_event_outbox SET status = 'delivered', attempts = attempts + 1, last_error = NULL, delivered_at = ? WHERE event_fingerprint = ? AND status = 'pending'").run(this.controlPlane.now(), row.event_fingerprint));
        delivered.push(row.event_fingerprint);
      } catch (error) {
        this.controlPlane._transaction((db) => db.prepare("UPDATE deployment_event_outbox SET attempts = attempts + 1, last_error = ? WHERE event_fingerprint = ? AND status = 'pending'").run(String(error.message ?? error), row.event_fingerprint));
      }
    }
    return { delivered, pending: this.controlPlane.db.prepare("SELECT COUNT(*) AS count FROM deployment_event_outbox WHERE status = 'pending'").get().count };
  }

  async verify(ctx, request = {}) {
    requireContext(ctx, ["state:read", "deployment:verify"]);
    if ((request.target ?? "production") !== "production") throw stateError("VALIDATION_ERROR", "only production deployment is supported");
    const result = await this.adapter.verifyDeployment({ releaseId: request.releaseId, target: request.target ?? "production", externalRunRef: request.externalRunRef });
    const verified = result?.verified === true && result.servedReleaseId === request.releaseId && typeof result.verificationRef === "string" && result.verificationRef.length > 0;
    return stepResult(verified ? "verified" : "not_verified", { releaseId: request.releaseId, verificationRef: verified ? result.verificationRef : undefined }, request, verified ? result.verificationRef : undefined, { outcome: verified ? "continue" : "rejected", servedReleaseId: result?.servedReleaseId ?? null });
  }

  record(ctx, request = {}) {
    requireContext(ctx, ["state:read", "state:auto-decide", "state:commit", "state:propose"]);
    if (typeof request.releaseId !== "string" || request.releaseId.length === 0) throw stateError("VALIDATION_ERROR", "releaseId is required");
    if ((request.target ?? "production") !== "production") throw stateError("VALIDATION_ERROR", "only production deployment is supported");
    if (typeof request.verificationRef !== "string" || request.verificationRef.length === 0) return stepResult("not_verified", { releaseId: request.releaseId }, request, undefined, { outcome: "rejected" });
    const { stream, head } = readDeploymentHead(this.controlPlane);
    if (head?.payload?.state?.releaseId === request.releaseId) return stepResult("unchanged", { deploymentVersionId: head.versionId, releaseId: request.releaseId, verificationRef: request.verificationRef }, request, head.semanticSha256, { outcome: "continue" });
    const proposalId = deterministicId("proposal", `${ctx.operationId}:deployment:${request.releaseId}`);
    const existing = this.controlPlane.readProposal(proposalId);
    const policyVersionId = existing?.dependencies?.find((item) => item.role === "policy")?.versionId ?? (request.transitionPolicyVersionId ? readExactPolicyVersion(this.controlPlane, request.transitionPolicyVersionId, "deployment-production").versionId : currentPolicyVersion(this.controlPlane, ctx, "deployment-production"));
    const expectedHeadVersionId = existing?.expectedHeadVersionId ?? request.expectedDeploymentHeadVersionId ?? head?.versionId ?? null;
    const payload = { schema_version: 1, state: { target: request.target ?? "production", releaseId: request.releaseId } };
    try {
      this.controlPlane.createProposal({ proposalId, streamId: stream.stream_id, expectedHeadVersionId, proposedSemanticSha256: semanticSha256(payload.state), payload, dependencies: [{ role: "policy", versionId: policyVersionId }], assessmentRefs: { verificationRef: request.verificationRef }, operationId: `${ctx.operationId}/proposal` });
      const decision = this.controlPlane.createDecision({ decisionId: deterministicId("decision", `${ctx.operationId}:deployment`), proposalId, outcome: "accepted", authorityKind: "system_policy", authorityRef: "deployment-policy", transitionPolicyVersionId: policyVersionId, operationId: `${ctx.operationId}/decision` });
      const commit = this.controlPlane.commitProposal({ proposalId, decisionId: decision.decisionId, operationId: ctx.operationId, domainHandler: {
        validate: ({ proposal }) => { if (typeof proposal.assessmentRefs?.verificationRef !== "string" || proposal.assessmentRefs.verificationRef.length === 0) throw stateError("UNVERIFIED_DEPLOYMENT", "verification evidence is required"); if (semanticSha256(proposal.payload.state) !== proposal.proposedSemanticSha256) throw stateError("SEMANTIC_FINGERPRINT_MISMATCH", "deployment semantic fingerprint is invalid"); },
        persist: ({ db, versionId, proposal }) => db.prepare("INSERT INTO deployment_states (version_id, release_id, verification_ref, state_json) VALUES (?, ?, ?, ?)").run(versionId, request.releaseId, proposal.assessmentRefs.verificationRef, canonicalJson(payload.state)),
      } });
      return stepResult(commit.stateResult, { proposalId, decisionId: commit.decisionId, deploymentVersionId: commit.versionId, releaseId: request.releaseId, verificationRef: request.verificationRef }, request, commit.semanticSha256, { outcome: "continue" });
    } catch (error) {
      if (error instanceof StateControlPlaneError && error.code === "HEAD_CONFLICT") return stepResult("conflict", { proposalId, releaseId: request.releaseId }, request, undefined, { outcome: "superseded", conflictAt: "deployment" });
      throw error;
    }
  }
}

export { validateEvent as validateDeploymentCompletedEvent };
