# Integrated Labeling Handoff v1.4.0

Stage 13 の `normal / nuisance` と、その確定結果を `direct_nuisance / reactive / normal` に分解する3分類工程を、1つの再現可能な handoff に統合したパッケージです。

## 採択アーキテクチャ

```text
更新版5フィールドJSON
  -> Stage 13 回帰照合
  -> Stage 13 新規/変更分レビュー
  -> Stage 13 clean output
  -> 3-Class deterministic provisional
  -> exact-record P0/P1 golden adjudication
  -> exact-record high-confidence P2 adjudication
  -> 未登録P0/P1のみ manual review
  -> publication gate
  -> final clean output
  -> audit sidecar / validation report
```

Stage 13 と3分類の判定ロジックは融合しません。直列に接続し、共通監査層で束ねます。

## v1.4.0 の重要変更

v1.3.0で意図的に残したP2 8件を、既存338件の境界例と現行仕様へ再照合しました。

比較した案は、(A) 8件をすべて強制確定、(B) 確定可能なものだけexact-caseで確定し曖昧例を残す、(C) 1件のために恒久defer状態を新設、の3案です。誤確定を避け、パイプライン状態を増やさない **B** を採択しました。

- 7件を追加exact-case adjudication。
  - `normal`: 3件
  - `reactive`: 1件
  - `direct_nuisance`: 3件
- P2 registry合計: 345件。
  - `normal`: 242件
  - `reactive`: 83件
  - `direct_nuisance`: 20件
- 「痛いよ！痛い痛い」1件だけは、身体的痛みとcringe評価の両読みに文面だけでは決着できないため未解決のまま保持。
- 追加7件もexact `record_key`にだけ適用し、語彙ルールへ一般化しない。
- 新しいdefer機構は導入しない。曖昧性を1件の監査項目として明示的に残す。

v1.2.0のP0/P1 golden 123 unique key / 124行、およびv1.3.0のP2 338件はそのまま保持します。

## baseline v1.4.0

- records: 21,433
- `reactive`: 1,225
- `normal`: 19,659
- `direct_nuisance`: 549
- unresolved P0/P1: 0
- unresolved P2: 1
- final publication: allowed

## 最重要不変条件

- 元の5フィールドを変更しない。
- Stage 13 / 3-Class の利用用JSONは5フィールド + `label` のみ。
- 監査情報はsidecarに分離する。
- Stage 13参照データと5フィールド完全一致するレコードは既存2値ラベルを固定継承する。
- Stage 13では同一handle履歴を使える。3分類では使わない。
- `normal -> direct_nuisance` は自動では行わない。v1.4.0までの20件は明示的exact-case review結果。
- P0/P1/P2のadjudicationはexact `record_key` 以外へ波及させない。
- P0/P1未解決の3分類はfinalとして公開しない。P2未解決は監査対象だがpublicationを妨げない。

## 更新版5フィールドJSONから開始

```bash
python src/pipeline.py prepare-stage13 INPUT.json --outdir work
```

`work/stage13_adjudications.csv` のpending行について、`source_record_sha256` は変更せず、`label` と `note` を記入します。

```bash
python src/pipeline.py finalize-stage13 INPUT.json \
  --workspace work \
  --adjudications work/stage13_adjudications.csv \
  --output work/stage13_labeled.json
```

```bash
python src/pipeline.py three-class work/stage13_labeled.json \
  --outdir work/three_class \
  --strict-final
```

既存registryと完全一致するP0/P1/P2は自動的に解決されます。新規P0/P1が残る場合だけ `manual_overrides.csv` の `label` と `note` を埋めて再実行します。未解決P2は `optional_p2_overrides.csv` に分離されます。

```bash
python src/pipeline.py three-class work/stage13_labeled.json \
  --outdir work/three_class_final \
  --overrides work/three_class/manual_overrides.csv \
  --strict-final
```

診断モード:

```bash
# 全adjudicationを無効化してdeterministic term-onlyを再現
python src/pipeline.py three-class reference/stage13_labeled_REFERENCE.json \
  --outdir diagnostic_term_only \
  --term-only

# P0/P1 goldenだけ無効化
python src/pipeline.py three-class reference/stage13_labeled_REFERENCE.json \
  --outdir diagnostic_no_golden \
  --no-golden

# P2 adjudicationだけ無効化
python src/pipeline.py three-class reference/stage13_labeled_REFERENCE.json \
  --outdir diagnostic_no_p2 \
  --no-p2-adjudications
```

## 最終検証

```bash
python src/pipeline.py validate \
  --input INPUT.json \
  --stage13 work/stage13_labeled.json \
  --three-class work/three_class_final/three_class_labeled.json \
  --reference reference/stage13_labeled_REFERENCE.json \
  --three-class-audit work/three_class_final/audit_three_class.json \
  --require-resolved
```

## テスト

```bash
python tests/run_all_tests.py
```

外部Pythonライブラリは不要です。Python 3.9+ を想定します。
