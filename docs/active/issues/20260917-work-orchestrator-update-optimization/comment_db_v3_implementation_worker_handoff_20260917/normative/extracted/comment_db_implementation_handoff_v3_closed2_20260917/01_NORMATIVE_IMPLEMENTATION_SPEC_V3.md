# Normative Implementation Specification v3

## 1. Purpose and supersession

This specification is the sole architecture authority for the v3 implementation. It supersedes v2 for new implementation and new production `comment-data-update` starts. Previously registered v2 Definition artifacts remain immutable historical artifacts.

## 2. Non-negotiable principles

[V3-REQ-AUTH-001] Work Orchestrator SHALL own workflow/runtime truth: WorkDefinition, Session, Task, Execution, Human Task lifecycle, Wait/Event/Timer, retry/intervention, history, and command receipts. Comment DB/Application SHALL own business/domain truth: Evidence, Assessment, Proposal, Decision, Commit, State Versions/Dependencies/Heads/Transitions, Release, Promotion State, Deployment State, and domain idempotency receipts.

[V3-REQ-AUTH-002] Human Task completion SHALL NOT itself be a Comment DB Decision. Formal business acceptance/rejection SHALL be recorded through the domain Decision abstraction.

[V3-REQ-AUTH-003] No authoritative dual-write path SHALL exist during migration or steady state.

[V3-REQ-AUTH-004] Business release artifacts SHALL be owned by the consumer release-artifact lifetime/authority. Work Orchestrator ArtifactStore MAY hold work/handoff artifacts but SHALL NOT become release business authority.

[V3-REQ-AUTH-005] Work Orchestrator workspace/outbox artifacts and the consumer deployment-event outbox SHALL remain separate responsibilities and persistence concepts.

Observation does not mutate authoritative state. Assessment does not mutate authoritative state. A normal authoritative transition is `Proposal -> Decision -> Commit`. Commit is guarded, atomic, mechanical, and does not perform domain judgment.

## 3. Application service and result contracts

[V3-REQ-SVC-001] Every side-effecting consumer Application Service SHALL use stable `operationId = <sessionId>/<stepId>`. Technical retry, Execution reclaim, response-loss recovery, and Temporal retry SHALL reuse that identity. The service SHALL persist `SHA-256(JCS(serviceRequestDto))`, excluding `operationId` itself, as the request hash. `serviceRequestDto` SHALL contain exactly the stable business-input fields defined by that service after binding resolution: an absent optional predecessor is omitted rather than encoded as `null`, while `null` is used only where the service contract explicitly defines `null` as a business value; ephemeral transport/runtime metadata SHALL NOT participate. Same operation ID plus same request hash SHALL return the prior result; same operation ID plus a different request hash SHALL fail with `IDEMPOTENCY_CONFLICT` and perform no mutation.

[V3-REQ-SVC-002] External model/service calls SHALL NOT occur while a Comment DB write transaction is open. External work SHALL complete before the short authoritative write transaction.

[V3-REQ-RESULT-001] `contracts/work-step-result-v3.schema.json` SHALL define WorkStepResult basic shape and `contracts/work-step-result-v3-rules.json` SHALL define the allowed `(stepId, routingOutcome, stateResult)` combinations and the exact permitted authoritative-ref key sets for each combination. Agent Task completion SHALL validate both contracts and SHALL reject missing or route/state-forbidden extra authoritative refs. Contract violation SHALL be an execution/integration failure, not a business routing outcome. `details` SHALL be diagnostic only; generic WorkStepResult `inputFingerprint`/`outputFingerprint` fields SHALL NOT be part of the v3 contract.

[V3-REQ-RESULT-002] Session terminal output SHALL validate `contracts/comment-data-update-v3-outcome.schema.json`. `change_rejected` SHALL carry `stage` exactly `classification` or `keyword-selection`; `superseded` SHALL carry `conflictAt` exactly one of `corpus`, `classification`, `keyword-selection`, `promotion`, or `deployment`; other terminal statuses SHALL NOT carry stray stage/conflict fields.

## 4. Session and pinning

[V3-REQ-SESSION-001] New production Comment DB update starts SHALL explicitly start `comment-data-update` at `TARGET_REVISION` resolved by `V3-REQ-REV-007`. Normal business callers SHALL NOT select an arbitrary Definition revision.

