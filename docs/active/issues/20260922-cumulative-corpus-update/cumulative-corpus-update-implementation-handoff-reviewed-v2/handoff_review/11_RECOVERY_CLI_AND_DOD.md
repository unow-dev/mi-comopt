# Recovery CLI Contract and Issue Completion Gate

## 1. Purpose

This issue is not complete when implementation and CI are green.

The issue is complete only after the implemented recovery command is executed against the target production state, the corrected cumulative release is deployed, and the deployed generated data is independently verified.

For this issue, production recovery is **mandatory**, not optional, because an already-broken corpus head is part of the incident being repaired.

---

## 2. CLI surface to implement

Extend the existing `comment-data-update:v3` operator with a top-level `recovery` command.

Run from the workspace root:

```bash
npm run comment-data-update:v3 -- recovery <subcommand> ...
```

Equivalent package-level invocation is acceptable internally:

```bash
npm --workspace package run comment-data-update:v3 -- recovery <subcommand> ...
```

Required subcommands:

```text
recovery freeze
recovery plan
recovery start
recovery cancel
recovery status
recovery resume
recovery classification open
recovery classification complete
recovery classification review
recovery keyword open
recovery keyword complete
recovery keyword review
recovery verify
recovery complete
```

The operator must remain production-target fixed and use the v3 application-service/control-plane path. Do not implement recovery as an ad-hoc SQL/script path that bypasses version/proposal/release/deployment controls.

---

## 3. Freeze and drain first

Planned recovery must first enter the dedicated freeze state:

```bash
npm run comment-data-update:v3 -- recovery freeze \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --actor "$ACTOR"
```

Requirements:

```text
cutover state before = smoke_verified
cutover state after  = recovery_frozen
normal v3 starts      = disabled
fix_forward_v3        = not permitted from recovery_frozen
```

After freeze, use the existing `sessions` command until nonterminal v3 sessions are zero. No corpus/classification recovery mutation may occur before drain completes.

If the recovery must be abandoned **before any mutating recovery stage has completed**, the operator may use:

```bash
npm run comment-data-update:v3 -- recovery cancel \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --actor "$ACTOR" \
  --rationale "..."
```

`cancel` is forbidden after any recovery corpus/classification/source/release/deployment mutation receipt exists. This is an abort-before-mutation escape hatch, not a rollback path.

---

## 4. Preflight plan

After freeze + drain, run the non-mutating plan:

```bash
npm run comment-data-update:v3 -- recovery plan \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --base-corpus-version-id "$BASE_CORPUS_VERSION_ID" \
  --broken-head-corpus-version-id "$BROKEN_HEAD_CORPUS_VERSION_ID"
```

`plan` MUST NOT mutate control-plane or corpus state.

It must output JSON containing at least:

```json
{
  "recoveryContract": "cumulative-corpus-recovery/v1",
  "recoveryContract": "cumulative-corpus-recovery/v1",
  "recoveryId": "...",
  "recoveryPlanSha256": "sha256:...",
  "baseCorpusVersionId": "...",
  "brokenHeadCorpusVersionId": "...",
  "currentCorpusHeadVersionId": "...",
  "recoveryRangeVersionIds": ["..."],
  "baseLogicalRecordCount": 24622,
  "appendedRawObservationCount": 11768,
  "duplicateObservationCount": 300,
  "expectedLogicalRecordCount": 36090,
  "recoveryPlanSha256": "sha256:..."
}
```

Counts above are illustrative. The authoritative equation is:

```text
expectedLogicalRecordCount
= baseLogicalRecordCount
+ appendedRawObservationCount
- duplicateObservationCount
```

Definitions:

- `baseLogicalRecordCount`: survivor count after projecting the base corpus itself.
- `appendedRawObservationCount`: raw observation count from snapshot refs first introduced after the base within the recovery range. Repeated snapshot refs are not counted twice.
- `duplicateObservationCount`: observations from those appended refs that do not survive the ordered five-field first-win projection, including duplicates against the base and within appended refs.

The plan must require `cutover state == recovery_frozen` and zero nonterminal v3 sessions. It must also validate that base and broken head are in the same corpus stream, the base is on the committed ancestry of the broken head, and the supplied broken head is the current corpus head.

`recoveryPlanSha256` MUST be computed from a canonical plan object that includes `recoveryContract`, the ordered recovery range/version IDs, ordered unique snapshot refs, and the counts above. `recoveryId` is deterministic for the recovery contract + base + broken head.

---

## 5. Start recovery

Start must bind to the reviewed plan fingerprint:

```bash
npm run comment-data-update:v3 -- recovery start \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --base-corpus-version-id "$BASE_CORPUS_VERSION_ID" \
  --broken-head-corpus-version-id "$BROKEN_HEAD_CORPUS_VERSION_ID" \
  --expected-plan-sha256 "$RECOVERY_PLAN_SHA256" \
  --actor "$ACTOR"
```

