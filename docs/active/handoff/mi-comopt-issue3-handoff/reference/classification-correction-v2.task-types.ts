/**
 * Issue #3 / classification-correction@2 — task function type design.
 * Specification only: not wired to runtime, and no business implementation.
 * This uses the existing v3 ApplicationService boundary:
 * (OperationContext, boundInputs) => WorkStepResult
 * The adapter, not the handler, derives the routing outcome.
 */

// Serializable IDs. Each is a string at the JSON boundary; a runtime decoder
// must check non-empty values and that version IDs belong to the right stream.
export type OperationId = string;
export type VersionId = string;
export type AssessmentId = string;
export type ProposalId = string;
export type DecisionId = string;
export type ChangeSetId = string;
export type ReleaseId = string;
export type DeploymentRequestId = string;
export type VerificationRef = string;
export type Sha256 = string; // Validate ^[0-9a-f]{64}$ at the boundary.
export type ClassificationLabel = "normal" | "direct_nuisance" | "reactive";
export type Permission = string;

export interface ActorRef {
  readonly actorId: string;
  readonly actorType: "human" | "system" | "service";
}

/** The ctx.actor is the APPLICATION SERVICE executing the task, not the requester. */
export interface OperationContext {
  readonly sessionId: string;
  readonly workflowSessionId: string;
  readonly workDefinitionId: string;
  readonly workDefinitionRevision: number;
  readonly stepId: string;
  readonly operationId: string; // existing v3: `${sessionId}/${stepId}`
  readonly actor: ActorRef;
  readonly permissions: readonly Permission[];
}
export type Handler<Input, Result> = (
  context: OperationContext,
  input: Readonly<Input>,
) => Promise<Result> | Result;

export interface CorrectionProvenance {
  readonly sourceSha256: Sha256;
  readonly worksetId?: string;
  readonly handoffItemId?: string;
  readonly receiptRef?: string;
}
export interface CorrectionItem {
  readonly targetObservationId: string; // Preserve text identity; no numeric coercion.
  readonly expectedLabel: ClassificationLabel;
  readonly replacementLabel: ClassificationLabel;
  readonly reason: string;
  readonly provenance?: CorrectionProvenance;
}
export interface PinnedVersions {
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  readonly classificationPolicyVersionId: VersionId;
  readonly keywordSelectionVersionId: VersionId | null;
  readonly corpusPolicyVersionId: VersionId;
  readonly keywordPolicyVersionId: VersionId;
  readonly accountPolicyVersionId: VersionId;
  readonly projectionDefinitionVersionId: VersionId;
}
export interface CorrectionBatchSessionInput {
  readonly inputContract: {
    readonly id: "classificationCorrectionBatch";
    readonly version: "2.0.0";
  };
  readonly correctionOperationId: OperationId; // Business identity; stable across sessions.
  readonly requester: ActorRef; // Authenticated by the session-start boundary.
  readonly corrections: readonly [CorrectionItem, ...CorrectionItem[]];
  readonly pinned: PinnedVersions;
  readonly provenance?: CorrectionProvenance;
  readonly target: {
    readonly promotionStream: "production";
    readonly deploymentTarget: "production";
  };
}

/** v3 WorkStepResult has NO `outcome` property. It has stateResult/refs/details. */
export type StepResult<State extends string, Refs extends object, Details = undefined> =
  Readonly<{ stateResult: State; refs: Readonly<Refs> }> &
  (Details extends undefined
    ? { readonly details?: Readonly<Record<string, unknown>> }
    : { readonly details: Readonly<Details> });

export interface InputViolation {
  readonly code: string;
  readonly correctionIndex?: number;
  readonly description: string;
}
export type InvalidBatch = StepResult<"blocked", {}, {
  readonly reason: "invalid_request";
  readonly violations: readonly InputViolation[];
}>;
export type BatchConflict = StepResult<"conflict", {}, {
  readonly conflictAt: "classification" | "corpus" | "policy";
}>;

