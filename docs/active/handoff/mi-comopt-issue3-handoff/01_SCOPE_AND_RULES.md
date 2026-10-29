# 01 要求・用語・不変条件

## 実装する振る舞い

**一括修正は1つの業務操作**。CorrectionItemの各要素に対応する個別Session/Proposal/Decision/Version/Publicationを作成しない。1件だけの入力も新契約ではCorrectionBatchとして扱う。既存単一修正契約は変えない。

1. **要求**: 1件以上の `{targetObservationId, expectedLabel, replacementLabel, reason, provenance?}`。共通のbase Classification/Corpus/分類Policy Versionを固定し、後続公開に必要なVersionもpinする。
2. **対象**: 対象代表Observationを含む、固定Corpusのsurvivor集合のうち、`commentText`が**完全一致**する全Observation。trim、NFKC、大小文字変換、数値IDへの無条件変換は禁止。
3. **検証**: 不明対象、不正ラベル、空理由、変更なし、グループ重複・矛盾、期待ラベル不一致、coverage欠損はバッチ全体を不成立とする。
4. **評価**: 全修正を集約したCorrectionChangeSet、1 Assessment、1 Proposalを生成。レビュー対象の内容・件数・変更前後の分布・根拠を固定する。
5. **分類承認**: Human Taskはバッチ全体に対し1件。承認・却下の2択。部分承認なし。
6. **commit**: 承認時、同一DBトランザクション内でHead・依存Version・対象・差分・Assessment・Proposal・semantic hashを再検証し、1 Classification Version作成とHead更新を原子的に行う。
7. **後続**: 確定したClassification VersionでKeyword Selection→Release→Production Promotion（別途Human承認）→Deployment→identity検証を1経路で処理。各段階の再試行は可能だが同一論理成果物の二重作成は禁止。
8. **不成立**: 却下、入力不正、分類・Corpus Head競合時は後続のRelease/Promotion/Deploymentに進まない。
9. **既存機能**: `classification-correction@1`の定義hash `ed591d63927ebef56db9412d9fdb9a48b39ec6e2f0283aedef9cdedb8b8adabd`、`comment-data-update@3/@4`、新規分類・累積継承の契約を維持。

## 用語

| 概念 | 意味 |
|---|---|
| CorrectionBatch | 複数修正を不可分に扱う業務操作。`correctionOperationId`で識別。 |
| CorrectionItem | 代表Observationに対する、期待ラベル→変更後ラベルの要求。 |
| CommentGroup | 1 Corpus Version内で本文が完全一致するsurvivor集合。 |
| CorrectionChangeSet | 全CorrectionItemを実際のObservation変更へ展開した不変値。 |
| Assessment | 対象・件数・分布・coverage・根拠の検証結果。 |
| Proposal | 固定ChangeSetと提案Classification状態を承認対象として特定。 |
| Decision | Proposal全体へのHumanの承認/却下。 |
| ClassificationVersion | commit成功時に作成する不変分類状態。 |
| Publication | 1つのClassificationVersionから続く後続の更新と公開。 |

## 識別子の区別

- `sessionId`: Work Orchestratorの実行を識別。
- `ctx.operationId`: **現行実装は `${sessionId}/${stepId}`**。Task試行の安定識別子。
- `correctionOperationId`: 別Sessionで再送しても変わらない**業務操作ID**。重複成果物の防止に使う。
- `requestFingerprint`: 入力の意味上の同一性。業務操作IDとの組を検証。
- `changeSetHash`: 展開された全対象・全差分の一致を検証。
- `proposalSha256`と`proposedStateSemanticSha256`: 提案自体と分類状態を区別して検証。

## Issue #3の照合値（受け入れ試験用、汎用コードには固定しない）

- 元の分類: Version 12 / `version_67c4dfa11ecb223a5f41d1c92c67dcb8`
- Corpus: `version_9ae43beeb67a924bdd62dc837b50d734`
- 分類policy: `policy_9473a17cbcabc21d56e44fc5b8b63c7e`
- 正本: `docs/active/handoff/response (3).json`
- 正本SHA-256: `ccbca9c459ab7dc564d499e1dd2b8db151819d8d5324b5e76b331998e4c6289b`
- Workset: `809c68f0-7345-44c4-af1c-24a11c9b9018`
- I番号の根拠: `production-comment-data-update-20261028T221851Z-codex/03a-prepare-classification-handoff` の保存済みreceiptの `classificationPlan.handoffItems`。
- 25本文グループ / 29観測。変更は全て `normal`→`direct_nuisance`。
- 全44,419件の期待分布: `normal=41,427`, `direct_nuisance=1,246`, `reactive=1,746`。
- `I204`の5観測: `45921,46365,46445,46935,47243`。コメント本文は `うおwかっかー.`。

この数値は元のVersionを基準にした期待値。実行前に正本hashとHeadを再照合すること。