`start` performs the following fail-closed sequence:

```text
require cutover state = recovery_frozen
-> require nonterminal v3 sessions = 0
-> head / lineage / canonical plan re-check
-> verify recomputed plan SHA == expected plan SHA
-> register/reuse deterministic recovery identity
-> build corrected Corpus v2
-> cumulative projection
-> recover classification
-> stop at a human handoff if genuinely unresolved items exist
```

`recovery_frozen` is a dedicated planned-recovery state. It is not `v3_frozen`; `fix_forward_v3` must not be accepted from it. The successful exit is `recovery_completed` after matching deployed verification; `recovery_cancelled` is allowed only before the first mutating recovery stage.

Because plan is created only after freeze + drain, normal workflow activity cannot legitimately change its inputs between plan and start. `start` still recomputes the canonical plan; any mismatch fails with `RECOVERY_PLAN_STALE` before corpus mutation and leaves the system frozen for investigation/re-plan.

---

## 6. Resume and status

```bash
npm run comment-data-update:v3 -- recovery status \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID"
```

```bash
npm run comment-data-update:v3 -- recovery resume \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --actor "$ACTOR"
```

`resume` must be idempotent. Completed immutable stages are reused. It must never create a second logical recovery for the same `recoveryId`.

---

## 7. Classification human handoff

Only when genuinely unresolved classification items exist:

```bash
npm run comment-data-update:v3 -- recovery classification open \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --actor "$ACTOR"
```

Before the ZIP is finalized, the implementation MUST assert for every item:

```text
priorIdentityLabel == none
AND
priorCommentLabel == none
```

The authority for this assertion is recovery-scoped:

1. build exact five-field dedupe groups for the current recovery corpus;
2. recover historical labels only for observation IDs belonging to those groups;
3. for each group, use the label from the newest classification version containing a group member (same-version conflict uses `worseThreeClassLabel()`);
4. bind that identity label to the first-win survivor;
5. derive comment-text labels only from those recovered survivor identity labels.

This intentionally reuses a historical label that exists only on a dedupe loser because the adopted five-field rule defines it as the same comment. Do **not** consult DB-global historical comment labels.

If a resolved item is present, fail with:

```text
CLASSIFICATION_WORKSET_CONTAINS_PREVIOUSLY_RESOLVED_ITEM
```

The workset artifact/receipt must record at least `recoveryId`, `recoveryPlanSha256`, `worksetId`, `corpusVersionId`, `classification input identity`, artifact SHA, item count, and `previouslyResolvedItemCount=0`. Recovery must reuse the existing three-class protocol validation rather than accepting an unbound response.

After producing the response artifact:

```bash
npm run comment-data-update:v3 -- recovery classification complete \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --response ./response.json \
  --actor "$ACTOR"
```

If review is required:

```bash
npm run comment-data-update:v3 -- recovery classification review \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --outcome accept \
  --rationale "Recovered cumulative corpus classification verified" \
  --actor "$ACTOR"
```

Then call `recovery resume`.

---

## 8. Keyword human handoff

When keyword handoff is required:

```bash
npm run comment-data-update:v3 -- recovery keyword open \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --actor "$ACTOR"
```

After producing the proposal artifact:

```bash
npm run comment-data-update:v3 -- recovery keyword complete \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --proposal ./candidate_proposal.json \
  --actor "$ACTOR"
```

If review is required:

```bash
npm run comment-data-update:v3 -- recovery keyword review \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --outcome accept \
  --rationale "Recovered cumulative corpus keyword selection verified" \
  --actor "$ACTOR"
```

Then call `recovery resume` until a corrected release is deployed.

---

## 9. Mandatory production verification command

After deployment, run:

```bash
npm run comment-data-update:v3 -- recovery verify \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID"
```

This is not a display-only status command. It must re-read the relevant immutable states/artifacts and the served deployment identity and fail closed if any invariant is violated. Verification of deployment must be read-back based: fetch the actually served release manifest and every public artifact, not only a release marker/status row. Reuse the existing deployed-release/provider verification path when available; otherwise extend the deployment adapter with an explicit read-back verifier.

It must verify at least:

```text
cutover state == recovery_frozen
current recovery inputs == registered recovery inputs
recomputed recovery range/projection == registered recovery plan
served release ID == corrected release ID
fetch served release manifest and all public artifacts (comments / keywords / accounts / overview)
validate served manifest/artifact hashes and contracts against corrected release
classification corpus dependency == recovered corpus version
keyword corpus dependency == recovered corpus version
keyword classification dependency == recovered classification version
classification observation set == cumulative survivor set
rebuild Source Dataset v2 deterministically from recovered corpus + classification
rebuilt source dataset record count == cumulative survivor count
materialized comments bytes/SHA == rebuilt Source Dataset v2 bytes/SHA
deployed comments bytes/SHA == rebuilt Source Dataset v2 bytes/SHA
keyword source_dataset_artifact_sha256 == rebuilt source dataset SHA
rebuild Overview from rebuilt Source Dataset v2 and compare bytes/semantic content to materialized AND fetched deployed overview
rebuild Account artifact from rebuilt Source Dataset v2 + pinned account policy and compare bytes/semantic content to materialized AND fetched deployed account artifact
fetched deployed keyword artifact SHA/semantic identity == corrected materialized keyword artifact and pinned keyword publication for rebuilt source dataset SHA
```

