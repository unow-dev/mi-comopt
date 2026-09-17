# Application Service Contracts v3

This document elaborates requirement IDs from `01_NORMATIVE_IMPLEMENTATION_SPEC_V3.md`; it does not add independent normative obligations.

## 1. Common operation rules

Implements `V3-REQ-SVC-001`, `V3-REQ-SVC-002`, and `V3-REQ-RESULT-001`.

Every side-effecting consumer Application Service call uses stable `operationId = <sessionId>/<stepId>`. Technical retry, Execution reclaim, response-loss recovery, and Temporal retry reuse that identity. The service stores a request hash `SHA-256(JCS(serviceRequestDto))`, excluding the `operationId` itself. The DTO is the stable business-input projection after binding resolution: omitted optional predecessor stays absent, explicit `null` appears only where the service contract gives `null` business meaning, and ephemeral transport/runtime fields are excluded. Same operation ID + same request hash returns the prior result; same operation ID + different request hash returns `IDEMPOTENCY_CONFLICT` and performs no mutation.

External model/service calls occur before opening a Comment DB write transaction. Write transactions are short and only record authoritative consumer state with concurrency guards.

`details` in WorkStepResult is diagnostic only. WorkStepResult basic shape is validated by `contracts/work-step-result-v3.schema.json`; `(stepId, routingOutcome, stateResult, exact authoritative-ref key set)` is validated by `contracts/work-step-result-v3-rules.json` before Task completion. The validator matches `set(keys(result.refs))` exactly against one `refSets` entry for the matched route/state; extra authoritative refs are invalid. A result-contract violation is an execution/integration failure, not a business routing outcome.

## 2. EvidenceApplicationService v3

Input: exact accepted ArtifactVersion from step 00. Validate `tiktokCommentBatch-1.0.0`, preserve exact submitted bytes/content identity, import one raw snapshot, and return `evidenceIds` and `snapshotRef {payloadSha256,snapshotIndex}`.

## 3. CorpusApplicationService

Input: Evidence refs, `initialCorpusVersionId`, `corpusPolicyVersionId`. Expected head is the pinned initial Corpus Version, where no head is represented only by `null`. Create Proposal/Decision/Commit under pinned Corpus Policy. Head conflict routes `superseded`.

## 4. ClassificationHandoffService

`prepare()` receives exact Corpus Version, pinned Classification Version and Policy. Outcomes are `reuse`, `ready_without_handoff`, `handoff_required`, or conflict `superseded`.

`handoff_required` produces one ArtifactVersion with logicalPath `three-class-workset.zip` and `worksetId`, using the existing three-class workset v1 protocol.

## 5. ClassificationApplicationServiceV3

`assess()` consumes exact Corpus, pinned/current Classification prior, pinned Classification Policy, preparation result, and optional accepted `response.json` ArtifactVersion.

Before no-op or proposal creation, assert expected head == actual head. Build exact dependency set `{corpus, policy}`. Record Assessment for the current evaluation. Then:

- payload same + deps same -> `unchanged`, no Proposal/Version, routing `continue`;
- payload same + deps changed -> Proposal; pinned policy may system-decide/commit dependency refresh; otherwise `review_required`;
- payload changed -> Proposal and always `review_required`.

`finalize()` consumes Proposal and optional Human review. If assess already produced a resolved Version and no review ran, return/pass through that Version. If review ran, validate actor/outcome against the Proposal-pinned transition policy and record the formal Decision. Human reject records the rejected Decision and returns `rejected` even if the stream head changed during the wait because no Commit is attempted. Human accept records the accepted Decision, then performs the guarded Commit; a head conflict after acceptance returns `superseded` with the accepted Decision retained and no Commit. If no Human review ran and an upstream conflict is merely passed through, no synthetic Decision is created.

## 6. KeywordHandoffService

`prepare()` compares exact Corpus, Classification, Keyword prior, and Keyword Policy evaluation context. Only exact context reuse skips external proposal. `handoff_required` produces one ArtifactVersion with logicalPath `keyword-candidate-handoff.zip` plus `candidateRequestId` and `candidateInputFingerprint`. `handoff_manifest.json` stays local verification metadata and is excluded from the external model package.

## 7. KeywordSelectionApplicationServiceV3

Same state-machine rules as Classification, with exact dependencies `{corpus, classification, policy}`. A `candidate_proposal.json` with `actions: []` is valid. Payload changes always require Human review. Human reject/accept/concurrency ordering matches Classification finalization.

## 8. ValidatedHumanArtifactCompletionService

For steps 00/03b/07b:

1. Check completion receipt first using command ID `complete-human-artifact:<executionId>`.
2. Validate expected file cardinality/name.
3. Read bytes and run domain validator.
4. Compute SHA-256 and size.
5. Snapshot output directory to provider ArtifactStore using active executionId.
6. Require exactly one expected file ArtifactVersion, matching logicalPath, execution origin, hash, and size.
7. Complete Human Task with `submitted` and the exact `human-artifact-submission-result-v1` payload: active `executionId` plus the accepted ArtifactVersion identity; no free-form contract ID/version fields.
8. If response is lost, reconcile from receipt before retry.

