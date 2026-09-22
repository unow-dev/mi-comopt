# Production Recovery Runbook

## 目的

現在headが追加分だけを参照しており、旧有効データがcorpusから脱落しているproduction状態を一度だけ復旧する。

通常更新ロジックの修正だけでは既に脱落したデータは戻らないため、本runbookは必須。

## 事前に人間が確定する値

```text
baseCorpusVersionId
```

旧有効データ（例: 24,622件）を保持していた正常なversionを指定する。コードで推測しない。

```text
brokenHeadCorpusVersionId
```

recovery開始時点の壊れたcurrent head。

## recovery identity

`recoveryContract + baseCorpusVersionId + brokenHeadCorpusVersionId`から決定的な`recoveryId`を作る。

同一recoveryIdへ異なる入力を再利用した場合はidempotency conflictで拒否する。

## Procedure

### 1. Freeze

- cutover stateを`smoke_verified -> recovery_frozen`へ遷移。
- v3 new startsを停止。
- legacy writerは無効のまま。
- v2 new startsは0。
- この時点ではまだcorpus/classificationを変更しない。

### 2. Drain

- nonterminal v3 sessionsが0になるまでplan/startを開始しない。

### 3. Stable plan / head re-check

freeze + drain後に`recovery plan`を実行し、以下を確認する。

```text
cutover state == recovery_frozen
nonterminal v3 sessions == 0
current corpus head == brokenHeadCorpusVersionId
base / broken head are on the same committed corpus ancestry
```

不一致ならmutationを開始しない。freezeは維持。`start`はplan SHAを再計算し、不一致なら`RECOVERY_PLAN_STALE`。

### 4. Build recovery Corpus v2

対象:

```text
base version ～ broken head
```

順序:

- state versions: version_no ASC
- v1 state内refs: legacy SHA/index order
- v2 state内refs: saved order
- snapshot ref duplicates: first-win unique

### 5. Project cumulative corpus

5-field exact first-win ruleを適用。

### 6. Recover classification

survivorと各exact 5-field dedupe group member observation IDsを先に固定する。

各survivor dedupe group:

1. group member observation IDsのhistorical labelを検索し、最新classification versionのlabelをidentity labelとしてsurvivorへ復旧
2. identity labelがないsurvivorは、current survivorsに復旧済みidentity labelsから構築したsame-comment label
3. human classification

ChatGPTへ送る直前にresolved item非混入assertionを行う。

### 7. Build Source Dataset v2

classification exact coverageを検証してから生成。

### 8. Regenerate all downstream artifacts

同じSource Dataset v2から以下を再生成。

- keyword
- account
- overview
- comments

### 9. Build / Review / Promote corrected Release

cross-pin / SHA integrity gateを通す。

### 10. Deploy and verify

- served release ID
- served release manifestとcomments / keywords / accounts / overviewを実配信先からread-back
- recovered corpus + classificationからSource Dataset v2を再生成したbytes/SHA
- materialized/deployed commentsが再生成Source Datasetと完全一致
- Overview / Accountを同じsourceから再生成してartifact一致
- Keyword publicationが同じsource dataset SHAへbinding

を確認。

### 11. Resume starts

corrected deployment verification成功後だけfreezeを解除。

## Failure behavior

Recovery開始後の失敗時:

- 欠落した旧releaseを「正解」としてrollbackしない。
- 現在serve中のreleaseが残っている間はserve継続可。
- new startsはfreeze維持。
- 完了済みimmutable stageを再利用してfix-forward/retry。

## Production validation

Productionではcanonical count equationを確認する。

```text
expectedLogicalRecordCount
= baseLogicalRecordCount
+ appendedRawObservationCount
- duplicateObservationCount
```

今回、base logical countが24,622、appended raw countが11,768、duplicate countが300と実測された場合のみ36,090件となる。固定値へ合わせるのではなく、実測duplicate countと再生成artifact identityをauthorityとする。

---

## Required CLI execution sequence

From workspace root:

```bash
DB="<production-comment-db.sqlite3>"
WORKSPACE="<production-workspace>"
ACTOR="<operator-id>"
BASE_CORPUS_VERSION_ID="<normal base corpus version>"
BROKEN_HEAD_CORPUS_VERSION_ID="<current broken corpus head>"
```

### A. Freeze and drain

```bash
npm run comment-data-update:v3 -- recovery freeze \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --actor "$ACTOR"
```

Then confirm nonterminal sessions are zero:

```bash
npm run comment-data-update:v3 -- sessions \
  --db "$DB" \
  --workspace "$WORKSPACE"
```

Do not run recovery mutation while a nonterminal v3 session remains. If the operation is abandoned before any mutating recovery stage, use `recovery cancel --actor "$ACTOR" --rationale "..."`; cancel is forbidden after recovery mutation begins.

### B. Non-mutating preflight plan

```bash
npm run comment-data-update:v3 -- recovery plan \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --base-corpus-version-id "$BASE_CORPUS_VERSION_ID" \
  --broken-head-corpus-version-id "$BROKEN_HEAD_CORPUS_VERSION_ID"
```

Review `recoveryContract`, `recoveryId`, ordered recovery range, `recoveryPlanSha256`, and the canonical counts:

```text
baseLogicalRecordCount
appendedRawObservationCount
duplicateObservationCount
expectedLogicalRecordCount
```

### C. Start

```bash
npm run comment-data-update:v3 -- recovery start \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --base-corpus-version-id "$BASE_CORPUS_VERSION_ID" \
  --broken-head-corpus-version-id "$BROKEN_HEAD_CORPUS_VERSION_ID" \
  --expected-plan-sha256 "$RECOVERY_PLAN_SHA256" \
  --actor "$ACTOR"
```

### D. Inspect / resume

```bash
npm run comment-data-update:v3 -- recovery status \
  --db "$DB" --workspace "$WORKSPACE" --recovery-id "$RECOVERY_ID"
```

```bash
npm run comment-data-update:v3 -- recovery resume \
  --db "$DB" --workspace "$WORKSPACE" --recovery-id "$RECOVERY_ID" --actor "$ACTOR"
```

Use the classification/keyword handoff subcommands defined in `11_RECOVERY_CLI_AND_DOD.md` if the recovery stops at a human gate.

### E. Mandatory deployed verification

After corrected deployment:

```bash
npm run comment-data-update:v3 -- recovery verify \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID"
```

This MUST pass before completion. The DB `application_operation_receipts` verify receipt is the control-plane authority. Preserve the generated `recovery-verification.json` mirror and attach/reference it from the issue.

### F. Unfreeze only after verification

```bash
npm run comment-data-update:v3 -- recovery complete \
  --db "$DB" \
  --workspace "$WORKSPACE" \
  --recovery-id "$RECOVERY_ID" \
  --actor "$ACTOR"
```

The command must reject unless cutover state is `recovery_frozen` and the matching deployed verification receipt exists. Success returns the cutover state to `smoke_verified`.
