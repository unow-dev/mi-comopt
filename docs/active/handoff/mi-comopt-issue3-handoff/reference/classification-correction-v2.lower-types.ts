/**
 * mi-comopt Issue #3 — lower-level interface / function type contracts.
 * Design artifact only: no executable implementation, no changes to GitHub.
 *
 * Downstream keyword/release/promotion/deployment services retain their
 * existing capability contracts; the types here apply to batch classification.
 */
import type {
  ActorRef, AssessmentId, ChangeSetId, ClassificationLabel, CorrectionItem,
  DecisionId, FinalizeBatchInput, HumanReviewResult, OperationId, PinnedVersions,
  ProposalId, Sha256, ValidateBatchInput, VersionId,
} from "./classification-correction-v2.task-types";

export type NonEmptyArray<T> = readonly [T, ...T[]];
export type ObservationId = string; // Never coerce to number; '001' != '1'.
export type CommentText = string;    // Never trim, NFKC-normalize, or case-fold.
export type CorrectionItemIndex = number;

/** Incoming data is not trusted merely because TypeScript accepts it. */
export interface BatchRequest {
  readonly operationId: OperationId; // Business operation identity, NOT ctx.operationId.
  readonly requester: ActorRef;
  readonly corrections: NonEmptyArray<CorrectionItem>;
  readonly pinned: PinnedVersions;
}
export interface ValidatedBatch extends BatchRequest {
  readonly requestFingerprint: Sha256;
}

export interface SurvivorRow {
  readonly observationId: ObservationId;
  readonly commentText: CommentText;
}
export interface LabelRow {
  readonly observationId: ObservationId;
  readonly label: ClassificationLabel;
}
export interface ExpectedHeads {
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  /** Optional additional streams only where the governing policy requires head equality. */
  readonly policyHeadVersionIds?: Readonly<Record<string, VersionId>>;
}
export interface PinnedDependency {
  readonly role: string;
  readonly versionId: VersionId;
}
export interface ClassificationBaseSnapshot {
  readonly expectedHeads: ExpectedHeads;
  readonly pinned: PinnedVersions;
  /** Full survivor set, projected from ONE pinned CorpusVersion. */
  readonly survivors: readonly SurvivorRow[];
  /** ClassificationVersion only; no fallback to legacy global labels. */
  readonly labels: readonly LabelRow[];
  readonly dependencies: readonly PinnedDependency[];
  readonly baseSemanticSha256: Sha256;
}
export interface BaseReadRequest {
  readonly corpusVersionId: VersionId;
  readonly classificationVersionId: VersionId;
  readonly classificationPolicyVersionId: VersionId;
}
export interface CorrectionReadPort {
  /** Snapshot-consistent read; no per-CorrectionItem DB full scan. */
  loadBase(request: BaseReadRequest): ClassificationBaseSnapshot;
}

/** Agent context identifies the service, not the authenticated requester. */
export interface RequesterIdentityPort {
  /** Reads a trusted actor identity captured at Session creation. */
  authenticatedRequester(sessionId: string): ActorRef;
  /** Rejects forged claimedRequester and unauthorized batch operations. */
  requirePermission(sessionId: string, claimedRequester: ActorRef, action: "classification:correct"): void;
}

/** Proof must be resolved against a stored handoff receipt, not an I-number guess. */
export interface VerifiedProvenance {
  readonly sourceSha256: Sha256;
  readonly handoffReceiptRef: string;
  readonly worksetId: string;
  readonly handoffItemId: string;
  readonly observationId: ObservationId;
}
export interface ProvenanceVerificationRequest {
  readonly item: CorrectionItem;
  readonly corpusVersionId: VersionId;
}
export interface ProvenancePort {
  verifyIfSupplied(request: ProvenanceVerificationRequest): VerifiedProvenance | null;
}

export type BatchViolationCode =
  | "EMPTY_BATCH" | "INVALID_LABEL" | "EMPTY_REASON" | "NO_CHANGE"
  | "UNKNOWN_TARGET" | "DUPLICATE_SURVIVOR" | "MISSING_BASE_LABEL"
  | "DUPLICATE_GROUP" | "CONTRADICTORY_GROUP" | "EXPECTED_LABEL_MISMATCH"
  | "UNRESOLVED_PROVENANCE" | "COVERAGE_MISMATCH" | "VERSION_MISMATCH";
export interface BatchViolation {
  readonly code: BatchViolationCode;
  readonly correctionIndex?: CorrectionItemIndex;
  readonly observationId?: ObservationId;
  readonly message: string;
}
export type BatchConflictAt = "classification" | "corpus" | "policy";
export type DomainResult<T> =
  | Readonly<{ kind: "ok"; value: T }>
  | Readonly<{ kind: "invalid"; violations: NonEmptyArray<BatchViolation> }>
  | Readonly<{ kind: "conflict"; conflictAt: BatchConflictAt }>;