[V3-REQ-SESSION-002] `deploy-promoted-release` SHALL remain revision 2 unless its canonical Definition changes independently.

[V3-REQ-SESSION-003] A v3 Session SHALL pin the initial Corpus Version (`null` or non-empty Version ID), Classification Version (`null` or non-empty Version ID), Keyword Selection Version (`null` or non-empty Version ID), Corpus Policy Version, Classification Policy Version, Keyword Policy Version, Account Policy Version, and Projection Definition Version. Empty string or sentinel strings SHALL NOT represent a missing head/version.

[V3-REQ-SESSION-004] A running Session SHALL use its pinned/resolved semantic inputs and SHALL NOT silently reread newer heads or policy/projection versions.

[V3-REQ-SESSION-005] Initial v3 implementation SHALL accept exactly one submitted update snapshot per Session. It SHALL NOT perform implicit multi-snapshot merge.

[V3-REQ-SESSION-006] The initial update artifact contract SHALL be external-producer-neutral and SHALL use `tiktokCommentBatch` version `1.0.0`. Operational use of ChatGPT does not make ChatGPT part of the Session semantic contract.

[V3-REQ-SESSION-007] Session semantic input SHALL NOT duplicate `requestedBy`/actor identity. Actor provenance is Work Orchestrator runtime history.

The exact JSON shape is normative in `contracts/comment-data-update-v3-session-input.schema.json`.

## 5. Human artifact handoff

[V3-REQ-ART-001] Steps `00`, `03b`, and `07b` are Human file-transport tasks, not business approvals.

[V3-REQ-ART-002] Their only allowed routing outcome SHALL be `submitted`.

[V3-REQ-ART-003] Invalid file name, cardinality, schema, protocol identity, or content SHALL NOT complete the Human Task.

[V3-REQ-ART-004] Consumer completion SHALL preflight-validate file bytes, calculate SHA-256, snapshot the output into the provider ArtifactStore, and require the submitted ArtifactVersion `blobHash` to equal the SHA-256 of the validated bytes.

[V3-REQ-ART-005] The Human output ArtifactVersion origin Execution SHALL equal the active Human Execution. A stale/reclaimed Execution SHALL NOT complete a newer Human Execution.

[V3-REQ-ART-006] Downstream Agent Tasks SHALL consume the exact accepted Human ArtifactVersion through Work Orchestrator artifact propagation; consumer code SHALL NOT invent a second file-transport authority.

[V3-REQ-ART-007] Agent-produced handoff artifacts SHALL preserve a human-meaningful `logicalPath` in both local and Temporal execution.

[V3-REQ-ART-008] Step 00 SHALL accept exactly one output file named `comment-batch.json`.

[V3-REQ-ART-009] Step 03b SHALL accept exactly one output file named `response.json`.

[V3-REQ-ART-010] Step 07b SHALL accept exactly one output file named `candidate_proposal.json`.

[V3-REQ-ART-011] Successful completion of Human file-transport steps 00/03b/07b SHALL return exactly the result shape in `contracts/human-artifact-submission-result-v1.schema.json`: active `executionId` plus the exact accepted ArtifactVersion identity (`artifactVersionId`, `blobHash`, `logicalPath`, `size`). Redundant free-form contract identity fields SHALL NOT be emitted.

## 6. Corpus

Step 01 imports the exact submitted artifact bytes into the Evidence Plane and returns `evidenceIds` plus a `snapshotRef`. Step 02 establishes Corpus state under the pinned Corpus Policy through the State Control Plane. Corpus may use system-policy Decision according to the pinned Corpus policy contract.

## 7. Classification

[V3-REQ-CLASS-001] Step 03a SHALL resolve one of exactly three routing outcomes: `reuse`, `ready_without_handoff`, or `handoff_required` (plus workflow conflict `superseded`).

[V3-REQ-CLASS-002] `reuse` SHALL be allowed only when the pinned Classification Version is still the expected/current head and its exact required dependencies match this Session's Corpus and Classification Policy inputs.

[V3-REQ-CLASS-003] `ready_without_handoff` SHALL mean reassessment/reconstruction is required but there are zero unresolved external classification items; deterministic prior authoritative judgments are sufficient.

[V3-REQ-CLASS-004] A Classification handoff SHALL reuse the existing three-class workset v1 protocol. Step 03a SHALL output `three-class-workset.zip`.

