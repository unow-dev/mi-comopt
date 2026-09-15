import { randomUUID } from "node:crypto";
import { openCommentDatabase } from "../database/comment-database.js";
import { canonicalJson, cloneJson, deterministicId, isoNow, newId, semanticSha256 } from "./canonical.js";
import { StateControlPlaneError, stateError } from "./errors.js";
import { ensureStateControlPlane } from "./schema.js";

const STREAM_RE = /^[a-z][a-z0-9-]*$/;
const ORIGIN_KINDS = new Set(["genesis_migration", "commit"]);

function parseJson(value, context) {
  try { return JSON.parse(value); } catch (error) { throw stateError("DATABASE_INTEGRITY_ERROR", `${context} is invalid JSON: ${error.message}`); }
}

function nonEmptyString(value, context) {
  if (typeof value !== "string" || value.length === 0) throw stateError("VALIDATION_ERROR", `${context} must be a non-empty string`);
  return value;
}

function normalizeDependencies(dependencies = []) {
  if (!Array.isArray(dependencies)) throw stateError("VALIDATION_ERROR", "dependencies must be an array");
  const result = [];
  const seen = new Set();
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== "object") throw stateError("VALIDATION_ERROR", "dependency must be an object");
    const role = nonEmptyString(dependency.role ?? dependency.dependencyRole, "dependency role");
    const versionId = nonEmptyString(dependency.versionId ?? dependency.dependencyVersionId, "dependency versionId");
    const key = `${role}\u001f${versionId}`;
    if (!seen.has(key)) { seen.add(key); result.push({ role, versionId }); }
  }
  return result.sort((left, right) => `${left.role}\u001f${left.versionId}`.localeCompare(`${right.role}\u001f${right.versionId}`));
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw stateError("VALIDATION_ERROR", "state payload must be an object");
  const result = cloneJson(payload);
  if (result.schema_version === undefined && result.schemaVersion === undefined) result.schema_version = 1;
  return result;
}

export class StateControlPlane {
  constructor(db, { clock = () => new Date(), idFactory = randomUUID } = {}) {
    this.db = ensureStateControlPlane(db);
    this.clock = clock;
    this.idFactory = idFactory;
  }

  now() { return isoNow(this.clock); }

  close() { if (typeof this.db.close === "function") this.db.close(); }

  streamId(domain, streamKey) {
    nonEmptyString(domain, "domain");
    nonEmptyString(streamKey, "streamKey");
    return this.db.prepare("SELECT stream_id FROM state_streams WHERE domain = ? AND stream_key = ?").get(domain, streamKey)?.stream_id ?? null;
  }

  ensureStream({ domain, streamKey, streamId = undefined }) {
    nonEmptyString(domain, "domain");
    nonEmptyString(streamKey, "streamKey");
    const existing = this.db.prepare("SELECT * FROM state_streams WHERE domain = ? AND stream_key = ?").get(domain, streamKey);
    if (existing) return { ...existing };
    const id = streamId ?? `${domain}/${streamKey}`;
    this.db.prepare("INSERT INTO state_streams (stream_id, domain, stream_key, created_at) VALUES (?, ?, ?, ?)").run(id, domain, streamKey, this.now());
    return this.db.prepare("SELECT * FROM state_streams WHERE stream_id = ?").get(id);
  }

  getStream(streamId) {
    return this.db.prepare("SELECT * FROM state_streams WHERE stream_id = ?").get(streamId) ?? null;
  }

  resolveHead(stream) {
    const streamId = typeof stream === "string" ? stream : this.streamId(stream.domain, stream.streamKey);
    if (!streamId) return null;
    const row = this.db.prepare(
      `SELECT h.stream_id, h.head_version_id, h.updated_at,
              v.version_no, v.semantic_sha256, v.origin_kind, v.payload_json, v.created_at
       FROM state_stream_heads AS h
       JOIN state_versions AS v ON v.version_id = h.head_version_id
       WHERE h.stream_id = ?`,
    ).get(streamId);
    return row ? this._versionRow(row) : null;
  }

  readVersion(versionId) {
    const row = this.db.prepare(
      `SELECT v.*, s.domain, s.stream_key
       FROM state_versions AS v JOIN state_streams AS s ON s.stream_id = v.stream_id
       WHERE v.version_id = ?`,
    ).get(versionId);
    return row ? this._versionRow(row) : null;
  }

  readDependencies(versionId) {
    return this.db.prepare(
      `SELECT dependency_role AS role, dependency_version_id AS versionId
       FROM state_version_dependencies WHERE version_id = ?
       ORDER BY dependency_role, dependency_version_id`,
    ).all(versionId).map((row) => ({ ...row }));
  }

