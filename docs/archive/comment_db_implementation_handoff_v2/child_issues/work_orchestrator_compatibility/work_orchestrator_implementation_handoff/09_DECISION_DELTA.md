# Decision Delta — Existing Docs vs Final Compatibility Spec

This file prevents an implementer from following stale statements in the supplied design handoff.

## Superseded statements

### `blocked` as a routing outcome

Existing docs list `blocked` among canonical routing outcomes and Choice branches.

**Final:** v2 treats blocked as `AgentRunResult.status="blocked"` operational disposition. It leaves the Task waiting and creates intervention. There is no blocked Choice branch.

### Promotion starts at Human review

Existing flow begins Promotion with `13-review-production-promotion`.

**Final:** add `13-propose-production-promotion` before Human review. The Proposal pins Promotion expected head and Promotion Transition Policy.

### Human reject can terminate before finalize

Some existing builder shapes route Human `reject` directly to terminal.

**Final:** both accept and reject always go through finalize, which records formal Decision; finalize's `rejected` routing then terminates.

### Promotion expected head supplied by workflow/session

Existing task matrix suggests expected Promotion head as Human-review/finalize input.

**Final:** Promotion propose service resolves head at Proposal creation boundary and stores it in immutable Proposal. Workflow does not supply/refresh it later.

### Transition Policy pseudo IDs / permissive fallback

Current implementation contains pseudo IDs and `policyPayload()` fallback `{}`.

**Final:** all Decisions reference real Policy State versions from exact streams. Missing/wrong stream fails closed.

### Policy streams

Existing normative examples mention classification, keyword-selection, account-candidate only.

**Final:** add `policy/corpus`, `policy/promotion-production`, and `policy/deployment-production` using the existing Policy domain mechanism.

### Definition revision only

Existing compatibility discussion focuses on Consumer revision bump.

**Final:** the Provider Definition language itself is extended; use `WorkDefinition.schemaVersion:2` and Consumer revision 2. Preserve schema v1 compatibility.

### Agent outcome embedded in result

Current Provider behavior/Consumer helper can derive routing from result/details.

**Final:** schema-v2 routing uses top-level `AgentRunResult.outcome`. Consumer WorkStepResult remains domain result only.

### Human Task budget/result schema

Current Provider requires budgets on all Tasks; Consumer attaches WorkStepResult schema to Human Task.

**Final:** schema-v2 Human Task does not require fabricated wall timeout and does not use Agent WorkStepResult result schema.

### Empty Sequence as terminal

Current Consumer helper uses empty Sequence.

**Final:** empty Sequence remains invalid. Add Provider Noop step; optional static marker supports Consumer outcome projection.

### Dynamic event correlation

Current Consumer WaitEvent correlates using deployment target.

**Final:** correlation is exact deploymentRequestId from step 16, resolved once when wait opens and persisted in WaitRuntime.

### `suffixStepTree()`

Current builder blindly suffixes copied downstream trees.

**Final:** use parameterized continuation builders because authoritative version source changes (03 vs 06, 07 vs 10).

### Deployment trigger idempotency

Current service calls external adapter before durable request row, then inserts request inside runIdempotent.

**Final:** durable prepared intent row first; network call outside transaction; monotonic reconcile + completed operation receipt after call.

### Callback storage only

Current `receiveCompletedEvent()` stores event and updates request but has no durable routing to Orchestrator Session.

**Final:** request stores workflowSessionId; ingress transaction creates event audit + Provider-delivery outbox; replay until Provider facade success.

### Deployment semantic fingerprint includes verificationRef

Current payload semantic state includes verificationRef.

**Final:** semantic Deployment State is target + releaseId. Verification reference is evidence/provenance and must not create semantic churn.

### `verified: true` caller assertion

Current deployment record requires boolean `verified` from caller.

**Final:** verified service output provides non-empty verificationRef; record requires that evidence. Caller self-asserted boolean is removed.

### Recovery pins only release ID

Earlier discussion considered release-only recovery pinning.

**Final:** recovery Session pins both promotionVersionId and releaseId from the same Promotion head and trigger validates both, preventing ABA.

### Consumer duplicate structural validator

Current Consumer performs structural checks in addition to Provider validation.

**Final:** Provider `validateAndHashDefinition()` is sole structural authority. Consumer validates only business invariants/stable IDs/permissions/hash snapshot.

## Decisions intentionally retained

- authoritative state remains Proposal -> Decision -> Commit;
- Session does not silently adopt new pinned inputs;
- technical retries reuse operation identity;
- semantic conflict produces `superseded` and requires a new Session;
- deployment callback success never establishes Deployment State without independent verification;
- `deploy-promoted-release` does not rerun prior state/promotion stages;
- definition revisions are immutable and hash-protected.