/** A CommentGroup is a derived value inside one pinned CorpusVersion. */
export interface ResolvedCorrectionGroup {
  readonly correctionIndex: CorrectionItemIndex;
  readonly representativeObservationId: ObservationId;
  readonly commentText: CommentText;
  readonly observationIds: NonEmptyArray<ObservationId>;
  readonly expectedLabel: ClassificationLabel;
  readonly replacementLabel: ClassificationLabel;
  readonly reason: string;
  readonly provenance: VerifiedProvenance | null;
}
export interface ClassificationState {
  readonly schema_version: 2;
  /** Exactly one label for every survivor and no labels for non-survivors. */
  readonly labels: readonly LabelRow[];
}
export interface LabelDistribution {
  readonly normal: number;
  readonly direct_nuisance: number;
  readonly reactive: number;
}
export interface CorrectionChangeSet {
  readonly changeSetId: ChangeSetId;
  readonly operationId: OperationId;
  readonly requestFingerprint: Sha256;
  readonly pinned: PinnedVersions;
  readonly groups: NonEmptyArray<ResolvedCorrectionGroup>;
  readonly changedObservationIds: readonly ObservationId[];
  readonly before: ClassificationState;
  readonly after: ClassificationState;
  readonly groupCount: number;
  readonly observationCount: number;
  readonly beforeCounts: LabelDistribution;
  readonly afterCounts: LabelDistribution;
  readonly changeSetHash: Sha256;
  readonly proposedStateSemanticSha256: Sha256;
}

/** PURE DOMAIN FUNCTIONS: no DB, clocks, I/O, Session, or permission mutation. */
export interface CorrectionDomainFunctions {
  /** Validates shape only; cannot certify snapshot-dependent facts. */
  validateRequest(input: ValidateBatchInput): DomainResult<ValidatedBatch>;
  /** Uses the raw exact-text equality relation within the supplied snapshot. */
  resolveGroups(
    batch: ValidatedBatch,
    snapshot: ClassificationBaseSnapshot,
    verifiedProvenance: readonly (VerifiedProvenance | null)[],
  ): DomainResult<NonEmptyArray<ResolvedCorrectionGroup>>;
  /** Applies ALL groups in memory and validates exact survivor coverage. */
  buildChangeSet(
    batch: ValidatedBatch,
    snapshot: ClassificationBaseSnapshot,
    groups: NonEmptyArray<ResolvedCorrectionGroup>,
  ): DomainResult<CorrectionChangeSet>;
  /** Recomputes from current pinned data during commit preflight. */
  recomputeChangeSet(
    batch: ValidatedBatch,
    snapshot: ClassificationBaseSnapshot,
    verifiedProvenance: readonly (VerifiedProvenance | null)[],
  ): DomainResult<CorrectionChangeSet>;
  semanticHash(state: ClassificationState): Sha256;
  changeSetHash(changeSet: Omit<CorrectionChangeSet, "changeSetHash">): Sha256;
}

export interface ChangeSetRef {
  readonly changeSetId: ChangeSetId;
  readonly changeSetHash: Sha256;
}
export interface CorrectionChangeSetStore {
  putImmutable(changeSet: CorrectionChangeSet): ChangeSetRef;
  read(changeSetId: ChangeSetId): CorrectionChangeSet | null;
}

export interface CorrectionAssessment {
  readonly assessmentId: AssessmentId;
  readonly operationId: OperationId;
  readonly inputFingerprint: Sha256;
  readonly changeSet: ChangeSetRef;
  readonly groupCount: number;
  readonly observationCount: number;
  readonly beforeCounts: LabelDistribution;
  readonly afterCounts: LabelDistribution;
  readonly coverageIsExact: true;
}
export interface ClassificationProposal {
  readonly proposalId: ProposalId;
  readonly operationId: OperationId;
  readonly assessmentId: AssessmentId;
  readonly changeSet: ChangeSetRef;
  readonly expectedHeads: ExpectedHeads;
  readonly dependencies: readonly PinnedDependency[];
  readonly proposedStateSemanticSha256: Sha256;
  /** Digest of the complete proposal, including assessment, dependencies and plan. */
  readonly proposalSha256: Sha256;
}
export interface ProposeBundle {
  readonly changeSet: CorrectionChangeSet;
  readonly assessment: CorrectionAssessment;
  readonly proposal: ClassificationProposal;
}
export interface StoredProposalRefs {
  readonly assessmentId: AssessmentId;
  readonly proposalId: ProposalId;
  readonly proposalSha256: Sha256;
}
export interface ProposalWritePort {
  /** Immutable writes + unique business operation key in ONE transaction. */
  saveBundle(operationId: OperationId, bundle: ProposeBundle): StoredProposalRefs;
  readProposal(proposalId: ProposalId): ClassificationProposal | null;
  readAssessment(assessmentId: AssessmentId): CorrectionAssessment | null;
}
export interface AssessmentAndProposalFunctions {
  assess(changeSet: CorrectionChangeSet): CorrectionAssessment;
  propose(changeSet: CorrectionChangeSet, assessment: CorrectionAssessment, expectedHeads: ExpectedHeads): ClassificationProposal;
}