  readProposal(proposalId) {
    const row = this.db.prepare("SELECT * FROM state_proposals WHERE proposal_id = ?").get(proposalId);
    if (!row) return null;
    return {
      proposalId: row.proposal_id,
      streamId: row.stream_id,
      expectedHeadVersionId: row.expected_head_version_id,
      proposedSemanticSha256: row.proposed_semantic_sha256,
      payload: parseJson(row.proposal_payload_json, "proposal_payload_json"),
      proposalSha256: row.proposal_sha256,
      assessmentRefs: parseJson(row.assessment_refs_json, "assessment_refs_json"),
      dependencies: this.db.prepare(
        `SELECT dependency_role AS role, dependency_version_id AS versionId
         FROM state_proposal_dependencies WHERE proposal_id = ?
         ORDER BY dependency_role, dependency_version_id`,
      ).all(proposalId).map((item) => ({ ...item })),
      createdAt: row.created_at,
    };
  }

  readDecision(proposalId) {
    const row = this.db.prepare("SELECT * FROM state_decisions WHERE proposal_id = ?").get(proposalId);
    return row ? {
      decisionId: row.decision_id,
      proposalId: row.proposal_id,
      outcome: row.outcome,
      authorityKind: row.authority_kind,
      authorityRef: row.authority_ref,
      transitionPolicyVersionId: row.transition_policy_version_id,
      rationale: row.rationale,
      decidedAt: row.decided_at,
    } : null;
  }

  readReceipt(operationId) {
    const row = this.db.prepare("SELECT * FROM application_operation_receipts WHERE operation_id = ?").get(operationId);
    return row ? { operationId: row.operation_id, operationKind: row.operation_kind, requestSha256: row.request_sha256, result: parseJson(row.result_json, "result_json"), completedAt: row.completed_at } : null;
  }

