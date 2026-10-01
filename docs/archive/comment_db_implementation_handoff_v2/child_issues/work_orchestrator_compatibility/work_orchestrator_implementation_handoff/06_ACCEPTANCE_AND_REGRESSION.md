# Acceptance and Regression Plan

All existing A01–A32 remain mandatory. This file adds compatibility-specific assertions needed to freeze the final decisions.

## Provider tests

### Definition/schema compatibility

- P01: Existing schema-v1 definitions validate/hash/register unchanged.
- P02: schema-v2 accepts Noop, task-source binding, binding Choice, dynamic WaitEvent correlation.
- P03: schema-v1 does not silently receive v2 semantics.
- P04: Human v2 Task without budget validates; Agent without wall budget does not.
- P05: empty Sequence remains invalid.
- P06: `source:"task"` root pointer is `""`; `"/"` does not behave as root.

### Runtime

- P07: v2 top-level Agent outcome routes correctly.
- P08: v2 result containing only legacy `result.outcome` does not route as outcome.
- P09: binding Choice non-string/unknown value -> `OUTCOME_INVALID`.
- P10: legacy embedded decision Task remains visible in branches.
- P11: Human completion retains ActorRef in task-source binding.
- P12: blocked Agent result creates immediate intervention, does not consume automatic retry, does not progress Choice.
- P13: manual retry clears stale task fields and reruns same logical task.
- P14: dynamic correlation resolves once, persists, and survives Registry reload/recovery.
- P15: wrong correlation does not wake wait.
- P16: early event can be consumed when matching wait later opens.
- P17: duplicate external event command replays receipt.
- P18: event-delivery facade succeeds after Temporal workflow already closed (`prior receipt` or `terminal_ignored`).
- P19: same event command ID with changed payload conflicts.
- P20: Session view exposes resultsByStepId.
- P21: resultSchema validator enforces `additionalProperties:false` and `minLength`.

## Consumer definition tests

- C01: `comment-data-update@2` is `schemaVersion:2`, validates via public Provider API, hashes, registers.
- C02: same for `deploy-promoted-release@2`.
- C03: revision-2 builder cannot emit revision 1.
- C04: changing canonical v2 tree without revision bump fails snapshot/registry.
- C05: every Task input binding is a semantic-keyed Record.
- C06: no v2 Choice contains `blocked` branch.
- C07: Human review reject necessarily executes finalize before terminal result.
- C08: downstream Classification binding is step 03 on auto path and step 06 on reviewed path.
- C09: downstream Keyword binding is step 07 on auto path and step 10 on reviewed path.
- C10: Promotion Proposal task runs before Promotion Human Task.
- C11: deployment wait correlation is deploymentRequestId from step 16.
- C12: event `/status` routes succeeded/failed/cancelled exactly.
- C13: recovery definition contains no earlier business stages.

## Policy/provenance tests

- S01: session starter rejects cross-stream Corpus/Classification/Keyword/Policy/Projection version IDs.
- S02: missing required Session-start policy fails Session creation.
- S03: Classification/Keyword auto path succeeds with required four state permissions.
- S04: Classification/Keyword Proposal policy dependency is exact expected stream.
- S05: finalize ignores/rejects request attempt to substitute a different policy version.
- S06: unauthorized human accept cannot create accepted Decision/commit.
- S07: Promotion Proposal pins current Promotion head + promotion-production policy once.
- S08: retry of existing Promotion proposal does not adopt newer head/policy.
- S09: Promotion ABA (`R1 -> R2 -> R1`) during Human wait ends superseded.
- S10: Deployment record Proposal pins deployment policy once; retry reuses.
- S11: policy payload missing/wrong stream never falls back to `{}`.
- S12: release builder rejects policy version from wrong stream even though domain is `policy`.

## Deployment ledger/ingress tests

- D01: prepared ledger row exists before external `ensureDeployment` can callback.
- D02: callback arriving before ensureDeployment return cannot be overwritten by requested state.
- D03: terminal state never regresses or changes terminal kind.
- D04: externalRunRef allows null->value enrichment once; conflicting value rejected.
- D05: crash after external request/before receipt retries same deploymentRequestId (A17).
- D06: immediate external failed/cancelled -> `deployment_failed`, not blocked/retry loop.
- D07: request row stores workflowSessionId and pinned promotionVersionId.
- D08: recovery Session Promotion ABA is detected before calling deployment adapter.
- D09: unknown deploymentRequestId callback is rejected.
- D10: mismatched release/target callback is rejected.
- D11: duplicate callback differing only completedAt is harmless.
- D12: conflicting terminal callback is not forwarded.
- D13: event audit + delivery outbox are committed atomically with request reconciliation.
- D14: crash after ingress commit/before Provider delivery is recovered by outbox replay.
- D15: replay after Session closure terminates via Provider facade success.
- D16: successful callback still requires independent verify and record.
- D17: verificationRef difference for same actual release does not create a new semantic Deployment Version.

## Outcome tests

- O01: deployed.changed true only when deployment record stateResult is `committed`.
- O02: deployed.changed false for `unchanged`.
- O03: `deployment_failed` outcome requires non-empty releaseId.
- O04: not_promoted is emitted only after formal rejected Promotion Decision exists.
- O05: classification/keyword rejection outcome only after formal rejected Decision exists.
- O06: superseded conflictAt is obtained from terminal marker, not free-form details.

## Existing A01–A32

Re-run all original tests. Pay special attention to:

- A01 auto commit path (new permissions + policy streams)
- A03/A05/A07 reject formal Decisions
- A08 stale Proposal/ABA
- A09/A32 application receipt replay
- A12 blocked/retry exhaustion/intervention behavior
- A17–A23 deployment lifecycle
- A24 pin isolation
- A25 revision immutability
- A27 Human authority
- A28 dependency role/stream integrity
