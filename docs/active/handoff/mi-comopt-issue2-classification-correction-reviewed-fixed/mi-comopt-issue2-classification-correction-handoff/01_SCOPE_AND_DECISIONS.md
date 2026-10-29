# 01. 目的・確定事項・非目標

## 目的

[Issue #2](https://github.com/unow-dev/mi-comopt/issues/2) が要求するのは、**既に分類済みのコメントの誤分類を明示的に訂正する業務経路**である。通常のコメント更新や未分類 workset には混入させず、新しい承認済み Classification Version を通じて反映する。

## 確定した業務ルール

| ID | 規則 |
|---|---|
| BR-01 | 手動訂正の対象は既存の分類済み observation ID で指定する。 |
| BR-02 | 業務上の修正範囲は、対象 Corpus 内の survivor における**完全一致 `commentText` グループ全体**。文字列の trim / case-fold / Unicode 正規化は行わない。 |
| BR-03 | 1要求につき1グループを訂正する。複数グループの一括編集は非対象。 |
| BR-04 | 入力に `baseClassificationVersionId`、`observationId`、`expectedLabel`、`newLabel`、非空の `reason` が必要。要求者は認証済み Session 起動者から確定する。 |
| BR-05 | `normal`、`reactive`、`direct_nuisance` のみ有効。`newLabel !== expectedLabel`。 |
| BR-06 | 修正元の Classification Version と対応 Corpus Version は明示的に固定し、現行 Head との競合を拒否する。 |
| BR-07 | 修正後の状態は Corpus の全 survivor observation に対するラベルを含む完全状態。対象グループ以外は変化しない。 |
| BR-08 | Proposal 作成後は**必ず Human Review**。`accept` で新 Classification Version、`reject` で新 Version なし。 |
| BR-09 | 基準 Version、対象、旧/新ラベル、理由、要求者、承認者・判断・時刻を既存 Proposal / Assessment / Decision / Version から監査可能にする。要求者・承認者のIDは認証済みの操作主体から取得し、任意入力文字列だけを証拠としない。 |
| BR-10 | 将来の通常分類は訂正済み pinned Classification Version を継承し、旧ラベルを自動復活させない。 |
| BR-11 | 承認後は Keyword Selection / Release / Production Promotion / Deployment の既存機構を利用する。公開失敗でも確定済み Classification Version をロールバックしない。 |

## 「手動修正かつ新しい方を採用」の実現

時刻比較やラベル優先度の書き換えではない。各 Version の完全な分類状態が正本となる。

例：

1. V1: `AAA` → `direct_nuisance` （通常分類）
2. V2: `AAA` → `normal` （人間が訂正を承認）
3. V3: 新規 `AAA` observation → V2 から `normal` を継承
4. V4: `AAA` → `reactive` （さらに新しい承認済み訂正）

V3 の累積処理が参照するのは pinned V2 であり、別の旧 Version を暗黙に結合しない。`worseThreeClassLabel()` は pinned Version 内の通常のコメント文字列重複処理に限って従来の意味のまま残す。訂正時には同一文字列グループを新 Version 内で統一するため、古い悪いラベルは混在しない。

## 固定するスコープ

- 正式名称: `classification-correction`
- 入口: 明示的な手動訂正要求 / WorkDefinition の起動
- 登録・起動時に Session Input を固定
- 提案: 新規 `classification.correction.propose`
- レビュー・確定: 既存 `05-review-classification` / `classification.finalize`
- 下流: 既存 keyword / release / promotion / deployment の再利用

## 対象外

- 複数グループ一括修正
- 更新済み旧 Version の上書き・差し替え
- 訂正専用 DB テーブル、状態 Stream、ロールバックシステム
- 訂正の自動承認
- 通常分類の業務ロジック全面変更
- UI の大規模新設、Temporal の専用実装、別 Runtime
- 最新時刻・最新行の探索による暗黙的なラベル選択

## 用語

- **survivor**: pinned Corpus の累積 projection が残した分類対象 observation。
- **group**: `commentText` が JavaScript の文字列完全一致で同じ survivor 集合。
- **base**: 訂正元 Classification Version（現行 Head と一致すべき）。
- **new**: 人間が accept した Proposal により commit された Classification Version。レビュー未了の Proposal は new に含まない。
- **pinned**: Session/Release が ID で指定する不変 Version。実行時に暗黙に別 Version へ切替えない。

## 明確な不変条件

1. 旧 Version は不変であり、ある Classification Version の `labels` は対象 Corpus の survivor 全件に一対一対応する。
2. 対象 group のラベルは commit 後の新 Version で全件 `newLabel`。group 外は base と同じ。
3. review の accept なしに `classification` Stream の新 Head を作成しない。
4. `Classification` Head の optimistic concurrency と、訂正元 Corpus の Head 鮮度確認の双方を commit 境界で保証する。訂正専用検証はno-op早期終了の**前**に実施する。
5. 不明・不正・競合は fail-closed。特に `HEAD_CONFLICT` を成功扱いしない。
6. release には訂正後の Classification Version と整合する Corpus / Keyword Selection dependencies を pin する。
7. 訂正Workflowから既存finalizeを呼ぶ際は `assessed` 等のレビュー省略引数を禁止し、受理済みのhuman Taskを必須とする。
8. Head競合・reject・deployment失敗時には以後の副作用Taskへ進まない。terminalStatus付きnoopの停止効果を前提としない。
