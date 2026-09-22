# Decisions and Non-goals

## Adopted decisions

1. Corpusはimmutable raw snapshotsの順序付き集合として保持する。
2. logical corpusはcumulative projectionで生成する。
3. dedupeは5項目完全一致・first-wins。
4.既存snapshotをincomingより先に評価する。
5. Corpus semantic stateはschema v2へ移行する。
6. Classificationはversioned stateをv3 authorityにする。
7. ChatGPTには既存classificationで解決できないcommentだけを送る。
8. handoff直前にresolved item非混入assertionを追加する。
9. Source Datasetはcorpus-aware v2へ移行する。
10. Keyword / Account / Overview / Commentsは同じSource Dataset v2を使用する。
11. Releaseはdependency pinsとsource SHAをfail closedで検証する。
12. 既存の壊れたheadは明示baseからone-time recoveryする。
13. Recovery failure時はold broken semanticsへrollbackせずfix-forwardする。
14. 新production writerはv2-only。legacy v1 verifierは残してよい。

## Rejected alternatives

### Replace corpus with incoming snapshot

今回の障害原因。却下。

### Materialize a new full canonical raw snapshot every update

全observation identityを再発行しclassification mappingを複雑化する。却下。

### Extend legacy three-class workset DB to multi-snapshot authority

workset snapshot tableがcorpus precedence / per-observation dedupe survivorを表現できない。二重authorityになる。却下。

### Dedupe by comment text only

誤爆範囲が広すぎる。却下。

### Normalize before dedupe

今回合意したexact-match semanticsを超える。却下。

### Union all raw snapshots in DB during recovery

未承認入力まで混入し得る。却下。

### Union all historical corpus versions without explicit base

過去の意図的状態まで復活する危険がある。却下。

### Keep v1 and v2 as simultaneous production authorities

split-brainを再導入する。却下。

## Non-goals

- legacy CLI全体の再設計
- workflow v3 revision変更
- projection-definition policyの意味変更
- raw snapshotの物理削除
- このissueだけを理由にDB table shapeを変更すること
- dedupe false-positiveを完全に0にすること

## Review additions

15. Recovery時はcurrent recovery corpusのexact five-field dedupe groups内だけhistorical labelを検索し、group identity labelをsurvivorへ復旧する。same-comment継承元はidentity-resolved current survivorsだけ。DB-global historical comment labelsは使用しない。
16. Recovery CLIにnon-mutating `plan`を設け、`start`はreview済みplan SHAへbindする。
17. Issue完了判定にはproduction `recovery verify`成功を必須とする。
18. `recovery complete`はmatching verification receiptなしでは実行不可とする。

### Rejected: recovery same-comment labels from all DB history

復旧対象corpus外の古いlabelを再流入させ得るため却下。

### Rejected: issue close after CI / generated release only

今回の既知production欠落を実際に直した証明にならないため却下。corrected releaseの実deployとdeployed artifact verificationを必須とする。

### Rejected: status-only production validation

statusは既存記録の表示に留まり得る。`recovery verify`でDB・artifact・served releaseを再読込して検証する方式を採択。


## Review round 2 decisions

### Dedicated `recovery_frozen` vs reuse `v3_frozen`

**Adopted: dedicated `recovery_frozen`.** Reusing `v3_frozen` leaves an existing `fix_forward_v3` escape path that can re-enable starts before recovery verification. A new state value requires no DB table-shape migration. After recovery mutation begins, the only successful exit is `recovery_completed`; `recovery_cancelled` is allowed only before mutation.

### Recovery label lookup: survivor IDs only vs exact-dedupe groups

**Adopted: exact five-field dedupe groups.** If a dedupe loser has the historical label but the first-win survivor does not, survivor-only lookup would unnecessarily re-send an already-classified logical comment to ChatGPT. Search history only for observation IDs inside the current recovery corpus's exact-dedupe groups; never DB-global comment history.

### Recovery progress table vs existing operation receipts

**Adopted: existing `application_operation_receipts`.** Stage operation IDs are deterministic. `status` reconstructs progress from receipts and immutable versions/releases; no new recovery progress table is added.

### Ambiguous incident counts vs canonical count semantics

**Adopted: `baseLogicalRecordCount + appendedRawObservationCount - duplicateObservationCount`.** This remains correct even when the base contains internal duplicates or later corpus versions repeat snapshot refs.


### Freeze/drain before plan vs plan before freeze

**Adopted: freeze -> drain -> plan -> start.** This removes the race in which normal sessions can change the reviewed recovery inputs after planning. `start` still recomputes the canonical plan before mutation.

### Deployment marker only vs deployed artifact read-back

**Adopted: read back the served manifest and all public artifacts.** Marker-only verification cannot detect partial/corrupt deployment. `recovery verify` must fetch the deployed release manifest plus comments/keywords/accounts/overview artifacts, validate their hashes/contracts, and compare them with the corrected generated release.
