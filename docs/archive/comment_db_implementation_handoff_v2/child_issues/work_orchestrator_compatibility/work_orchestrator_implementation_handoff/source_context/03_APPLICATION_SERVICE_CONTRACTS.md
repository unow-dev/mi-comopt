# Application Service / Integration Contract

## 1. Boundary

Work Orchestrator workers call Application Services. They do not call repositories directly.

```text
Work Orchestrator Task
        -> Integration Adapter
        -> Application Service
        -> Repository/Transaction
        -> Comment DB / external adapter
```

Repositories are persistence mechanisms, not public transition APIs.

## 2. Operation context

Every side-effecting application call requires:

```ts
interface OperationContext {
  operationId: string;
  workflowSessionId: string;
  workDefinitionId: string;
  workDefinitionRevision: number;
  stepId: string;
  actor?: {
    actorId: string;
    actorType: string;
  };
}
```

Operation ID format:

```text
<sessionId>/<stepId>/<businessAttempt>
```

`businessAttempt` starts at `1`. Technical retries do not increment it. A new semantic attempt uses a new Session.

## 3. Idempotency algorithm

For any completed operation:

1. canonicalize request excluding transport-only metadata that is explicitly non-semantic
2. calculate request SHA-256
3. read `application_operation_receipts` by operation ID
4. if row exists and hash matches: return stored result
5. if row exists and hash differs: throw `IDEMPOTENCY_CONFLICT`
6. otherwise perform operation
7. for DB mutations, persist mutation + result receipt in the same DB transaction

Assessment involving an external model/service must not hold a DB transaction open. Execute the long external call first, then use a short DB transaction to persist resulting Assessment/Proposal/receipt, with concurrency guards before authoritative commit.

## 4. Service surface

### EvidenceApplicationService

```ts
ingest(ctx, request) -> WorkStepResult
```

May write Evidence Plane only. It does not establish Corpus State.

### CorpusApplicationService

```ts
update(ctx, request) -> WorkStepResult
```

Produces no-op, review-required if policy requires, or authoritative Corpus transition through normal Proposal/Decision/Commit semantics.

### ClassificationApplicationService

```ts
assess(ctx, request) -> WorkStepResult
finalize(ctx, request) -> WorkStepResult
```

`assess` performs Assessment and creates immutable Proposal when a change is proposed. If Transition Policy permits automated adjudication, it may record automated Decision + Commit in the same logical operation and return `continue`.

If human review is required, it stops with `review_required` and returns `proposalId`.

`finalize` consumes proposal + human review input, validates authority/policy/head, records formal Decision, and commits only when accepted and still valid.

### KeywordSelectionApplicationService

Same shape/rules as Classification, but typed to Keyword Selection state.

### ReleaseApplicationService

```ts
build(ctx, request) -> WorkStepResult
materialize(ctx, request) -> WorkStepResult
```

`build` accepts exact versions only. It never resolves latest/current. Same bundle semantics reuse an existing Release Bundle.

`materialize` writes to release-owned artifact storage/reference and verifies artifact integrity before Promotion review.

### PromotionApplicationService

```ts
finalize(ctx, request) -> WorkStepResult
```

Production review always precedes this call. Service validates human authority and Proposal/head, records Decision, and commits Promotion State if accepted. Promoting the already desired release is no-op.

### DeploymentApplicationService

```ts
trigger(ctx, request) -> WorkStepResult
verify(ctx, request) -> WorkStepResult
record(ctx, request) -> WorkStepResult
```

`trigger` calls idempotent/reconcilable DeploymentAdapter `ensureDeployment` semantics.

`verify` is read-only with respect to Deployment State and independently checks what release is actually served.

`record` uses verified evidence to perform automated Proposal/Decision/Commit for Deployment State.

## 5. Formal review request

Conceptual shape:

```ts
interface FinalizeReviewRequest {
  proposalId: string;
  review: {
    outcome: "accept" | "reject";
    actor: {
      actorId: string;
      actorType: string;
    };
  };
}
```

Finalize must never trust only the Orchestrator outcome. Revalidate authority and transition policy in the Application/Domain layer.

## 6. Read API

Read operations distinguish explicit-version read from head resolution.

Recommended surface:

```text
StateQueryService.resolveHead(stream)
StateQueryService.readVersion(versionId)
StateQueryService.readDependencies(versionId)
StateQueryService.readRelease(releaseId)
```

Domain-specific query methods use explicit version identifiers. Avoid ambiguous `getClassification()` / `exportCurrentKeywords()` APIs.

## 7. Transaction ownership

Application/Commit Service owns the transaction. Individual repositories do not independently start/commit their own transactions for one logical state transition.

Commit transaction writes, as applicable:

- typed State Version payload
- generic State Version metadata
- Dependencies
- Transition
- Head
- completed application operation receipt

## 8. Domain Transition Handler

Commit Service enforces generic state transition guards. A Domain Transition Handler validates:

- typed payload shape/invariants
- dependency-role semantics
- semantic fingerprint inputs
- typed state materialization

Do not place domain-specific branching logic in generic Commit Service.

## 9. Deployment adapter

Conceptual contract:

```ts
ensureDeployment({ deploymentRequestId, releaseId, target })
verifyDeployment({ releaseId, target, externalRunRef? })
```

The implementation must provide provider idempotency key or external run reconciliation. If exact semantics cannot be guaranteed by the provider, the adapter contract/test must explicitly demonstrate that duplicate calls are harmless for the same release/target/intent.

## 10. Orchestrator compatibility adapter

Business policy is expressed locally and mapped into public `work-orchestrator` types in one place.

Do not scatter undocumented enum literals or optional-field assumptions through WorkDefinition construction.

If installed library semantics cannot represent the required policy exactly, Definition construction/validation fails closed.