[V3-REQ-CLASS-005] Step 03b completion SHALL strictly validate workset identity and require every requested item ID exactly once before completion.

[V3-REQ-CLASS-006] Any change to Classification semantic payload SHALL require formal Human review at step 05 in v3. Request flags or generic policy auto-commit flags SHALL NOT bypass this boundary.

[V3-REQ-CLASS-007] A Classification Human rejection SHALL create the formal rejected Decision, leave Classification head unchanged, and terminate the Session as `change_rejected` without same-Session corrective loop/rebase. Rejection SHALL remain the business outcome even if the stream head changed during Human wait because no Classification Commit is attempted by the rejected path.

## 8. Keyword Selection

[V3-REQ-KEY-001] Step 07a SHALL resolve exactly `reuse` or `handoff_required` (plus workflow conflict `superseded`).

[V3-REQ-KEY-002] Any change in exact Corpus Version, Classification Version, or Keyword Policy Version relative to the authoritative evaluation context SHALL require a new Keyword handoff; heuristic skipping based on small changes is forbidden.

[V3-REQ-KEY-003] Keyword handoff SHALL reuse candidate-handoff v1 as implemented in repository `unow-dev/mi-comopt` at commit `398a904069af3e5e1386e412811f9a8275af1d7a`, entry path `package/src/processing/keyword-candidates/handoff-workflow.js` (including its dependencies at that commit). v3 SHALL preserve that v1 request/fingerprint/proposal-validation behavior rather than silently redefining the protocol. `handoff_manifest.json` is local verification metadata and SHALL NOT be sent to the external model.

[V3-REQ-KEY-004] Step 07b SHALL validate candidate proposal schema and require exact `request_id` and `input_fingerprint` identity before completion.

[V3-REQ-KEY-005] `actions: []` SHALL be accepted as a valid no-change external proposal.

[V3-REQ-KEY-006] Any change to Keyword Selection semantic payload SHALL require formal Human review at step 09.

[V3-REQ-KEY-007] Keyword rejection SHALL create a formal rejected Decision, leave Keyword Selection head unchanged, and terminate as `change_rejected` without same-Session corrective loop/rebase. Rejection SHALL remain the business outcome even if the stream head changed during Human wait because no Keyword Selection Commit is attempted by the rejected path.

## 9. State dependency and no-op semantics

[V3-REQ-DEP-001] For v3 Classification and Keyword Selection, no-op equality SHALL require both semantic payload equality and exact dependency-set equality.

[V3-REQ-DEP-002] If payload and exact dependencies are both unchanged, no new State Version/Transition SHALL be created.

[V3-REQ-DEP-003] If payload is unchanged but exact dependencies changed, the system SHALL create a new Proposal/Decision/Commit and State Version carrying the new dependencies.

[V3-REQ-DEP-004] A dependency-only transition MAY use a system Decision only when the pinned transition policy authorizes it.

[V3-REQ-DEP-005] A semantic payload change SHALL require Human Decision even if request or policy generic auto flags are true.

[V3-REQ-DEP-006] Classification State Version dependencies SHALL contain exactly one `corpus` dependency and exactly one Classification `policy` dependency.

[V3-REQ-DEP-007] Keyword Selection State Version dependencies SHALL contain exactly one `corpus`, exactly one `classification`, and exactly one Keyword Selection `policy` dependency.

[V3-REQ-DEP-008] Before returning `unchanged` or committing/finalizing against a pinned prior, Application Service SHALL verify that the actual stream head still equals the expected/pinned prior. A changed head terminates the logical attempt as `superseded`; no rebase occurs in the Session. If a Human accept Decision has already been formally recorded, that accepted Decision SHALL remain recorded while the guarded Commit is skipped; an upstream/system conflict SHALL NOT create a synthetic Human Decision.

[V3-REQ-DEP-009] Generic `commitProposal()` SHALL preserve existing `semantic` no-op behavior by default. Dependency-aware equality SHALL be an explicit additive mode used by v3 Classification/Keyword Selection only.

## 10. Release, Account Candidate, Promotion

[V3-REQ-REL-001] A Release SHALL reference exact Corpus, Classification, Keyword Selection, Corpus Policy, Classification Policy, Keyword Policy, Account Policy, and Projection Definition versions.

