# Work Items / Implementation Order

実装は以下の順序で行う。Foundationは単独merge可能だが、production semanticsを変更する項目は同一cutoverで有効化する。

## Ticket 1 — Ordered reader + cumulative projection foundation

### 変更

- `src/database/raw-snapshot-repository.js`
  - observationに`observationId`を返す。
  - `readSelectedSnapshotsInReferenceOrder(db, refs)`追加。
- `src/processing/analysis-input/raw-snapshot-projection.js`
  - legacy `projectRawSnapshots()`は変更しない。
  - `projectCumulativeCorpus()`追加。

### Done

- ref順が維持される。
- snapshot内はsource_index ASC。
- 5-field exact first-win dedupeが成立。
- normalizationがないことをテスト。

---

## Ticket 2 — Corpus v2 semantic state

### 変更

- `src/application/v3/domain-services.js`
  - `CorpusApplicationServiceV3.update()`をhead累積型に変更。
  - caller supplied `request.state`でcorpus全体を決定するproduction pathを撤去。
  - v1 headは`CORPUS_BOOTSTRAP_REQUIRED`。
- `src/application/services.js`
  - `typedCorpusHandler()`のsnapshot ref serialization修正。

### Done

- v2 head + incoming → ordered cumulative refs。
- duplicate snapshot ref → no-op。
- semantic unchanged →新versionなし。
- v1 headの通常更新は禁止。
- normal v3 session startも、session/evidence作成前にv1 headを拒否する。

---

## Ticket 3 — Versioned cumulative classification planner

### 新規推奨

- `src/three-class/cumulative-classification-plan.js`

### 変更

- `src/database/three-class-label-repository.js`
  - classificationVersion限定label readerを追加。
- `src/application/v3/domain-services.js`
  - prepare/assessを同一plannerへ統一。
  - legacy workset DB-global label pathをv3から外す。

### Done

- exact observationId → prior comment text → human decisionの順。
- complete stateが全survivorを含む。
- ChatGPT対象は真に未解決のみ。
- handoff直前safety assertionあり。

---

## Ticket 4 — Classification handoff cutover

### 変更

- `ClassificationHandoffService`
- `scripts/comment-data-update-v3-operator.mjs`

### Done

- production builderがsingle `--snapshot-ref`を使わない。
- legacy `generate-three-class-workset` CLIの既存意味論は維持。
- v3はcorpusVersion + pinned ClassificationVersionからITEMS/HISTORYを決定的に作る。

---

## Ticket 5 — Source Dataset v2

### 変更

- `src/processing/optimicom-ui-release/source-dataset.js`
- `scripts/adapters/keyword-candidate-comment-db.js`
- 関連serializer / validator

### Done

- exactly-one-snapshot制約撤去。
- sourceにcorpusVersionId/classificationVersionId/snapshotRefs。
- recordsはsurvivor順・source_index再採番。
- classification coverage exact match。

---

## Ticket 6 — Downstream source unification

### 変更

- keyword candidate/publication path
- account analysis path
- overview path
- comments artifact path

### Done

全てが同じSource Dataset v2を入力authorityにする。独自snapshot再読込禁止。

---

## Ticket 7 — Release consistency gates

### 変更

- `src/application/v3/release-services.js`
- `src/processing/optimicom-ui-release/release.js`
- `scripts/export-v3-optimicom-ui-release.mjs`

### Done

- classification/corpus pin整合。
- keyword/corpus/classification pin整合。
- source SHA整合。
- downstream source identity整合。
- production `request.artifacts` override撤去。
- manifest v2へ移行。

---

## Ticket 8 — Recovery bootstrap

### 変更

Recovery専用application/orchestrationを追加する。通常updateと混ぜない。

### 必須入力

```text
baseCorpusVersionId
brokenHeadCorpusVersionId
```

### Done

- recovery rangeからCorpus v2を再構成。
- historical classificationはcurrent recovery corpusのexact 5-field dedupe group membersに限定して検索し、group identity labelをsurvivorへ復旧。
- dedupe loser側だけにlabelがあるケースもChatGPTへ再送しない。
- 真に未解決のみChatGPTへ。
- idempotentに再実行可能。

---

## Ticket 9 — Freeze / deploy / recovery completion

### 変更

- `src/migration/v3-cutover.js`または同等のplanned recovery control

### Done

- `smoke_verified -> recovery_frozen`でnew v3 startsをfreeze。
- `recovery_frozen`から`fix_forward_v3`を許可しない。
- nonterminal sessionsをdrainしてからbootstrap。
- corrected release deployment verification前にstartsを再開しない。
- matching verification receipt付き`recovery_completed`だけで`smoke_verified`へ戻す。
- failure時は旧欠落releaseへrollbackせず`recovery_frozen`のままretry。

---

## Ticket 10 — Web consumer cutover

Discussion set外の実Web consumerを確認する。

### Done

- Source Dataset v2を読める。
- `schema_version === 1`や`snapshot_ref`固定依存がない、または同一cutoverで修正済み。

---

## Ticket 11 — Regression E2E

新規推奨:

```text
tests/v3-cumulative-corpus-update.test.js
```

### Done

以下が同一logical corpus identityを持つことを1シナリオで確認。

- cumulative projection
- classification
- source dataset
- keyword source
- account source
- overview source
- release comments

---

## Ticket 12 — Recovery CLI contract

### 変更

`scripts/comment-data-update-v3-operator.mjs`相当の既存operatorにtop-level `recovery` commandを追加する。

Required:

```text
recovery freeze
recovery plan
recovery start
recovery cancel
recovery status
recovery resume
recovery classification open|complete|review
recovery keyword open|complete|review
recovery verify
recovery complete
```

### Done

- workspace rootから`npm run comment-data-update:v3 -- recovery ...`で実行可能。
- `freeze`は`smoke_verified -> recovery_frozen`へ遷移しstartsを停止。
- drain後にのみ`plan`を許可。`plan`はnon-mutatingで`recoveryContract`, deterministic `recoveryId`, lineage, canonical counts, plan SHAを返す。
- `cancel`は最初のmutating recovery stageより前だけ許可。
- `start`はreview済みplan SHAへbindし、freeze/drain後に同一planを再計算してからcorpus mutationする。
- reviewed planと`start`時再計算planが不一致なら`RECOVERY_PLAN_STALE`で`recovery_frozen`維持。
- `resume`はidempotent。stage authorityはdeterministic `application_operation_receipts`。
- `status`はreceipt + immutable stateから再構成。専用progress tableは追加しない。
- `verify`はDB + generated artifacts + served deploymentを再検証し、DB receiptをauthorityとして保存する。
- `complete`は成功済みverification receiptなしでは`recovery_frozen`を解除できない。

---

## Ticket 13 — Production recovery and issue-close evidence

これは実装テストではなく、本issueのproduction完了作業。

### Done

- 実装したrecovery CLIをtarget production stateへ実行済み。
- corrected cumulative releaseを実deploy済み。
- `recovery verify`成功済み。
- verification evidenceに以下を含む:
  - recovery/base/broken/recovered version IDs
  - classification/keyword/release IDs
  - baseLogical/appendedRaw/duplicate/logical counts
  - classification/source/deployed comment counts
  - source/deployed artifact SHA
  - ChatGPT item count
  - `previouslyResolvedItemCount = 0`
  - deployment verified=true
- evidenceをissueへ添付または参照済み。
- その後のみ`recovery complete`を実行。

このTicketが未完了ならissueをcloseしない。