// Step 01: structural checks, operation identity, pinned references, requester.
export interface ValidateBatchInput {
  readonly correctionOperationId: OperationId;
  readonly requester: ActorRef;
  readonly corrections: CorrectionBatchSessionInput["corrections"];
  readonly pinned: PinnedVersions;
  readonly provenance?: CorrectionProvenance;
}
export type ValidateBatchResult =
  | StepResult<"succeeded", {}, { readonly requestFingerprint: Sha256 }>
  | InvalidBatch | BatchConflict;

// Step 02: resolve ALL groups in one read/snapshot; no partial writes.
export interface ResolveBatchInput extends ValidateBatchInput {
  readonly requestFingerprint: Sha256;
}
export type ResolveBatchResult =
  | StepResult<"succeeded", { readonly changeSetId: ChangeSetId }, {
      readonly changeSetHash: Sha256;
      readonly groupCount: number;
      readonly observationCount: number;
    }>
  | InvalidBatch | BatchConflict;

// Step 03: one immutable Assessment + one immutable Proposal for the batch.
export interface ProposeBatchInput {
  readonly correctionOperationId: OperationId;
  readonly changeSetId: ChangeSetId;
  readonly changeSetHash: Sha256;
  readonly requestFingerprint: Sha256;
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  readonly classificationPolicyVersionId: VersionId;
}
export type ProposeBatchResult =
  | StepResult<"review_required", {
      readonly assessmentId: AssessmentId;
      readonly proposalId: ProposalId;
    }, { readonly changeSetHash: Sha256 }>
  | InvalidBatch | BatchConflict;

// Step 05: HumanTask, NOT an ApplicationService handler.
export interface ClassificationReviewInput {
  readonly proposalId: ProposalId;
  readonly assessmentId: AssessmentId;
}
export interface HumanReviewResult {
  readonly outcome: "accept" | "reject";
  readonly actor: ActorRef & { readonly actorType: "human" };
  readonly result: { readonly rationale?: string };
}

// Step 06: review is required even when rejected; commit only on accept.
export interface FinalizeBatchInput {
  readonly correctionOperationId: OperationId;
  readonly proposalId: ProposalId;
  readonly assessmentId: AssessmentId;
  readonly approvedChangeSetHash: Sha256;
  readonly review: HumanReviewResult;
}
export type FinalizeBatchResult =
  | StepResult<"committed" | "reused", {
      readonly classificationVersionId: VersionId;
      readonly proposalId: ProposalId;
      readonly decisionId: DecisionId;
    }>
  | StepResult<"rejected", {
      readonly proposalId: ProposalId;
      readonly decisionId: DecisionId;
    }>
  | StepResult<"conflict", {}, { readonly conflictAt: "classification" | "corpus" | "policy" }>;

// Step 07a: existing keyword handoff service (bound to NEW classification Version).
export interface PrepareKeywordInput {
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  readonly keywordSelectionVersionId: VersionId | null;
  readonly keywordPolicyVersionId: VersionId;
}
export type PrepareKeywordResult =
  | StepResult<"reused", { readonly keywordSelectionVersionId: VersionId }>
  | StepResult<"created", {
      readonly candidateRequestId: string;
      readonly candidateInputFingerprint: string;
    }>
  | StepResult<"conflict", {}>;

// Step 07b: HumanTask, NOT an ApplicationService handler.
export interface ArtifactRef {
  readonly artifactVersionId: string;
  readonly blobHash: Sha256;
  readonly logicalPath: string;
  readonly size: number;
}
export interface ArtifactSubmissionResult {
  readonly outcome: "submitted";
  readonly result: {
    readonly executionId: string;
    readonly artifact: ArtifactRef;
  };
}