[V3-REQ-REL-002] Release construction SHALL NOT resolve `latest`/`current` internally.

[V3-REQ-REL-003] Account Candidate SHALL remain a deterministic derived result and SHALL NOT become an independent authoritative State Stream while it has no independent edit/adjudication semantics.

[V3-REQ-REL-004] Production review material SHALL include Keyword Selection diff, Account Candidate diff, release manifest, all public artifacts, data-release/build/integrity validation, and deployment target.

[V3-REQ-REL-005] Step 13 production Human acceptance SHALL mean adoption of the reviewed release content and permission to promote that exact verified Release to production.

[V3-REQ-REL-006] Production rejection SHALL terminate as `not_promoted`; no same-Session manual edit/rebase is permitted.

[V3-REQ-REL-007] Release identity SHALL be deterministic find-or-create by unique `releaseKey = SHA-256(JCS(namedObject))`. `namedObject` SHALL have exactly these properties and names: `contract`=`comment-db-release-key/v1`, `corpusVersionId`, `classificationVersionId`, `keywordSelectionVersionId`, `corpusPolicyVersionId`, `classificationPolicyVersionId`, `keywordPolicyVersionId`, `accountPolicyVersionId`, and `projectionDefinitionVersionId`; no additional property participates in the key. Concurrent construction of the same eight pins SHALL resolve to one Release.

[V3-REQ-REL-008] Projection Definition Version SHALL define the complete deterministic business-authoritative release projection contract, including public artifact set/logical paths, serialization/canonicalization, byte-relevant packaging, manifest, and validation. The same eight pins SHALL produce identical authoritative bytes independent of ambient runtime inputs. Existing materialization SHALL be verified and reused when identical; mismatch SHALL fail as integrity/execution failure and SHALL NOT be repaired by overwriting the Release.

[V3-REQ-REL-009] A production Promotion Proposal SHALL be immutable per business review attempt and pin exact `releaseId`, promotion stream, and `expectedPromotionHeadVersionId` (`null` for no head). Human review SHALL be evidence for a formal Promotion Decision. Reject SHALL record a rejected Decision and terminate `not_promoted`. Accept SHALL record an accepted Decision before guarded Commit; head conflict SHALL retain that Decision, perform no Commit, and terminate `superseded`. On matching head, promoting a different Release SHALL commit a new Promotion Version; accepting an already-current exact Release SHALL reuse the existing Promotion Version rather than create a duplicate.

## 11. Deployment

[V3-REQ-DEPLOY-001] Deployment triggering SHALL provide stable ensure/idempotency semantics through one `deploymentRequestId` per deployment intent.

[V3-REQ-DEPLOY-002] External-event command identity SHALL be `event:<eventId>` in both local and Temporal runtime paths.

[V3-REQ-DEPLOY-003] Deployment event reconciliation SHALL query Work Orchestrator receipt before retrying delivery.

[V3-REQ-DEPLOY-004] Event disposition SHALL be: accepted receipt -> delivered/accepted; closed-terminal ignored -> delivered/terminal_ignored; permanent rejection or request-hash conflict -> dead-letter; transient failure -> remain pending.

[V3-REQ-DEPLOY-005] Duplicate successful external events SHALL NOT create duplicate Deployment State transitions.

[V3-REQ-DEPLOY-006] Failed/cancelled event or independent verification failure SHALL NOT advance Deployment head.

[V3-REQ-DEPLOY-007] An adapter result that reports the Release already serving SHALL still execute independent verify and record steps.

[V3-REQ-DEPLOY-008] Continue-As-New SHALL preserve Session/workflow identity. Temporal run ID SHALL NOT become Comment DB business identity.

[V3-REQ-DEPLOY-009] A deployment intent SHALL be uniquely identified by `(acceptedPromotionDecisionId, deploymentTarget)`. Its creation transaction SHALL allocate one target-local monotonic `deploymentSequence`; technical retry SHALL return the existing deployment request and sequence instead of allocating another.

[V3-REQ-DEPLOY-010] Multiple dispatcher processes MAY run, but external deployment execution SHALL be durable FIFO single-flight per deployment target. Immediately before the first external deployment call, the consumer SHALL verify that current Promotion head still equals the request's pinned `promotionVersionId`; stale queued requests SHALL become `superseded` with zero external deployment calls. A newer request SHALL NOT start externally while an older request for the same target is nonterminal.