  runIdempotent({ operationId, operationKind, request }, mutation) {
    nonEmptyString(operationId, "operationId");
    nonEmptyString(operationKind, "operationKind");
    const requestSha256 = semanticSha256(request);
    const prior = this.readReceipt(operationId);
    if (prior) {
      if (prior.operationKind !== operationKind || prior.requestSha256 !== requestSha256) throw stateError("IDEMPOTENCY_CONFLICT", `operation ${operationId} was already completed with a different request or operation kind`);
      return cloneJson(prior.result);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const concurrent = this.readReceipt(operationId);
      if (concurrent) {
        if (concurrent.operationKind !== operationKind || concurrent.requestSha256 !== requestSha256) throw stateError("IDEMPOTENCY_CONFLICT", `operation ${operationId} was already completed with a different request or operation kind`);
        this.db.exec("COMMIT");
        return cloneJson(concurrent.result);
      }
      const result = mutation(this.db);
      this.db.prepare(
        `INSERT INTO application_operation_receipts
          (operation_id, operation_kind, request_sha256, result_json, completed_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(operationId, operationKind, requestSha256, canonicalJson(result), this.now());
      this.db.exec("COMMIT");
      return cloneJson(result);
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original */ }
      if (error instanceof StateControlPlaneError) throw error;
      throw stateError("STATE_TRANSACTION_FAILED", error.message, { cause: error });
    }
  }

  createProposal({ proposalId = newId("proposal"), streamId, expectedHeadVersionId = null, proposedSemanticSha256, payload, dependencies = [], assessmentRefs = {}, createdAt = this.now(), operationId = undefined } = {}) {
    const request = { streamId, expectedHeadVersionId, proposedSemanticSha256, payload, dependencies, assessmentRefs };
    const mutate = (db) => {
      nonEmptyString(streamId, "streamId");
      const stream = this.getStream(streamId);
      if (!stream) throw stateError("STREAM_NOT_FOUND", `stream ${streamId} does not exist`);
      const normalizedPayload = normalizePayload(payload);
      const normalizedDependencies = normalizeDependencies(dependencies);
      for (const dependency of normalizedDependencies) if (!this.readVersion(dependency.versionId)) throw stateError("DEPENDENCY_NOT_FOUND", `dependency ${dependency.versionId} does not exist`);
      const proposedHash = proposedSemanticSha256 ?? semanticSha256(normalizedPayload.state ?? normalizedPayload);
      nonEmptyString(proposedHash, "proposedSemanticSha256");
      const proposalSha256 = semanticSha256({ streamId, expectedHeadVersionId, proposedSemanticSha256: proposedHash, payload: normalizedPayload, dependencies: normalizedDependencies, assessmentRefs });
      const existing = this.readProposal(proposalId);
      if (existing) {
        if (existing.proposalSha256 !== proposalSha256) throw stateError("IMMUTABLE_VIOLATION", `proposal ${proposalId} already exists with different content`);
        return existing;
      }
      const actual = this.resolveHead(streamId)?.versionId ?? null;
      if (actual !== expectedHeadVersionId) throw stateError("HEAD_CONFLICT", `proposal expected head ${expectedHeadVersionId ?? "null"} but actual head is ${actual ?? "null"}`);
      if (expectedHeadVersionId !== null && this.readVersion(expectedHeadVersionId)?.streamId !== streamId) throw stateError("VALIDATION_ERROR", "expected head belongs to another stream");
      db.prepare(
        `INSERT INTO state_proposals
          (proposal_id, stream_id, expected_head_version_id, proposed_semantic_sha256,
           proposal_payload_json, proposal_sha256, assessment_refs_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(proposalId, streamId, expectedHeadVersionId, proposedHash, canonicalJson(normalizedPayload), proposalSha256, canonicalJson(assessmentRefs), createdAt);
      const insert = db.prepare("INSERT INTO state_proposal_dependencies (proposal_id, dependency_role, dependency_version_id) VALUES (?, ?, ?)");
      for (const dependency of normalizedDependencies) insert.run(proposalId, dependency.role, dependency.versionId);
      return this.readProposal(proposalId);
    };
    return operationId ? this.runIdempotent({ operationId, operationKind: "state.proposal.create", request }, mutate) : this._transaction(mutate);
  }

  createDecision({ decisionId = newId("decision"), proposalId, outcome, authorityKind, authorityRef, transitionPolicyVersionId, rationale = null, decidedAt = this.now(), operationId = undefined } = {}) {
    const request = { proposalId, outcome, authorityKind, authorityRef, transitionPolicyVersionId, rationale };
    const mutate = (db) => {
      if (!this.readProposal(proposalId)) throw stateError("PROPOSAL_NOT_FOUND", `proposal ${proposalId} does not exist`);
      if (!new Set(["accepted", "rejected"]).has(outcome)) throw stateError("VALIDATION_ERROR", "decision outcome must be accepted or rejected");
      for (const [value, name] of [[authorityKind, "authorityKind"], [authorityRef, "authorityRef"], [transitionPolicyVersionId, "transitionPolicyVersionId"]]) nonEmptyString(value, name);
      const existing = this.readDecision(proposalId);
      if (existing) {
        if (existing.outcome !== outcome || existing.authorityRef !== authorityRef) throw stateError("IMMUTABLE_VIOLATION", `proposal ${proposalId} already has a different final decision`);
        return existing;
      }
      db.prepare(
        `INSERT INTO state_decisions
          (decision_id, proposal_id, outcome, authority_kind, authority_ref,
           transition_policy_version_id, rationale, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(decisionId, proposalId, outcome, authorityKind, authorityRef, transitionPolicyVersionId, rationale, decidedAt);
      return this.readDecision(proposalId);
    };
    return operationId ? this.runIdempotent({ operationId, operationKind: "state.decision.create", request }, mutate) : this._transaction(mutate);
  }

  commitProposal({ proposalId, decisionId = undefined, versionId = undefined, transitionId = undefined, operationId, domainHandler = undefined, committedAt = this.now() } = {}) {
    const proposal = this.readProposal(proposalId);
    const decision = this.readDecision(proposalId);
    const effectiveVersionId = versionId ?? deterministicId("version", operationId);
    const effectiveTransitionId = transitionId ?? deterministicId("transition", operationId);
    const request = { proposalId, decisionId: decisionId ?? decision?.decisionId, versionId: effectiveVersionId, transitionId: effectiveTransitionId };
    return this.runIdempotent({ operationId, operationKind: "state.commit", request }, (db) => {
      const currentProposal = this.readProposal(proposalId);
      const currentDecision = this.readDecision(proposalId);
      if (!currentProposal) throw stateError("PROPOSAL_NOT_FOUND", `proposal ${proposalId} does not exist`);
      if (!currentDecision || currentDecision.outcome !== "accepted") throw stateError("DECISION_REQUIRED", `accepted decision is required for proposal ${proposalId}`);
      if (decisionId !== undefined && decisionId !== currentDecision.decisionId) throw stateError("VALIDATION_ERROR", "decision does not belong to proposal");
      const stream = this.getStream(currentProposal.streamId);
      const actualHead = this.resolveHead(stream.stream_id);
      const actualHeadId = actualHead?.versionId ?? null;
      if (actualHeadId !== currentProposal.expectedHeadVersionId) throw stateError("HEAD_CONFLICT", `proposal expected head ${currentProposal.expectedHeadVersionId ?? "null"} but actual head is ${actualHeadId ?? "null"}`);
      if (actualHead && actualHead.semanticSha256 === currentProposal.proposedSemanticSha256) return { stateResult: "unchanged", versionId: actualHead.versionId, semanticSha256: actualHead.semanticSha256, transitionId: null, decisionId: currentDecision.decisionId, proposalId };
      if (!ORIGIN_KINDS.has("commit")) throw stateError("VALIDATION_ERROR", "commit origin is invalid");
      const dependencies = currentProposal.dependencies;
      this._assertDependenciesInTransaction(dependencies, effectiveVersionId);
      if (typeof domainHandler?.validate === "function") domainHandler.validate({ db, proposal: currentProposal, decision: currentDecision, currentHead: actualHead });
      const versionNo = Number(db.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version_no FROM state_versions WHERE stream_id = ?").get(stream.stream_id).next_version_no);
      db.prepare(
        `INSERT INTO state_versions
          (version_id, stream_id, version_no, semantic_sha256, origin_kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, 'commit', ?, ?)`,
      ).run(effectiveVersionId, stream.stream_id, versionNo, currentProposal.proposedSemanticSha256, canonicalJson(currentProposal.payload), committedAt);
      const insertDependency = db.prepare("INSERT INTO state_version_dependencies (version_id, dependency_role, dependency_version_id) VALUES (?, ?, ?)");
      for (const dependency of dependencies) insertDependency.run(effectiveVersionId, dependency.role, dependency.versionId);
      if (typeof domainHandler?.persist === "function") domainHandler.persist({ db, versionId: effectiveVersionId, proposal: currentProposal, decision: currentDecision });
      db.prepare(
        `INSERT INTO state_transitions
          (transition_id, stream_id, from_version_id, to_version_id, decision_id, committed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(effectiveTransitionId, stream.stream_id, actualHeadId, effectiveVersionId, currentDecision.decisionId, committedAt);
      db.prepare(
        `INSERT INTO state_stream_heads (stream_id, head_version_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(stream_id) DO UPDATE SET head_version_id = excluded.head_version_id, updated_at = excluded.updated_at`,
      ).run(stream.stream_id, effectiveVersionId, committedAt);
      return { stateResult: "committed", versionId: effectiveVersionId, semanticSha256: currentProposal.proposedSemanticSha256, transitionId: effectiveTransitionId, decisionId: currentDecision.decisionId, proposalId };
    });
  }

  createGenesis({ streamId, versionId = newId("version"), payload, semanticSha256: suppliedSha = undefined, dependencies = [], originKind = "genesis_migration", createdAt = this.now(), domainHandler = undefined, operationId } = {}) {
    const request = { streamId, versionId, payload, semanticSha256: suppliedSha, dependencies, originKind };
    const mutate = (db) => {
      const stream = this.getStream(streamId);
      if (!stream) throw stateError("STREAM_NOT_FOUND", `stream ${streamId} does not exist`);
      if (this.resolveHead(streamId)) throw stateError("HEAD_EXISTS", `stream ${streamId} already has a head`);
      if (originKind !== "genesis_migration") throw stateError("VALIDATION_ERROR", "genesis origin must be genesis_migration");
      const normalizedPayload = normalizePayload(payload);
      const normalizedDependencies = normalizeDependencies(dependencies);
      this._assertDependenciesInTransaction(normalizedDependencies, versionId);
      const hash = suppliedSha ?? semanticSha256(normalizedPayload.state ?? normalizedPayload);
      db.prepare(
        `INSERT INTO state_versions
          (version_id, stream_id, version_no, semantic_sha256, origin_kind, payload_json, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)`,
      ).run(versionId, streamId, hash, originKind, canonicalJson(normalizedPayload), createdAt);
      const insertDependency = db.prepare("INSERT INTO state_version_dependencies (version_id, dependency_role, dependency_version_id) VALUES (?, ?, ?)");
      for (const dependency of normalizedDependencies) insertDependency.run(versionId, dependency.role, dependency.versionId);
      if (typeof domainHandler?.persist === "function") domainHandler.persist({ db, versionId, payload: normalizedPayload });
      db.prepare("INSERT INTO state_stream_heads (stream_id, head_version_id, updated_at) VALUES (?, ?, ?)").run(streamId, versionId, createdAt);
      return { stateResult: "committed", versionId, semanticSha256: hash, originKind };
    };
    return operationId ? this.runIdempotent({ operationId, operationKind: "state.genesis.create", request }, mutate) : this._transaction(mutate);
  }

  recordAssessment({ assessmentId, streamId, inputFingerprint, payload, createdAt = this.now(), operationId }) {
    const request = { assessmentId, streamId, inputFingerprint, payload };
    return this.runIdempotent({ operationId, operationKind: "state.assessment.create", request }, (db) => {
      const existing = db.prepare("SELECT * FROM state_assessments WHERE assessment_id = ?").get(assessmentId);
      if (existing) {
        if (existing.input_fingerprint !== inputFingerprint) throw stateError("IMMUTABLE_VIOLATION", `assessment ${assessmentId} is immutable`);
        return { assessmentId, streamId: existing.stream_id, inputFingerprint: existing.input_fingerprint };
      }
      db.prepare("INSERT INTO state_assessments (assessment_id, stream_id, input_fingerprint, assessment_payload_json, created_at) VALUES (?, ?, ?, ?, ?)").run(assessmentId, streamId, inputFingerprint, canonicalJson(payload), createdAt);
      return { assessmentId, streamId, inputFingerprint };
    });
  }

  recordEvidence({ evidenceId, sourceKind, sourceRef, payload, evidenceSha256: suppliedSha = undefined, createdAt = this.now(), operationId }) {
    const request = { evidenceId, sourceKind, sourceRef, payload, evidenceSha256: suppliedSha };
    return this.runIdempotent({ operationId, operationKind: "evidence.ingest", request }, (db) => {
      const hash = suppliedSha ?? semanticSha256({ sourceKind, sourceRef, payload });
      const existing = db.prepare("SELECT * FROM state_evidence WHERE evidence_id = ?").get(evidenceId);
      if (existing) {
        if (existing.evidence_sha256 !== hash) throw stateError("IMMUTABLE_VIOLATION", `evidence ${evidenceId} is immutable`);
        return { evidenceId, evidenceSha256: hash };
      }
      db.prepare("INSERT INTO state_evidence (evidence_id, source_kind, source_ref, payload_json, evidence_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(evidenceId, sourceKind, sourceRef, canonicalJson(payload), hash, createdAt);
      return { evidenceId, evidenceSha256: hash };
    });
  }

  recordCutover({ streamId, status, legacyWriterEnabled = false, notes = {}, operationId }) {
    const request = { streamId, status, legacyWriterEnabled, notes };
    return this.runIdempotent({ operationId, operationKind: "migration.cutover", request }, (db) => {
      if (!this.getStream(streamId)) throw stateError("STREAM_NOT_FOUND", `stream ${streamId} does not exist`);
      db.prepare(
        `INSERT INTO state_cutovers (stream_id, status, legacy_writer_enabled, recorded_at, notes_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(stream_id) DO UPDATE SET status = excluded.status, legacy_writer_enabled = excluded.legacy_writer_enabled, recorded_at = excluded.recorded_at, notes_json = excluded.notes_json`,
      ).run(streamId, status, legacyWriterEnabled ? 1 : 0, this.now(), canonicalJson(notes));
      return { streamId, status, legacyWriterEnabled };
    });
  }

  _versionRow(row) {
    return {
      versionId: row.version_id ?? row.head_version_id,
      streamId: row.stream_id,
      domain: row.domain,
      streamKey: row.stream_key,
      versionNo: Number(row.version_no),
      semanticSha256: row.semantic_sha256,
      originKind: row.origin_kind,
      payload: parseJson(row.payload_json, "state_versions.payload_json"),
      createdAt: row.created_at,
      headUpdatedAt: row.updated_at,
    };
  }

  _transaction(mutation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = mutation(this.db);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original */ }
      if (error instanceof StateControlPlaneError) throw error;
      throw stateError("STATE_TRANSACTION_FAILED", error.message, { cause: error });
    }
  }

  _assertDependenciesInTransaction(dependencies, versionId) {
    for (const dependency of dependencies) {
      if (dependency.versionId === versionId) throw stateError("DEPENDENCY_CYCLE", "a version cannot depend on itself");
      if (!this.readVersion(dependency.versionId)) throw stateError("DEPENDENCY_NOT_FOUND", `dependency ${dependency.versionId} does not exist`);
    }
  }
}

export async function openCommentStateDatabase(dbPath = undefined, options = {}) {
  const db = await openCommentDatabase(dbPath, options);
  ensureStateControlPlane(db);
  return db;
}

export function createStateControlPlane(db, options = {}) {
  return new StateControlPlane(db, options);
}

export { deterministicId };
