# 08. 機能的致命的不備レビューと修正規約

## 対象と実施状態

- 対象: 2026-10-29提供のhandoff ZIP（元はMarkdown 8件 + SHA-256 manifest。ソースコード・実行テストなし）。
- 照合: GitHub連携経由で `unow-dev/mi-comopt` の `package/src/state/control-plane.js`、`package/src/application/services.js`、`package/src/application/v3/domain-services.js`、`package/src/integration/task-handlers-v3.js`、`package/src/integration/v3-operator.js`、`package/src/workflow/v3/definitions.js`、`package/src/workflow/v3/contracts.js`等の現行実装を参照。
- 作業結果: **handoffの設計規約・テスト規約を修正**、純粋Domainのスタンドアロン参照コードと8件のNodeテストを同梱。
- **未実施**: 本体リポジトリのソース修正、統合テスト、GitHubへpush、production実行。故にIssue #2は未完了。個々の修正指示は適用先実装のHEADと必ず再照合する。

## P0 / P1 指摘と修正指示

| ID | 重要度 | 確認した欠陥・漏れ | 必須の修正 | 回帰試験 |
|---|---|---|---|---|
| F-01 | P0 | `commitProposal()`のno-op早期returnは`domainHandler.validate()`より前。元handoffが`typedClassificationHandler().validate`にだけCorpus Headチェックを実装するよう指示した場合、訂正用の鮮度検証を迂回できる。 | 訂正Proposalだけ`preflight`を同一commit transaction中の**no-op判定より前**に呼ぶ。Corpus/Classification Head、dependency、base state、group差分、hashを照合。訂正で`unchanged`は失敗にする。 | T09,T14,T15 |
| F-02 | P0 | `ReviewableV3Service.finalize()`には`assessed?.refs?[...VersionId]`でreviewなしの`reused`を返すshortcutがある。ワークフロー入力だけでなくサービス入口も守る必要がある。 | `ctx.workDefinitionId==='classification-correction'`では`assessed`を拒否し、`proposalId`/信頼済みhuman review必須。通常分類のshortcutは維持。 | T04,T16 |
| F-03 | P0 | 既存`definitions.js`の一部`superseded`/`deployment_failed` branchは`noop`で、親sequenceの後ろに`assess`/`verify`が続く。単なるnoopを停止条件と見なすのは危険。 | **成功処理を成功outcome branch内部へ移動**。拒否・競合・デプロイ失敗では後続副作用Taskが0件と証明。両WorkDefinitionに対する回帰を必須化。 | T11,T17 |
| F-04 | P0 | `v3-operator.js`の`actorRef(actorId)`は任意文字列を`human`へ整形するだけ。CLI `--actor`単独で本人確認が成立するというhandoffの前提は誤り。 | 信頼済み認証済み主体（外部の承認されたオペレーター認証/操作権限境界）からactorを引き渡し、一致確認する。本番で証明できなければ訂正を起動しない。Request bodyのactorを使用しない。 | T18 |
| F-05 | P1 | Human completion入力は`{outcome,result:{rationale}}`だが`finalize`は`{outcome,actor,rationale}`を要求。既存ランタイムの仲介が成立する前提を文面だけで保証していた。 | claim/Task completionの信頼できるactorからサービスDTOを明示構築する。actorをユーザーのJSONからコピーしない。review/rationale欠落はfail-closed。 | T16,T18 |
| F-06 | P1 | 元handoffがClassification Stateを`schema_version:2`と定義。既存V3分類サービスは`schema_version:1`を生成する一方、定義書自体は`schemaVersion:2`。二つは異なる契約。 | 分類Stateは`schema_version:1`を維持。Contract/schema hashの比較にこの構造を使う。将来のスキーマ移行は別変更とする。 | T01,T19 |
| F-07 | P1 | `String(input.observationId)`のみでは`null`や`undefined`やobjectが不正な文字列IDへ変換される。 | IDは非空stringまたはsafe integerのみ受理し、正規化後の重複/coverageを検査。 | T03 |
| F-08 | P1 | `normalizeLabels()`の実際のID順序は`localeCompare`。元handoffの「文字列昇順」はコードポイントソートとも解釈でき、semantic hashが変わる。 | 本体の`normalizeLabels()`の`localeCompare`に一致させる。ハッシュを正規化後のstateに対して一度だけ算出。 | T01,T19 |
| F-09 | P1 | 提案のmetadataとstateの整合検証が曖昧。任意のCorrection kindを付けた悪意/破損したProposalでgroup外改変が通る恐れ。 | commit前にbaseの正本から純粋関数で**期待されるstateを再計算**し、proposal.stateと完全一致検証。Assessment参照もpersist済みProposalと整合確認。 | T15,T20 |
| F-10 | P1 | `normalizeLabels()`は現行`application/services.js`で非export。元handoffは新Serviceからそのまま再利用できると読める。 | 単にimportせず、安全にexport/refactorして正規化を共有するか、永続化境界で同等性検査する。 | T19 |

