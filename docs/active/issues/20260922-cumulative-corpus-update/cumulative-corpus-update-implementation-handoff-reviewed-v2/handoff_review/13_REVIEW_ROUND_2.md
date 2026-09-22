# Review Round 2 — Adopted Corrections

This review tightened production recovery correctness and removed several remaining ambiguities.

## 1. Dedicated planned-recovery cutover state

### Compared

- Reuse existing `v3_frozen` and distinguish planned recovery by evidence.
- Add a dedicated `recovery_frozen` state.

### Adopted

`recovery_frozen`.

Reason: existing `v3_frozen` has a `fix_forward_v3` exit. Reusing it creates a path that can re-enable starts before recovery verification. A new state value does not require a DB table-shape migration because cutover state is stored as text.

Transitions:

```text
smoke_verified --recovery_freeze--> recovery_frozen
recovery_frozen --recovery_cancelled--> smoke_verified   # before mutation only
recovery_frozen --recovery_completed--> smoke_verified  # verified completion only
```

`fix_forward_v3` is invalid from `recovery_frozen`.

## 2. Freeze/drain before authoritative plan

### Compared

- `plan -> start(freeze) -> drain -> re-check`
- `freeze -> drain -> plan -> start`

### Adopted

`freeze -> drain -> plan -> start`.

Reason: a plan created while normal sessions can still advance has a race window. Planning after freeze and drain makes the reviewed range/counts stable. `start` still recomputes the canonical plan and rejects any mismatch before corpus mutation.

`recovery cancel` is allowed only before any mutating recovery stage has completed; it is not a rollback mechanism.

## 3. Recovery classification uses exact-dedupe groups

### Compared

- Search historical labels only for first-win survivor observation IDs.
- Search historical labels for all observation IDs in each current recovery exact five-field dedupe group.

### Adopted

Exact-dedupe groups.

Reason: if the historical label exists only on a duplicate loser, survivor-only lookup would send a logical comment that was already classified back to ChatGPT. The adopted five-field identity rule says these observations are the same comment.

Resolution:

```text
1. build current recovery exact-dedupe groups
2. search historical labels only for observation IDs inside those groups
3. newest classification version containing a group-member label wins
4. same-version conflicts use worseThreeClassLabel()
5. bind group identity label to first-win survivor
6. derive same-comment inheritance only from identity-resolved current survivors
7. only the remainder goes to ChatGPT
```

DB-global comment history remains prohibited.

## 4. Canonical recovery count semantics

Ambiguous `previous/incoming/duplicate` wording was replaced by:

```text
expectedLogicalRecordCount
= baseLogicalRecordCount
+ appendedRawObservationCount
- duplicateObservationCount
```

This remains correct when the base contains internal duplicates or later corpus versions repeat snapshot refs.

## 5. Recovery progress authority

### Compared

- Add a dedicated mutable recovery progress table.
- Reuse existing idempotent operation receipts plus immutable state/version/release rows.

### Adopted

Existing `application_operation_receipts`.

Stage operation IDs are deterministic. `recovery status` reconstructs progress. The successful verify receipt is the control-plane authority; `recovery-verification.json` is only a mirror for issue evidence.

## 6. Deployment verification uses deterministic rebuild

Source Dataset v2 intentionally does not expose internal observation IDs. Therefore verification does not claim to compare deployed source records to survivor IDs directly.

Instead `recovery verify` must:

```text
recovered Corpus v2 + ClassificationVersion
  -> deterministically rebuild Source Dataset v2 bytes
  -> compare exact bytes/SHA to materialized comments
  -> compare exact bytes/SHA to deployed comments
  -> deterministically rebuild Overview and Account artifacts
  -> compare to generated/deployed artifacts
  -> verify keyword publication is bound to the rebuilt Source Dataset SHA
```

This is stronger and matches the actual public artifact contract.

## 7. Normal session start guard

Rejecting a legacy Corpus v1 head only inside `CorpusApplicationServiceV3.update()` is too late because earlier workflow stages can already ingest evidence.

Adopted defense in depth:

- `startV3Session()` / equivalent start preflight rejects a non-genesis Corpus v1 head with `CORPUS_BOOTSTRAP_REQUIRED` before session creation or evidence ingest.
- `CorpusApplicationServiceV3.update()` keeps the same guard.

## 8. Issue completion remains production-verified

The issue remains open until:

- recovery is actually run in production;
- the corrected release is deployed;
- `recovery verify` passes using rebuilt artifact checks and served-release identity;
- all recovery ChatGPT handoffs show `previouslyResolvedItemCount == 0`;
- verification evidence is attached/referenced;
- `recovery complete` records completion and returns cutover state to `smoke_verified`.


## 9. Deployment verification is provider read-back, not marker-only

### Compared

- Trust the deployment status/release marker and compare only local generated hashes.
- Fetch the actually served release manifest and all public artifacts and validate them.

### Adopted

Provider read-back of the served manifest plus comments, keywords, accounts, and overview. The verifier must run the release/artifact validators against the fetched bytes and compare them with the corrected release. This detects partial deployment, stale CDN content, missing files, and content corruption that a marker-only check cannot detect.
