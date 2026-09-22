# Cumulative Corpus Update — Implementation Handoff

## 目的

Comment DB v3 の更新を、**既存有効データ + 追加データ - 重複**を常に母集団とする累積更新へ変更する。

実装後、デプロイされる以下の成果物はすべて同一の logical cumulative corpus を使用しなければならない。

- Classification
- Keyword analysis / publication
- Account analysis
- Overview
- Comments source dataset
- UI Release / deployed artifacts

## 不変ゴール

```text
Deployed Analysis Population
=
firstWinsDeduplicate(
  Existing Valid Corpus
  + Newly Added Data
)
```

重複判定キーは次の5項目の**保存値完全一致**とする。

```text
(username, handle, comment, postedAt, postedDate)
```

- first-wins
- 既存corpusのsnapshotを追加snapshotより先に評価
- normalizationなし
- trimなし
- case foldingなし
- Unicode normalizationなし
- 日時丸め・再解釈なし

## このhandoffの使い方

1. `01_IMPLEMENTATION_SPEC.md` を仕様の正本として読む。
2. `02_WORK_ITEMS.md` の順序で実装する。
3. `03_CHANGE_MAP.md` で変更対象と非変更対象を確認する。
4. `04_ACCEPTANCE_TESTS.md` を全てgreenにする。
5. 既に欠落状態がproductionに存在する場合は `05_RECOVERY_RUNBOOK.md` を実行する。
6. `06_FLOW.puml` は業務フロー確認用。
7. `07_CURRENT_CODE_EVIDENCE.md` は現行コード上の問題箇所の索引。

## 重要な禁止事項

- raw snapshotを削除・上書き・全量再materializeして正本化しない。
- legacy three-class workset DBをmulti-snapshot対応の正本へ拡張しない。
- DB全履歴のlabelを通常更新のauthorityにしない。
- 既存分類済みcommentをChatGPTへ再投入しない。
- corpusだけ先に累積化してproduction deployしない。
- source dataset / keyword / releaseのsingle-snapshot前提を残したままcutoverしない。
- 欠落した旧releaseを「正しい状態」としてrollbackしない。

## Discussion setの制約

添付discussion setにはUI実装そのものが含まれていない。実Web consumerがsource dataset v1の`schema_version`や`snapshot_ref`へ依存している場合は、source dataset v2対応を同一cutoverに含めること。

## 完了定義

このhandoffのacceptance matrixが全てgreenであり、production recovery対象がある場合はcorrected releaseのdeployment verificationまで完了していること。
