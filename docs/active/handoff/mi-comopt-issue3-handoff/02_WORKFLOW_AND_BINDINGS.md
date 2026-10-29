# 02 WorkDefinitionとTask接続

## 新しいWorkDefinition

- `workDefinitionId = classification-correction`
- 新revision候補 `2`（Registry内の既存番号と衝突しないことを確認）
- 入力契約の候補 `classificationCorrectionBatch@2.0.0`
- 登録済み`classification-correction@1`を上書きしない。
- 本文グループごとの動的Task生成は行わない。

## 重要: 分岐の置き方

**成功した分岐の子の中にだけ次Taskを配置する**。`choice`を実行してterminal値を返した後に、外側の`sequence`が次Taskへ進む形を作らない。

論理構造（コード生成用の設計表現。Work Orchestratorへそのまま投入するコードではない）:

```text
validateBatch
└─ choice(validated)
   ├─ invalid -> terminal(invalid_request)
   ├─ superseded -> terminal(superseded)
   └─ continue -> resolveBatch
       └─ choice(resolved)
          ├─ invalid -> terminal(invalid_request)
          ├─ superseded -> terminal(superseded)
          └─ continue -> proposeBatch
              └─ choice(proposed)
                 ├─ invalid -> terminal(invalid_request)
                 ├─ superseded -> terminal(superseded)
                 └─ review_required -> humanReview -> finalizeBatch
                    └─ choice(finalized)
                       ├─ rejected -> terminal(change_rejected)
                       ├─ superseded -> terminal(superseded)
                       └─ continue -> keywordFlow
                          └─ success-only -> releaseFlow
                             └─ success-only -> promotionReview/finalize
                                └─ success-only -> deploymentFlow
                                   └─ wait/verify -> record -> terminal(deployed)
```

`terminal()`は現行の定義ヘルパーで`noop`による結果値の構築。**その値が親の`sequence`全体を停止させる保証を前提にしない**。終了結果を返す枝を親`sequence`の末尾に配置し、後続Taskを成功枝の内側に置くこと。

## 新規Task

| Step ID | Capability | 入力の根拠 | 成功時 | 異常時 |
|---|---|---|---|---|
| `01-validate-correction-batch` | `classification-correction.batch.validate` | Session要求、認証済み要求者、pin | `requestFingerprint` | `invalid` / `superseded` |
| `02-resolve-correction-batch` | `classification-correction.batch.resolve` | Session要求、Step01のfingerprint、固定Version | `changeSetId`, `changeSetHash`, 件数 | `invalid` / `superseded` |
| `03-propose-correction-batch` | `classification-correction.batch.propose` | Step02の変更集合参照、共通pin | `assessmentId`, `proposalId` | `invalid` / `superseded` |
| `05-review-classification` | Human Task | 1 Proposal・1 Assessment、集約レビュー表示 | `accept` / `reject` | Human Taskの通常待機/解除 |
| `06-finalize-correction-batch` | `classification-correction.batch.finalize` | 1 Proposal、1 Assessment、承認結果、変更集合hash | `classificationVersionId` | `rejected` / `superseded` |

**決定**: `06-finalize`は承認Decisionの記録とcommitを統括する。commit直前の再検証と状態変更の原子性はApplication Service/ControlPlane側が保証。

## 後続Task（既存Capabilityを再利用）

| Step | Capability/実行種別 | 注記 |
|---|---|---|
| `07a-prepare-keyword-handoff` | `keyword-selection.handoff.prepare` | 新ClassificationVersionを使用 |
| `07b-receive-keyword-proposal` | Human Task | handoffが必要な場合のみ |
| `07-update-keyword-selection` | `keyword-selection.assess` | 既存の`unchanged`/`committed`/`review_required`分岐 |
| `09-review-keyword-selection` | Human Task | Reviewが必要な場合のみ |
| `10-finalize-keyword-selection` | `keyword-selection.finalize` | 確定したKeywordSelectionVersionのみReleaseへ |
| `11-build-release-bundle` | `release.build` | 固定Corpus/新Classification/KeywordVersion |
| `12-materialize-release` | `release.materialize` | ReleaseIdのみ |
| `13-propose-production-promotion` | `promotion.propose` | ReleaseId |
| `13-review-production-promotion` | Human Task | **分類承認とは別** |
| `14-finalize-production-promotion` | `promotion.finalize` | 承認したRelease |
| `16-trigger-deployment` | `deployment.trigger` | release, promotion, target |
| `18-wait-deployment-event` | Event Wait | requestIdで相関、必要時のみ |
| `19-verify-deployment` | `deployment.verify` | wait経由でもalready_deployed経由でも実施 |
| `20-record-deployment-state` | `deployment.record` | verified時のみ |

## 入力元

- Corpus: **`SESSION('/pinned/corpusVersionId')`**。新修正Sessionには`02-update-corpus`がない。既存の参照 `STEP('02-update-corpus','/refs/corpusVersionId')` をコピーしない。
- Classification: **`STEP('06-finalize-correction-batch','/refs/classificationVersionId')`**。成功時だけ存在。
- Keyword Version: `STEP('10-finalize-keyword-selection','/refs/keywordSelectionVersionId')`。
- Approval: `TASK('05-review-classification','')` の実行結果を信頼境界で検証する。
- ChangeSet: 現行Schemaに`refs.changeSetId`がないため、`details.changeSetId`または正式なrefs拡張を選び、**型・スキーマ・bindingを同じ形式に統一**する。
- 後続Taskの入力は原則既存の契約を維持。CorrectionItemを再入力しない。

## 区別する結果

- Agent `WorkStepResult`: `{stateResult,refs,details?}`。`outcome`は含めない。
- Adapter `routingOutcome`: `stateResult`とStep IDから導出し、Taskの`allowedOutcomes`と一致させる。
- Human Taskの完了結果: actor、outcome、rationale、Task/Proposalの束縛を検証。
- WorkDefinitionのterminal outcome: `invalid_request`, `change_rejected`, `superseded`, `not_promoted`, `deployment_failed`, `deployed`等。既存の公開処理が生じる他の終端分岐も維持。
- 一時的I/O障害: Task実行失敗として扱い、invalid/競合/却下とは混同しない。

## 特に確認する実行順序

- Keyword handoffの`reuse`は、評価処理と両立するか、または既存KeywordVersionの再利用で終了させるかをTask成果物と照合する。単純に`reuse`をno-opにして入力不足の次Taskへ進めない。
- `keyword-selection.assess`が`unchanged`または`committed`なら、確定済みKeywordVersionをStep10へ明示的に受け渡す。Review不要時に空のProposalを解決しようとしない。
- Deploymentの`wait`・`verify`・`superseded`・`deployment_failed`分岐は互いに独立させる。wait/verifyだけがStep19へ進み、verifiedだけがStep20へ進む。

`contracts/task-binding-map.json`は対応表の索引。実際に提供するJSON SchemaとWorkDefinitionのbindingを確定する際、表と同時更新する。
