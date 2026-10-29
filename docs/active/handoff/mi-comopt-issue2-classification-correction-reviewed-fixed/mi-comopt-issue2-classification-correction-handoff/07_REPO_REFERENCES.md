# 07. 現行リポジトリ・設計参照

## 基準

2026-10-29時点にGitHub連携から閲覧した`unow-dev/mi-comopt`既定ブランチの構成を基準とするhandoff。2026-10-29のレビュー時にも`control-plane.js`、`services.js`、`definitions.js`等を照合した。checkoutの実HEADが変わっている場合は差分を確認する。このZIPに本体ソース一式は含まれない。

## 正本となる Issue / ドキュメント

- Issue: https://github.com/unow-dev/mi-comopt/issues/2
- Issue 本文: https://github.com/unow-dev/mi-comopt/blob/main/docs/active/issues/20261029-manual-individual-classification-correction/ISSUE_BODY.md
- Work Task Sequence: https://github.com/unow-dev/mi-comopt/blob/main/docs/active/issues/20261029-manual-individual-classification-correction/WORK_TASK_SEQUENCE.md
- 旧分類設計の決定事項: https://github.com/unow-dev/mi-comopt/blob/main/docs/active/issues/20260908-three-class-workset-db-label-application/three-class-db-label-application-implementation-handoff/01_FINAL_DECISIONS.md

上記の歴史的仕様は元々 legacy DB-global な同文ラベル一意性の文脈にある。v3 においては **pinned Classification Version 内の対象 survivor 群を訂正対象とする**ことを優先し、DB 全履歴のラベルを更新しない。

## 主要な現行コード

| パス | 参照理由 |
|---|---|
| `package/src/three-class/cumulative-classification-plan.js` | `planCumulativeClassification()`、prior exact/text 継承、`worseThreeClassLabel()` 呼出し、`assertCompleteClassificationState()` |
| `package/src/three-class/label-resolution.js` | ラベル優先順位。**変更しない** |
| `package/src/database/three-class-label-repository.js` | `readClassificationVersionLabels(db,versionId)` は pinned Version に限定されたラベル Authority |
| `package/src/application/v3/domain-services.js` | `cumulativeClassificationPlan()`、`ReviewableV3Service`、`ClassificationApplicationServiceV3`、`KeywordHandoffService` |
| `package/src/application/services.js` | `STREAM_KEYS`、`normalizeLabels`、`typedClassificationHandler()` |
| `package/src/state/control-plane.js` | `recordAssessment()`、`createProposal()`、`createDecision()`、`commitProposal()`。commit の head check と transaction |
| `package/src/workflow/v3/definitions.js` | v3 WorkDefinition / `agentTask`, `humanTask`, `keywordFlow`, `releaseFlow` |
| `package/src/workflow/v3/contracts.js` | WorkStepResult / Session Input / Outcome JSON Schema |
| `package/src/workflow/v3/session-input.js` | pin 解決と Session Input validation |
| `package/src/workflow/v3/result-rules.js` | Step ID ごとの厳密な結果組合せ検証 |
| `package/src/integration/task-handlers-v3.js` | Agent capability allowlist / v3 service binding / actor context |
| `package/src/integration/v3-runtime.js` | WorkDefinition 登録、Local/Temporal Runtime、start / cutover guard |
| `package/src/integration/v3-operator.js` | production Session、Human Task、review actor と検証 |
| `package/scripts/comment-data-update-v3-operator.mjs` | 既存 production CLI |
| `package/src/application/v3/release-services.js` | Release の exact pin / dependencies check |

各ファイルは `https://github.com/unow-dev/mi-comopt/blob/main/<パス>` で参照できる。

## 確認済みの実装上の要注意点

1. **通常分類の prior label 衝突**: `planCumulativeClassification()` は同一コメント文字列に `worseThreeClassLabel()` を利用。現行 observation の exact label があれば text label より優先。訂正時に group 全件を新 Version で統一することが必要。
2. **自動 commit shortcut**: `ReviewableV3Service.assess()` は `request.derivedOnly === true` 等で auto commit が成立し得る。訂正は新 `propose` で必ず review を要求。
3. **`classification.finalize` の監査**: 既存 human review を利用。Decision 保存後、`commitProposal()` で Version の Head と immutable transition を更新する。拒否時は Head を変えない。
4. **Corpus Head の不備**: `commitProposal()` は自身の Stream の expected Head を確認するが、Corpus dependency の現在 Head までは確認しない。訂正 Proposal 固有の commit-time check が必要。
5. **P0 no-opの実行順序**: `commitProposal()`ではsemantic/dependency no-opが`domainHandler.validate()`より先。変更の存在を作成時にチェックするだけでなく、**commit transaction内のpreflightをno-opより前**へ追加する。
6. **downstream Binding 固定**: 現行 `keywordFlow` / `releaseFlow` は `02-update-corpus` に依存。訂正 Workflow では入力元が異なるため Binding 引数化。
7. **downstream `superseded` branch**: いくつかの Noop branch の直後に成功処理が置かれている。訂正専用の安全な分岐構成が必要（共有変更では既存 Workflow の回帰検証）。
8. **Result 契約**: `WORK_STEP_RESULT_V3_SCHEMA` は `stateResult` + `refs`。`result-rules.js` は exact key sets。`outcome` は Agent Adapter の外側に置く。
9. **Session Contract**: 既存の`SESSION_INPUT_V3_SCHEMA`は`tiktokCommentBatch`専用。訂正入力を混ぜない。
13. **分類状態スキーマ**: 既存のClassificationStateは`schema_version:1`。定義の`schemaVersion:2`とは異なる。ハンドオフ文面にあった`schema_version:2`は修正済み。
14. **Human actorの信頼性**: 現行CLIの`--actor`は任意文字列。認証済み主体であることはコード上保証されない。任意値を監査正本にしない。
15. **Normalizerの可視性**: `normalizeLabels()`は`services.js`の非export関数。新しいCorrectionServiceから直接importできる前提を置かず、明示的なexport/refactorで共有規約を固定する。
16. **review形状とshortcut**: Human Task completion は`{outcome,result:{rationale}}`、Finalize serviceは`{outcome,actor,rationale}`を要求する。`ReviewableV3Service.finalize()`には`assessed`を条件とするreview不在の`reused`経路がある。Correctionでは明示変換しshortcut禁止。
10. **Actor の区別**: Agent Actor は `application-service`。Session 起動者と Human Reviewer は別の認証済み authority。
11. **既存 operator は単一 WorkDefinition 前提**: Session の一覧 / 取得と CLI サブコマンドは correction 用に明示的に追加する。
12. **workflow revision の混同**: `comment-data-update` v3 の revision 下限は 3。新しい `classification-correction` は WorkDefinition 独自の revision 1。既存 guard に revision 1 を無造作に通さない。

## 最初に実行するテスト

```bash
npm --workspace package test
# あるいは
cd package && node --test tests/v3-workflow.test.js tests/v3-runtime.test.js tests/v3-cumulative-corpus-update.test.js
```

## 注意事項

- URL / コード / 構成は作成日の確認結果に基づく。将来の HEAD 変更に追従するには実装者側で再取得する。
- 「分類訂正は特定の observation を入口にし、同一 exact `commentText` の survivor 全件に適用する」という判断はこの handoff の業務仕様として固定する。
- 実際のレビューに必要な actor 形式、Task result 形状、バインディングは必ず既存 Provider / Runtime の統合テストで裏付ける。