/** Review comes from the Orchestrator and must be bound to a proposal. */
export interface BoundHumanReview {
  readonly proposalId: ProposalId;
  readonly review: HumanReviewResult;
  readonly taskExecutionId: string;
}
export interface ApprovedReview {
  readonly proposalId: ProposalId;
  readonly actorId: string;
  readonly outcome: "accept" | "reject";
  readonly rationale: string | null;
  readonly policyVersionId: VersionId;
}
export interface ReviewAuthorizationPort {
  /** Checks task-to-proposal binding, human actor and pinned policy authority. */
  authorize(input: BoundHumanReview, proposal: ClassificationProposal): ApprovedReview;
}
export interface ClassificationDecision {
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly outcome: "accepted" | "rejected";
  readonly authorityKind: "human";
  readonly authorityRef: string;
  readonly transitionPolicyVersionId: VersionId;
  readonly rationale: string | null;
}

export interface ClassificationCommitReceipt {
  readonly operationId: OperationId;
  readonly requestFingerprint: Sha256;
  readonly proposalId: ProposalId;
  readonly decisionId: DecisionId;
  readonly classificationVersionId: VersionId;
  readonly committedStateSha256: Sha256;
}
export type FinalizationOutcome =
  | Readonly<{ kind: "committed"; receipt: ClassificationCommitReceipt }>
  | Readonly<{ kind: "reused"; receipt: ClassificationCommitReceipt }>
  | Readonly<{ kind: "rejected"; proposalId: ProposalId; decisionId: DecisionId }>
  | Readonly<{ kind: "conflict"; conflictAt: BatchConflictAt }>;
export interface FinalizationRecord {
  readonly operationId: OperationId;
  readonly requestFingerprint: Sha256;
  readonly outcome: FinalizationOutcome;
}

/**
 * Transaction-scoped methods: no async I/O. The implementation must keep all
 * reads, preflight checks, inserts, head CAS and receipt writes in ONE transaction.
 */
export interface ClassificationCommitTransaction {
  readFinalizationRecord(operationId: OperationId): FinalizationRecord | null;
  readProposal(proposalId: ProposalId): ClassificationProposal | null;
  readAssessment(assessmentId: AssessmentId): CorrectionAssessment | null;
  readChangeSet(changeSetId: ChangeSetId): CorrectionChangeSet | null;
  /** Reads current heads and pinned data under the SAME transaction boundary. */
  readCurrentHeads(): ExpectedHeads;
  loadBase(request: BaseReadRequest): ClassificationBaseSnapshot;
  readDecision(proposalId: ProposalId): ClassificationDecision | null;
  putDecisionIfAbsent(decision: ClassificationDecision): ClassificationDecision;
  /** Version + complete labels, but not yet a published Head. */
  insertClassificationVersion(request: {
    readonly operationId: OperationId;
    readonly proposalId: ProposalId;
    readonly decisionId: DecisionId;
    readonly state: ClassificationState;
    readonly dependencies: readonly PinnedDependency[];
    readonly semanticSha256: Sha256;
  }): VersionId;
  /** 0 affected rows => conflict; MUST rollback whole transaction. */
  compareAndSetClassificationHead(expectedVersionId: VersionId, nextVersionId: VersionId): boolean;
  /** Unique operationId: existing equal fingerprint reuses; mismatch conflicts. */
  putFinalizationRecord(record: FinalizationRecord): void;
}
export interface CorrectionCommitUnitOfWork {
  transaction<T>(work: (tx: ClassificationCommitTransaction) => T): T;
}

export interface CorrectionFinalizeFunctions {
  /** Pure checks: proposal/assessment/changeset hashes, head, policy, coverage. */
  preflight(input: {
    readonly request: ValidatedBatch;
    readonly proposal: ClassificationProposal;
    readonly assessment: CorrectionAssessment;
    readonly storedChangeSet: CorrectionChangeSet;
    readonly recomputedChangeSet: CorrectionChangeSet;
    readonly heads: ExpectedHeads;
  }): DomainResult<{
    readonly state: ClassificationState;
    readonly semanticSha256: Sha256;
    readonly dependencies: readonly PinnedDependency[];
  }>;
  /** Drives decision + conditional commit; no external publishing here. */
  finalize(input: FinalizeBatchInput, review: ApprovedReview): FinalizationOutcome;
}

/** The four new task capabilities are composed from these interfaces. */
export interface CorrectionBatchDependencies {
  readonly domain: CorrectionDomainFunctions;
  readonly reads: CorrectionReadPort;
  readonly requesterIdentity: RequesterIdentityPort;
  readonly provenance: ProvenancePort;
  readonly changeSets: CorrectionChangeSetStore;
  readonly proposals: ProposalWritePort;
  readonly proposalFunctions: AssessmentAndProposalFunctions;
  readonly authorization: ReviewAuthorizationPort;
  readonly commit: CorrectionCommitUnitOfWork;
}

/**
 * Separation to preserve:
 * - validation/resolve/propose are read-and-prepare operations;
 * - finalize is the only classification-Head-changing operation;
 * - downstream capabilities consume the resulting ClassificationVersionId;
 * - no individual CorrectionItem creates its own Version or Publication path.
 */
