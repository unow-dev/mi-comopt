# 05. 受け入れ条件・検証シナリオ

## 受け入れ条件（Issue #2 完了判定）

| ID | 受け入れ条件 | 客観的な合格判定 |
|---|---|---|
| AC-01 | 分類済みコメントの訂正要求 | base Classification Version、observation ID、expectedLabel、newLabel、reason が指定可能。requestedBy は trusted actor。 |
| AC-02 | 同一コメント文字列の訂正範囲 | 完全一致 `commentText` の全 survivor observation のラベルだけが更新され、グループ外は維持される。 |
| AC-03 | 人間による確認 | Proposalに紐づく対象、変更前後、理由、要求者、base、件数が表示され、認証済みreviewerがaccept/rejectできる。`--actor`の自己申告では認証とみなさない。 |
| AC-04 | Version 不変・承認ゲート | Accept 時のみ完全状態の新 Classification Version を commit。Reject では新 Version と Head 変更なし。 |
| AC-05 | 監査可能性 | Proposal/Assessment/Decision/Version を辿り、旧新値、理由、要求者、承認者、結果、時刻が読める。 |
| AC-06 | fail-closed | 不明ID、無効ラベル、期待値相違、空理由、重複/欠落、Head競合は正当な新Versionを確定しない。no-op早期終了でもCorpus競合・不整合が見逃されない。 |
| AC-07 | 通常分類への継承・非回帰 | 訂正済みラベルが次 Corpus 更新の新規同文 observation に継承され、通常分類の既分類 handoff 排除ルールも維持される。 |
| AC-08 | 下流公開 | 訂正 Classification Version → Keyword Selection → Release → Promotion → Deployment を経由し、公開結果と pin された Release の Identity 検証が通る。 |

## 最小テストケース一覧

| ID | 種別 | 条件と確認点 | AC |
|---|---|---|---|
| T01 | Domain | `AAA` 2件、`BBB` 1件。`AAA` を悪→良に変更、2件変更・BBB 不変、state coverage 完全。 | 01,02 |
| T02 | Domain | 同一 `AAA` に矛盾ラベルが既存で混在。対象1件の expectedLabel が一致すれば group 全件が新ラベルへ収束。旧ラベル分布を記録。 | 02,03 |
| T03 | Validation | 無い ID、invalid label、同値、空/空白 reason、expectedLabel 不一致、survivor/label の重複・欠落・余分な ID を拒否。 | 06 |
| T04 | Proposal | 正常時 `{review_required, proposalId, assessmentId}`。自動 commit しない。旧 Head/Version 不変。 | 03,04 |
| T05 | Review | Reject → Decision は rejected。Head 不変。下流 Task 未開始。 | 03,04,05 |
| T06 | Review | Accept → human Decision と新 Classification Version。全ラベルと監査情報一致。旧 Version は不変。 | 04,05 |
| T07 | Concurrency | 起動後、Proposal 作成前に分類 Head を動かす → superseded。 | 06 |
| T08 | Concurrency | Proposal 作成/レビュー後に分類 Head を動かす → commit 失敗。 | 06 |
| T09 | Concurrency | Proposal 作成/レビュー後に Corpus Head を動かす → commit 失敗（同一 tx で検証）。 | 06 |
| T10 | Inheritance | Accept 後の新 Corpus に同文 `AAA` が追加され、新ラベルが継承。`worseThreeClassLabel()` は不変。 | 07 |
| T11 | Workflow | 定義 hash、Session Schema、Binding、result-rules、worker capability、review 必須、無効 branch が公開処理へ進まない。 | 03,06,07 |
| T12 | E2E | Keyword Selection から Release / Promotion / deployment verified まで進み、Release pinned Classification Version が訂正 Version に一致。 | 08 |
| T13 | Regression | 既存 comment-data-update / cumulative / v3 operator 既存テストが成功。 | 07,08 |

## 基本 fixture

```text
base Corpus survivors:
  (101, 'AAA')
  (102, 'AAA')
  (103, 'BBB')
base Classification Version:
  101 -> direct_nuisance
  102 -> direct_nuisance
  103 -> reactive
Correction:
  observationId = '101'
  expectedLabel = 'direct_nuisance'
  newLabel = 'normal'
  reason = '分類基準に照らして誤分類と判断'
Expected new Version:
  101 -> normal
  102 -> normal
  103 -> reactive
Future Corpus survivor:
  104 ('AAA') -> normal
```

混在ラベル fixture：同文 `AAA` の 101=`direct_nuisance`、102=`reactive`。`expectedLabel` は指定した 101 の値と一致させる。group 全件の `normal` 訂正が成立し、`previousLabels` に 2 種類が残る。

## 自動承認を防ぐテスト

- 分類ポリシーに `auto_commit: true` が設定されていても correction Proposal は `review_required` になる。
- `stateResult: unchanged` / `reused` は correction propose の成功結果として許可しない。
- `derivedOnly: true` が紛れ込んでも自動で Decision/Commit しない。
- `classification.finalize` の `assessed` shortcutに不正DTOを渡しても、Correction Sessionでレビューなしの成功にはならない。
- Human Task が accept されて初めて Version に mutation が発生する。