## Commit境界の必須処理順（F-01/F-09）

```text
runIdempotent(state.commit) のDBトランザクション内:
  1. Proposal / accepted Decision / Streamの所在を検証
  2. Classification HeadとProposal.expectedHeadを照合
  3. correction proposalならpreflight（旧no-op分岐より前）
      3a. correction.kind、baseClassificationVersionId、Proposal.expectedHead一致
      3b. corpus/policy dependencyのロール・件数・所属Stream・Version IDを検証
      3c. pinned Corpus Version == 現在Corpus HeadかDB内で照合
      3d. pinned Corpusから同じprojectionを生成しsurvivorsを得る
      3e. base Classification Versionからlabelsを読む
      3f. correction metadataのobservationId/expectedLabel/newLabel/理由/actorを検証
      3g. Domain関数で期待stateを再計算し提案stateと完全一致、hash一致
      3h. baseとの差分が実際に存在しなければ拒否
  4. semantic/dependency no-opを評価
      ※ correctionでunchangedを返さずfail-closed
  5. 従来domainHandler.validate + 新Version persist + transition + Head更新
```

`preflight`の名前や組み込み位置は実装によって変えてよいが、**同一DBトランザクション内、no-opより前**という条件は緩めない。通常分類の既存no-op/reuseの意味論を壊さない。SQLiteのロック/transaction範囲も既存Control Planeの契約に従う。semantic hashだけを確認してもgroup外更新や対象Versionの違いは検出できないため、baseからのstate再計算が必要。

## Human Review境界（F-02/F-04/F-05）

1. `startClassificationCorrectionV3`は認証済みactorからSession inputを組み立て、`requestedBy`を固定する。APIへ任意のSession inputを渡す直接経路でも同一の信頼境界を適用する。
2. `05-review-classification`はpersist済みProposal/Assessmentだけからreview対象を表示し、`assessmentRefs`との整合性を検証する。
3. ProviderのTask completionは`outcome`/`result.rationale`を含む。`review.actor`は信頼済みTask completion claimantから確定し、`{outcome,actor,rationale}`に変換する。
4. Correctionから呼ばれた`classification.finalize`は`assessed`、review欠落、actor欠落、未承認actorを拒否する。Reviewの事実をスキップする`reused`は不可。
5. Accept時だけ新Versionをcommit。Reject時はDecisionだけを残す。競合後のaccepted Decisionが存在しても、新Versionや次のTaskを生成しない。

## Workflow分岐の原則（F-03）

次のような直列構造は採用しない。

```js
sequence('unsafe', [
  prepare,
  choice('result', TASK('prepare', '/outcome'), {
    superseded: noop('ignored-conflict'),
    continue: noop('ok'),
  }),
  commitOrPublish, // 先行choiceがsupersededでも実行され得る
]);
```

代わりに次のように、継続処理を成功branchの子へ置く。

```js
sequence('safe', [
  prepare,
  choice('result', TASK('prepare', '/outcome'), {
    superseded: terminal('conflict', 'superseded', { conflictAt: 'classification' }),
    continue: sequence('success-path', [commitOrPublish]),
  }),
]);
```

`terminal()`だけで停止するかはProviderの実装次第。回帰テストでTask実行履歴を調べ、副作用が不実行であることを検証する。

## 検証の範囲と完了条件

- 参照実装: `node --test reference-implementation/*.test.mjs` → 8/8 pass（このZIP作成時）。この結果はDomainの限定された条件しか裏付けない。
- 本体 `npm --workspace package test`: **未実施**（本体ソース一式がZIPに含まれない）。
- T04〜T20のApplication/DB/Provider/Runtime/E2Eは**未実施**。本体に修正後、現行HEADに対して実行が必要。
- Production: **未実施、無許可**。deployが成功していない限りAC-08はpending。
- したがって「設計上の致命的不備の修正指示を反映」は完了だが、「機能修正・Issue #2 完了」は未成立。