Validation failure leaves the Human Task active and issues no completion command.

## 9. Release and materialization

Implements `V3-REQ-REL-001` through `V3-REQ-REL-008`.

Release Builder consumes the exact eight state/policy/projection Version IDs. `releaseKey` is `SHA-256(JCS(object))` over the named object:

```json
{
  "contract": "comment-db-release-key/v1",
  "corpusVersionId": "...",
  "classificationVersionId": "...",
  "keywordSelectionVersionId": "...",
  "corpusPolicyVersionId": "...",
  "classificationPolicyVersionId": "...",
  "keywordPolicyVersionId": "...",
  "accountPolicyVersionId": "...",
  "projectionDefinitionVersionId": "..."
}
```

The database enforces unique `releaseKey`; Step 11 is find-or-create and returns `created` or `reused`. The Projection Definition Version is the complete deterministic projection contract: public artifact set/logical paths, serialization/canonicalization, byte-relevant packaging, manifest, and validation rules. Business-authoritative artifact bytes do not depend on wall-clock time, timezone, hostname, random values, process iteration order, or other ambient inputs. Any legitimate change that can alter authoritative bytes requires a new Projection Definition Version.

Step 12 publishes from temporary build output only after validation. Existing materialization is verified against its stored manifest (logical path, size, SHA-256, artifact cardinality, Projection Definition identity). Exact match returns `already_materialized`; mismatch is an integrity/execution failure and is not repaired by overwriting the Release.

## 10. Promotion

Implements `V3-REQ-REL-009`.

Step 13 creates an immutable Proposal per business review attempt and pins `releaseId`, `promotionStream`, and the Promotion head observed in the Proposal creation transaction as `expectedPromotionHeadVersionId` (`null` represents no existing head). Step 13 has only `continue`; a later head change is evaluated by Step 14. Proposal reuse across separate Sessions/business review attempts is not allowed; technical retry returns the same Proposal through application idempotency.

Step 14 treats Human review as evidence for a formal Promotion Decision. Reject records a rejected Decision and terminates `not_promoted` without changing Promotion head. Accept records an accepted Decision, then compares actual Promotion head to the Proposal-pinned expected head. Conflict returns `superseded`, keeps the accepted Decision, and performs no Commit. On a matching head, promoting a different Release creates a new Promotion Version; if the current head already points to the exact reviewed Release, the accepted Decision is recorded and the existing Promotion Version is returned as `reused` rather than creating a duplicate Version.

Expected-head comparison uses only `null | non-empty Version ID`: expected `null` matches only actual `null`; a Version ID matches only the same Version ID.

## 11. Deployment and outbox

Implements `V3-REQ-DEPLOY-001` through `V3-REQ-DEPLOY-012`.

A deployment intent is the unique pair `(acceptedPromotionDecisionId, deploymentTarget)`. Creating it atomically allocates a target-local monotonic `deploymentSequence`; technical retry returns the existing request and does not consume another sequence. The consumer deployment queue permits multiple dispatcher processes, but external deployment execution is durable FIFO single-flight per target: only the earliest nonterminal sequence for a target may be active.

Immediately before the first external deployment call, compare current Promotion head with the request's pinned `promotionVersionId`. If it changed, mark the queued request `superseded` without making an external call. If a newer promotion arrives while an older external deployment is active, the newer request waits until the older request reaches terminal state. Dispatcher crash recovery may reacquire the same request; adapter ensure semantics keyed by `deploymentRequestId` prevents duplicate provider-side deployment creation.

Deployment event outbox delivery remains receipt-first with stable provider command identity `event:<eventId>`. Multiple dispatchers may race on an outbox row; identical command identity/hash makes this safe. Outbox disposition is monotonic `pending -> delivered` or `pending -> dead-letter`; before dead-lettering, receipt is checked again so an already-accepted receipt wins.

Step 19 checks Promotion head before verification and again after verification. A changed head returns `superseded`. Verification that completes normally and proves the exact Release is not serving returns business `deployment_failed`; provider/transport/DB uncertainty remains an execution failure because business outcome is not known.

Step 20 commits Deployment State only when both guards hold: current Promotion head still equals the request's `promotionVersionId`, and the request's target-local `deploymentSequence` is newer than the current Deployment head sequence. The same `deploymentRequestId` already recorded returns `reused`; an older sequence returns `superseded`; a newer sequence commits a new Deployment Version. Failed/cancelled/superseded deployment requests do not advance Deployment head.

Permanent event-delivery rejection, request-hash conflict, or dead-letter is an integration/intervention condition and is not converted to business `deployment_failed` because the external deployment outcome may be unknown.