[V3-REQ-DEPLOY-011] Step 19 SHALL verify Promotion head both before and after independent deployment verification. Step 20 SHALL advance Deployment State only when Promotion head still equals the request's pinned `promotionVersionId` and the request's target-local `deploymentSequence` is newer than the current Deployment head sequence. An already-recorded identical `deploymentRequestId` SHALL return reuse; an older sequence SHALL return `superseded`.

[V3-REQ-DEPLOY-012] `superseded` deployment intent/event state SHALL be distinct from deployment failure. A provider-terminal failed/cancelled attempt or a normally completed verification that proves the exact Release is not serving MAY produce business `deployment_failed`. DB/transport/provider uncertainty, result-contract violation, idempotency hash conflict, malformed/unknown event, artifact integrity failure, or event-delivery dead-letter SHALL remain execution/integration/intervention failure and SHALL NOT be converted to business `deployment_failed`.

## 12. WorkDefinition revision and provider compatibility

[V3-REQ-REV-001] A registered WorkDefinition revision is immutable.

[V3-REQ-REV-002] `comment-data-update@2` canonical hash SHALL remain `77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`.

[V3-REQ-REV-003] `deploy-promoted-release@2` canonical hash SHALL remain `aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`.

[V3-REQ-REV-004] After a canonical Definition tree is registered at `TARGET_REVISION`, any change to graph, Step IDs, bindings, schemas, outcomes, capabilities, permissions, or retry contract SHALL require a new higher immutable revision; the registered revision SHALL NOT be mutated.

[V3-REQ-REV-005] WorkDefinition `schemaVersion` and Definition `revision` SHALL remain distinct concepts. This architecture uses schemaVersion 2; its WorkDefinition revision is `TARGET_REVISION` resolved independently from schemaVersion.

[V3-REQ-REV-006] Optional step/task InputBinding SHALL be explicit. Omitted `optional` SHALL preserve strict existing semantics. `optional:true` MAY tolerate only an unselected/nonexistent predecessor; if a predecessor exists and its bound path is invalid, resolution SHALL fail closed. Artifact propagation SHALL occur when the optional predecessor actually executed.

[V3-REQ-REV-007] Every normative implementation obligation in this handoff SHALL be represented by a `V3-REQ-*` ID in this file and by at least one mandatory verification ID. Supporting prose documents SHALL NOT create unregistered RFC-2119 obligations. PR0 SHALL lint requirement/verification/traceability completeness and supporting-document normative-keyword leakage. `TARGET_REVISION` SHALL be resolved mechanically starting at revision 3: build/validate/hash the candidate canonical Definition tree with revision `r`; if registry slot `r` is absent, choose `r`; if the registered hash equals the candidate hash, choose/reuse `r`; otherwise increment `r` and repeat. No registered revision SHALL be overwritten.

## 13. Cutover and rollback

[V3-REQ-CUT-001] Before enabling production `TARGET_REVISION` starts, new revision-2 `comment-data-update` starts SHALL be frozen.

[V3-REQ-CUT-002] Nonterminal production `comment-data-update@2` Sessions SHALL be drained to zero before authority cutover.

[V3-REQ-CUT-003] The state `v3 start enabled AND legacy authoritative writer enabled` SHALL never occur.

[V3-REQ-CUT-004] Legacy authoritative writers/readers SHALL be disabled as authority before v3 registration/start is enabled in production.

[V3-REQ-CUT-005] After cutover, failure rollback SHALL NOT re-enable legacy authority or business starts on revision 2.

[V3-REQ-CUT-006] If a fix requires canonical Definition change after `TARGET_REVISION` is registered, fix-forward SHALL allocate a new higher immutable `comment-data-update` revision using the same registry collision rule; the registered target SHALL NOT be changed in place.

[V3-REQ-CUT-007] Production smoke failure SHALL freeze new starts and use fix-forward; it SHALL NOT recreate dual authority.

## 14. Completion criterion

Implementation is complete only when all non-retired v3 requirements are marked `implemented` in the traceability index, all mandatory v3 verification IDs pass, all normative schemas/rules and traceability/lint checks pass, v2 hashes remain unchanged, and cutover gates are satisfied.
