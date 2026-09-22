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