It must also enumerate all classification handoffs associated with the recovery and report aggregate ChatGPT safety evidence:

```text
classificationHandoffCount
chatGPTClassificationItemCount
previouslyResolvedItemCount == 0
```

The count must be derived from immutable handoff metadata/receipts, not supplied by the operator at verify time.

Successful verification must write an immutable verification receipt/artifact, for example:

```text
recovery-verification.json
```

containing at least:

```json
{
  "recoveryContract": "cumulative-corpus-recovery/v1",
  "recoveryId": "...",
  "recoveryPlanSha256": "sha256:...",
  "baseCorpusVersionId": "...",
  "brokenHeadCorpusVersionId": "...",
  "recoveredCorpusVersionId": "...",
  "classificationVersionId": "...",
  "keywordSelectionVersionId": "...",
  "releaseId": "...",
  "servedReleaseId": "...",
  "baseLogicalRecordCount": 24622,
  "appendedRawObservationCount": 11768,
  "duplicateObservationCount": 300,
  "logicalRecordCount": 36090,
  "classificationRecordCount": 36090,
  "sourceDatasetRecordCount": 36090,
  "deployedCommentsRecordCount": 36090,
  "sourceDatasetArtifactSha256": "sha256:...",
  "deployedCommentsArtifactSha256": "sha256:...",
  "overviewArtifactSha256": "sha256:...",
  "accountArtifactSha256": "sha256:...",
  "verificationReceiptOperationId": "recovery:<id>:verify",
  "classificationHandoffCount": 0,
  "chatGPTClassificationItemCount": 0,
  "previouslyResolvedItemCount": 0,
  "deploymentVerified": true,
  "verificationPassed": true
}
```

Again, `36090` is only correct when the actual duplicate count is `300`.

---

## 9.1 Recovery persistence authority

Do not add a recovery-progress table solely for this issue. Use deterministic operation IDs with the existing `application_operation_receipts` as the durable stage authority. Example IDs:

```text
recovery:<recoveryId>:corpus
recovery:<recoveryId>:classification-plan
recovery:<recoveryId>:classification-commit
recovery:<recoveryId>:source-dataset
recovery:<recoveryId>:release
recovery:<recoveryId>:deployment
recovery:<recoveryId>:verify
recovery:<recoveryId>:complete
```

`recovery status` reconstructs progress from these receipts plus immutable versions/release/deployment rows. The successful `verify` receipt is the authority used by `complete`. A generated `recovery-verification.json` is a convenience mirror for issue evidence; its SHA must be recorded in the verify receipt, but the file itself is not the control-plane authority.

---

## 10. Complete recovery

Freeze may be released only after a successful verification receipt exists:

```bash
npm run comment-data-update:v3 -- recovery complete \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --actor "$ACTOR"
```

`complete` must reject unless cutover state is `recovery_frozen` and `recovery verify` has succeeded for the exact corrected release currently being served. On success it records a completion receipt bound to the verification receipt and applies `recovery_completed`, returning cutover state to `smoke_verified`.

---

## 11. Definition of Done for this issue

The issue MUST NOT be closed based only on implementation, unit tests, E2E fixtures, release generation, or a successful dry-run.

All of the following are mandatory:

1. the implemented recovery flow is executed against the target production state beginning with `recovery freeze`, then drain/plan/start;
2. a corrected cumulative Corpus v2 is created from the explicitly selected base through the broken head;
3. `baseLogicalRecordCount`, `appendedRawObservationCount`, and `duplicateObservationCount` are calculated using the ordered five-field first-win rule and satisfy the expected logical-count equation;
4. classification covers the cumulative survivor set exactly, reusing recoverable labels from exact-dedupe group members before any ChatGPT handoff;
5. `previouslyResolvedItemCount == 0` for all ChatGPT classification handoffs;
6. Source Dataset v2 is generated from the corrected corpus/classification;
7. Keyword / Account / Overview / Comments all bind to that same source identity;
8. the corrected release is actually deployed;
9. `recovery verify` succeeds against the deployed release and generated artifacts;
10. `recovery-verification.json` (or equivalent immutable evidence) is attached/referenced in the issue;
11. only then is `recovery complete` executed, a completion receipt is recorded, and normal starts resume from `smoke_verified`.

If any item is missing or unverified, the issue remains open.
