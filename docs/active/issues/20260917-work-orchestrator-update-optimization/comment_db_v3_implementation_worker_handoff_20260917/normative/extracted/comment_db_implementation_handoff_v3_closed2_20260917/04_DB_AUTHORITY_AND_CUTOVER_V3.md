# DB Authority and Cutover v3

This document elaborates authority/cutover requirements from `01_NORMATIVE_IMPLEMENTATION_SPEC_V3.md`; it does not add independent normative obligations.

## 1. Authority planes

Evidence Plane: raw snapshots, raw source bytes, observations.  
Authoritative State Plane: streams, versions, heads, dependencies, proposals, decisions, transitions, typed state, releases, promotion, deployment.  
Operational/integration provenance: application idempotency receipts, deployment requests/outbox.

Work Orchestrator Session/Task/Execution/Wait state stays outside Comment DB.

## 2. State Version semantics

State Version semantic payload and dependency provenance are both relevant to v3 Classification/Keyword context. `commitProposal` gains additive `noOpPolicy`:

- `semantic` (default; preserves v2/other-domain behavior)
- `semantic-and-dependencies` (v3 Classification/Keyword)

Existing version/proposal dependency tables remain authoritative; dependency-aware no-op does not require a new dependency schema.

Expected stream head uses `null | non-empty Version ID`; empty string/sentinel values do not represent genesis.

## 3. Release and deployment persistence

Release persistence includes `release_key` with a uniqueness constraint. A Release is immutable after creation.

Deployment request persistence includes at least `deploymentRequestId`, accepted Promotion Decision ID, `promotionVersionId`, `releaseId`, deployment target, target-local `deploymentSequence`, and status. Enforce uniqueness for `(promotionDecisionId, deploymentTarget)` and `(deploymentTarget, deploymentSequence)`. A target-local counter/allocator assigns sequence within the request creation transaction; retry of an existing business key returns the existing request and sequence.

The dispatcher implementation may run with multiple processes. Correctness comes from durable target-local FIFO/single-flight claim state plus adapter ensure semantics, not from a singleton deployment.

## 4. Legacy writers

After stream cutover, legacy direct three-class label writer and legacy filesystem/current keyword-publication authority are no longer authoritative. Existing validators/projections may be reused; state write authority goes through the State Control Plane.

## 5. Cutover transaction

1. Freeze new `comment-data-update@2` starts.
2. Drain nonterminal production revision-2 update Sessions to zero.
3. Confirm no revision-2 path can subsequently commit Classification/Keyword authority.
4. Re-run Classification and Keyword cutover/equivalence gates.
5. Disable legacy authoritative writers.
6. Remove legacy `current` sources from authority reads.
7. Register/enable `comment-data-update@TARGET_REVISION` as resolved by the registry/hash algorithm in `V3-REQ-REV-007`.
8. Pin normal `startCommentDataUpdate()` facade to that resolved revision.
9. Run one production smoke Session.
10. Reopen new starts only after gates pass.

`deploy-promoted-release@2` does not need to be drained solely for this cutover because its Definition and update-authority semantics are unchanged.

## 6. Rollback

After v3 architecture cutover, rollback is not a return to revision 2 or legacy authority. Freeze new starts, safely finish/intervene running Sessions, and fix-forward. If the registered canonical Definition tree must change, resolve a new higher immutable revision with the same registry/hash algorithm instead of mutating the registered revision.

## 7. Deployment-event outbox dispositions

Additive consumer deployment-event outbox fields include `delivery_disposition` and `dead_lettered_at`.

- accepted receipt -> delivered / `accepted`
- closed-terminal ignored -> delivered / `terminal_ignored`
- permanent reject -> dead-letter
- request hash conflict -> dead-letter
- transient provider/transport failure -> pending

Outbox transitions are monotonic. A dispatcher rechecks provider receipt immediately before dead-lettering; an accepted receipt wins over a concurrently observed delivery error.