// Step 07: untrusted artifact JSON is decoded/validated before service invocation.
// Retain an extensible payload for keyword-specific fields beyond the handoff identity.
export type KeywordAction = Readonly<{
  action: "add" | "update" | "retire" | "reactivate";
  candidate_id?: string;
  keyword?: string;
  selection_state?: "selected" | "retired";
} & Record<string, unknown>>;
export interface KeywordCandidateProposal {
  readonly schema_version: 1;
  readonly request_id: string;
  readonly input_fingerprint: string; // sha256:<64 lowercase hex>
  readonly actions: readonly KeywordAction[];
}
export interface KeywordProposedState {
  readonly schema_version: 1;
  readonly entries: readonly KeywordAction[];
}
export interface AssessKeywordInput extends PrepareKeywordInput {
  readonly handoffPreparation?: PrepareKeywordResult;
  readonly proposal?: KeywordCandidateProposal;
  readonly proposedState?: KeywordProposedState; // Constructed by enrichHumanInputs.
}
export type AssessKeywordResult =
  | StepResult<"unchanged", { readonly assessmentId: AssessmentId; readonly keywordSelectionVersionId: VersionId }>
  | StepResult<"committed", {
      readonly assessmentId: AssessmentId;
      readonly proposalId: ProposalId;
      readonly decisionId: DecisionId;
      readonly keywordSelectionVersionId: VersionId;
    }>
  | StepResult<"review_required", { readonly assessmentId: AssessmentId; readonly proposalId: ProposalId }>
  | StepResult<"conflict", {}>;

// Step 09: HumanTask, same result type as classification review.
export interface KeywordReviewInput {
  readonly proposalId: ProposalId;
  readonly assessmentId: AssessmentId;
}

// Step 10: existing service supports no-review (already final) and reviewed paths.
export type FinalizeKeywordInput =
  | { readonly assessed: Extract<AssessKeywordResult, { stateResult: "unchanged" | "committed" }>;
      readonly proposalId?: ProposalId; readonly review?: never }
  | { readonly assessed: Extract<AssessKeywordResult, { stateResult: "review_required" }>;
      readonly proposalId: ProposalId; readonly review: HumanReviewResult };
export type FinalizeKeywordResult =
  | StepResult<"committed" | "reused", { readonly keywordSelectionVersionId: VersionId }>
  | StepResult<"rejected", { readonly proposalId: ProposalId; readonly decisionId: DecisionId }>
  | StepResult<"conflict", {}>;

// Step 11: Release build.
export interface BuildReleaseInput {
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  readonly keywordSelectionVersionId: VersionId;
  readonly corpusPolicyVersionId: VersionId;
  readonly classificationPolicyVersionId: VersionId;
  readonly keywordPolicyVersionId: VersionId;
  readonly accountPolicyVersionId: VersionId;
  readonly projectionDefinitionVersionId: VersionId;
}
export type BuildReleaseResult = StepResult<"created" | "reused", { readonly releaseId: ReleaseId }>;

// Step 12: Release materialization.
export interface MaterializeReleaseInput { readonly releaseId: ReleaseId }
export type MaterializeReleaseResult = StepResult<"materialized" | "already_materialized", { readonly releaseId: ReleaseId }>;

// Step 13: promotion proposal.
export interface ProposePromotionInput {
  readonly releaseId: ReleaseId;
  readonly promotionStream: "production";
}
export type ProposePromotionResult = StepResult<"created", {
  readonly proposalId: ProposalId;
  readonly releaseId: ReleaseId;
}>;

// Step 13-review: HumanTask.
export interface PromotionReviewInput {
  readonly releaseId: ReleaseId;
  readonly proposalId: ProposalId;
}

// Step 14: promotion finalization.
export interface FinalizePromotionInput {
  readonly proposalId: ProposalId;
  readonly releaseId: ReleaseId;
  readonly review: HumanReviewResult;
}
export type FinalizePromotionResult =
  | StepResult<"committed" | "reused", {
      readonly proposalId: ProposalId;
      readonly decisionId: DecisionId;
      readonly promotionVersionId: VersionId;
      readonly releaseId: ReleaseId;
    }>
  | StepResult<"rejected" | "conflict", {
      readonly proposalId: ProposalId;
      readonly decisionId: DecisionId;
      readonly releaseId: ReleaseId;
    }>;

// Step 16: trigger deployment.
export interface TriggerDeploymentInput {
  readonly acceptedPromotionDecisionId: DecisionId;
  readonly promotionVersionId: VersionId;
  readonly releaseId: ReleaseId;
  readonly target: "production";
}
export type TriggerDeploymentResult =
  | StepResult<"triggered" | "already_deployed" | "deployment_failed", {
      readonly deploymentRequestId: DeploymentRequestId;
      readonly releaseId: ReleaseId;
      readonly promotionVersionId: VersionId;
    }>
  | StepResult<"conflict", { readonly releaseId: ReleaseId; readonly promotionVersionId: VersionId }>;