## 原子性・競合のテスト

- Proposal で **Classification Head** を lock/expectedHead と比較し、commit でも比較する。
- **Corpus Head**もcommit transaction内、かつ**no-op分岐前**に比較し、レビュー待ちの差し替わりを拒否する。
- 再実行（retry）で同じ operationId + request hash は同じ結果。別 payload なら idempotency conflict。
- 不正な要求では Version/Transition が作られない。
- Proposal metadataの`kind`だけが正しくstateが別物の場合もcommit-timeに拒否（group外改変、expectedLabel相違、hash不整合、source dependency不整合）。
- Decision が accepted で記録済みでも、Head 競合により Version が作られなければ `superseded` として残る（既存 Control Plane の監査挙動）。

## 通常分類の非回帰

`planCumulativeClassification()` は priorLabels を pinned Classification Version から読む。手動訂正後に同一 `AAA` の旧ラベルを混在させていないことを確認する。

- exact observation の継承が動く。
- 新 observation / same exact text の継承が動く。
- 本来 unresolved のコメントは引き続き handoff が必要。
- `assertClassificationHandoffSafe` は解決済み項目を workset に入れない。
- `worseThreeClassLabel` の順序 normal < reactive < direct_nuisance は従来どおり。

## 下流 E2E

1. 修正 Version を確定させる。
2. `keyword-selection.handoff.prepare` / `keyword-selection.assess` / `keyword-selection.finalize` を既存仕様に従って完了する。
3. `release.build` と `release.materialize` の pinned Classification Version を検証する。
4. `promotion.propose` / human review / `promotion.finalize` を通す。
5. `deployment.trigger` / wait or already deployed / verify / record を通す。
6. deployment identity / release ID / hashes と公開された分類結果が一致する。
7. 途中の rejected / superseded / deployment_failed で後続の副作用が発生しないことを検証する。

**重要**: CI の E2E は mock/in-memory adapter と隔離 DB で実行する。実 production での AC-08 最終確認は、運用者の承認を得て別途行う。未実施の場合は AC-08 を `pending` として明記し、Issue を完了扱いしない。

## 検証コマンド例

リポジトリ root から：

```bash
npm --workspace package test
npm --workspace package exec -- node --test tests/v3-classification-correction.test.js
npm --workspace package exec -- node --test tests/v3-workflow.test.js tests/v3-runtime.test.js
```

環境によって `npm ... exec` の引数解釈が異なる場合は `cd package && node --test ...` を使う。

## 実装者が納品時に提示する証跡

- AC-01〜AC-08 の結果（pass / fail / pending）
- T01〜T13 の実行結果、成功/失敗数
- new Version ID と base Version ID の一致関係、旧 Version 不変の確認
- accept/reject・競合時の Head 変化の有無
- Proposal/Decision から対象と actor/rationale を追跡した結果
- Release の pinned Corpus / Classification / Keyword Selection Version IDs
- Deployment の identity 検証結果（production 実行を許可された場合）

## 追加の致命的不備回帰ケース（review修正版）

| ID | 種別 | 条件と客観的な検証 | AC |
|---|---|---|---|
| T14 | Commit/no-op | 訂正として不正なsemantic同値Proposalを投入し、Corpus Headを変更してacceptする。**no-op判定より前に拒否**され、Version/Transition/後続Taskゼロ。 | 04,06 |
| T15 | Commit/integrity | メタデータは訂正を示すがstateがgroup外も書き換える、旧値が不一致、Corpus dependencyが入れ替わる等の破損Proposalをそれぞれ拒否。 | 02,06 |
| T16 | Human/shortcut | `classification-correction`コンテキストのfinalizeに`assessed`/actorなし/不正rationaleを渡しても`reused`/`committed`不可。正しいclaimantからのreviewのみ許可。 | 03,04,06 |
| T17 | Workflow/side effects | 各`superseded`、`rejected`、`deployment_failed` branchで、以後の副作用Taskがゼロ。通常comment-data-update側も同条件を再試験。 | 06,08 |
| T18 | Authentication | 偽装した`requestedBy`、`--actor`文字列だけ、human result内actor改変で本番修正を許可しない。trusted主体と一致すれば許可。 | 01,03,05,06 |
| T19 | State/schema/hash | 出力分類Stateの`schema_version:1`と`normalizeLabels()`と完全一致する順序/hashを検証。WorkDefinition.schemaVersion=2と混同しない。 | 04,06 |
| T20 | Review integrity | 誤ったAssessment ID、Proposal ID、入力Fingerprint、対象件数、expectedLabel、group差分、理由の食い違いでレビュー表示・commitを拒否。 | 03,05,06 |

> T01〜T03のDomain挙動の一部のみ同梱`reference-implementation`で独立実行可。T04〜T20は本体のControl Plane/Provider/DBを用いて実装し、未実施をpassと記載しない。
