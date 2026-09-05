# CHANGE_CONTROL

## 目的

次回以降、ラベル基準が無自覚に変化することを防ぐ。

## 変更時に必ず記録する項目

- 日付
- policy version
- 変更者
- 変更対象
- 変更理由
- 追加/削除した語
- 旧データに対する影響件数
- 回帰テスト変更内容
- 後方互換性の有無

## Versioning

### PATCH

挙動を変えない文書修正・誤字修正。

例:
`1.0.0 -> 1.0.1`

### MINOR

新しい review cue の追加など、
自動最終ラベルは原則変えないがレビュー範囲が変わる変更。

例:
`1.0.0 -> 1.1.0`

### MAJOR

自動ラベル遷移、ラベル定義、優先順位等を変更。

例:
`1.0.0 -> 2.0.0`

## 禁止

既存 version の config を上書きして、
同じ version 名のまま挙動を変えてはいけない。

## Applied change: 1.1.0

- 日付: 2026-08-24
- 変更対象: review resolution / final publication / lineage safety
- 自動分類遷移: 変更なし
- baseline candidate件数: 変更なし
- 変更理由: stale input/override と未解決finalの誤利用をfail-closed化
- 後方互換性: 分類結果は互換、ワークフロー/成果物名は一部非互換
- 回帰テスト: 9群へ拡張

## Applied change: 1.2.0

- 日付: 2026-08-24
- 変更対象: reviewed-case persistence / golden adjudication
- 自動分類遷移: 変更なし
- golden適用範囲: exact `record_key` only
- baseline mandatory review: 124行 -> 0未解決
- 変更理由: 確定済み境界判断を再利用可能かつ監査可能にし、未知データへ一般化しないため
- 後方互換性: `--no-golden`でv1.1.0 term-only candidateを再現可能。既定finalはgolden適用により更新。
- 回帰テスト: 13群へ拡張
- 注意: 過去の失われた41+1例外ロジックの復元ではない

## Applied change: 1.3.0

- 日付: 2026-08-24
- 変更対象: optional P2 exact-case adjudication / provenance separation
- deterministic provisional rules: 変更なし
- baseline P2: 346行のうち高信頼338行を確定、8行を未解決維持
- P2確定内訳: normal維持239 / reactive 82 / direct_nuisance 17
- 変更理由: 同じP2を永久に再監査することを避けつつ、曖昧例や未知データへ一般化しないため
- registry: `reference/three_class_p2_adjudications.json`
- fail-closed: P2-only reason drift、P0/P1 registry重複、manual override競合を拒否
- 後方互換性: `--term-only`でdeterministic v1.1 baselineを再現可能
- 回帰テスト: 19群へ拡張


## Applied change: 1.4.0

- 日付: 2026-08-24
- 変更対象: v1.3残存P2 8件の境界再評価
- deterministic provisional rules: 変更なし
- 追加exact P2: 7件（normal 3 / reactive 1 / direct_nuisance 3）
- P2 registry合計: 345件（normal 242 / reactive 83 / direct_nuisance 20）
- 未解決P2: 8 -> 1
- 変更理由: 現行仕様で確定可能な境界だけを固定し、両読みに決着しない短文は推測で埋めないため
- 新規defer状態: 不採択。1件のためにpipeline stateを増やさず既存review contractで保持
- 後方互換性: `--term-only`のdeterministic baselineは不変
- 回帰テスト: 20群へ拡張