// Step 18: waitEvent, NOT an ApplicationService handler.
export interface DeploymentCompletedEvent {
  readonly eventType: "deployment.completed";
  readonly correlationKey: DeploymentRequestId;
  readonly payload: unknown; // Event payload must be decoded/validated at the boundary.
}

// Step 19: verification can run from a waited event or already-deployed state.
export interface VerifyDeploymentInput {
  readonly deploymentRequestId: DeploymentRequestId;
  readonly releaseId: ReleaseId;
  readonly promotionVersionId: VersionId;
  readonly target: "production";
  readonly event?: DeploymentCompletedEvent;
}
export type VerifyDeploymentResult =
  | StepResult<"verified" | "not_verified", {
      readonly verificationRef: VerificationRef;
      readonly deploymentRequestId: DeploymentRequestId;
      readonly releaseId: ReleaseId;
      readonly promotionVersionId: VersionId;
    }>
  | StepResult<"deployment_failed" | "conflict", {
      readonly deploymentRequestId: DeploymentRequestId;
      readonly releaseId: ReleaseId;
      readonly promotionVersionId: VersionId;
    }>;

// Step 20: recording of verified deployment.
export interface RecordDeploymentInput {
  readonly deploymentRequestId: DeploymentRequestId;
  readonly releaseId: ReleaseId;
  readonly promotionVersionId: VersionId;
  readonly verificationRef: VerificationRef;
}
export type RecordDeploymentResult =
  | StepResult<"committed" | "reused", {
      readonly deploymentVersionId: VersionId;
      readonly deploymentRequestId: DeploymentRequestId;
      readonly releaseId: ReleaseId;
    }>
  | StepResult<"conflict", {
      readonly deploymentRequestId: DeploymentRequestId;
      readonly releaseId: ReleaseId;
    }>;

/** Compile-time one-to-one capability -> ApplicationService handler contract. */
export interface TaskContractMap {
  "classification-correction.batch.validate": { input: ValidateBatchInput; result: ValidateBatchResult };
  "classification-correction.batch.resolve": { input: ResolveBatchInput; result: ResolveBatchResult };
  "classification-correction.batch.propose": { input: ProposeBatchInput; result: ProposeBatchResult };
  "classification-correction.batch.finalize": { input: FinalizeBatchInput; result: FinalizeBatchResult };
  "keyword-selection.handoff.prepare": { input: PrepareKeywordInput; result: PrepareKeywordResult };
  "keyword-selection.assess": { input: AssessKeywordInput; result: AssessKeywordResult };
  "keyword-selection.finalize": { input: FinalizeKeywordInput; result: FinalizeKeywordResult };
  "release.build": { input: BuildReleaseInput; result: BuildReleaseResult };
  "release.materialize": { input: MaterializeReleaseInput; result: MaterializeReleaseResult };
  "promotion.propose": { input: ProposePromotionInput; result: ProposePromotionResult };
  "promotion.finalize": { input: FinalizePromotionInput; result: FinalizePromotionResult };
  "deployment.trigger": { input: TriggerDeploymentInput; result: TriggerDeploymentResult };
  "deployment.verify": { input: VerifyDeploymentInput; result: VerifyDeploymentResult };
  "deployment.record": { input: RecordDeploymentInput; result: RecordDeploymentResult };
}
export type TaskHandlers = {
  readonly [Capability in keyof TaskContractMap]: Handler<
    TaskContractMap[Capability]["input"],
    TaskContractMap[Capability]["result"]
  >;
};

/**
 * Runtime rules required in addition to TS:
 *  - input schemas and exact bindings by step ID;
 *  - stateResult/refs exact-key rules (existing result-rules.js);
 *  - routingForResult mapping per step (blocked -> invalid for batch steps);
 *  - requester authentication and policy authorization;
 *  - transaction/HEAD compare-and-set and immutable proposal/hash checks;
 *  - global business operation idempotency separate from ctx.operationId;
 *  - fail-closed choice control-flow in the WorkDefinition.
 */
