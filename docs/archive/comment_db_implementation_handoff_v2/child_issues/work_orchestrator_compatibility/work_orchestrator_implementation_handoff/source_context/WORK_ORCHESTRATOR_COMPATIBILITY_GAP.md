# Work Orchestrator 互換性ギャップの切り分け

## 目的

`tiktok-filter-keywords` 側の定義不整合と、ローカル導入した `work-orchestrator` 側の表現力不足を切り分けつつ、相互依存する修正を1件の子Issueで管理し、担当と完了条件を明確にする。

## 調査対象

- Consumer: `/home/uya/Workspace/tiktok-filter-keywords/package`
- Provider: `/home/uya/Workspace/work-orchestrator/package`
- Provider package version: `0.0.0`
- Provider revision at investigation: `b504699`
- 導入方法: `work-orchestrator` を `file:../../work-orchestrator/package` として `--install-links` 付きで導入
- 確認日: 2026-09-15

## 結論

問題は片側だけではない。

1. Consumer 側には、Provider の公開型・検証条件に適合していない定義生成がある。
2. Provider 側には、要件で必要な動的な deployment event 相関を正確に表現する公開契約がない。
3. したがって、Consumer 側の修正だけで検証エラーの一部は解消できるが、Production 定義の正確な登録完了には Provider 側の機能追加または仕様判断が必要になる。

仕様にない静的値への置換は行わず、現状の互換層は登録を fail closed する。

## 子Issue

Consumer と Provider は相互依存するため、1件の子Issueへ統合する。

- [Work Orchestrator Compatibility](child_issues/work_orchestrator_compatibility/ISSUE_BODY.md) — Consumer 側の Definition builder／互換アダプターと Provider 側の公開契約／runtime を同一作業単位で扱う
- [作業タスク列](child_issues/work_orchestrator_compatibility/WORK_TASK_SEQUENCE.md)

仕様判断・Provider対応・Consumer対応・登録検証を分離した完了条件にせず、同じ子Issueの相互依存タスクとして管理する。

## Consumer 側で修正する事項

| ID | 対象 | 現状 | 判定 | 修正方針 | 状態 |
|---|---|---|---|---|---|
| C-01 | `limits.maxDynamicTasksPerSession` | 定義が `0` を出力するが、Provider は正の整数だけを受け付ける | Consumer | Dynamic Task を使わない定義では項目を省略するか、正の上限値を設定する | 未修正 |
| C-02 | `ChoiceStep` | `choice(id, branches)` が `decision` Task を出力していない | Consumer | 各 Choice に明示的な decision Task を構成し、`allowedOutcomes` と branch key を一致させる | 未修正 |
| C-03 | terminal branch | `terminal()` が空の `sequence` を出力する | Consumer | Provider が受け付ける終端表現へ変換できるかを確認し、変換で意味が変わる場合は登録を止める | 未修正 |
| C-04 | Task input binding | `inputBindings` を配列で生成している箇所があるが、公開型は `Record<string, InputBinding>` | Consumer | 入力名を持つ Record へ変換し、Provider の型検査を通す | 未修正 |
| C-05 | retry contract | `interventionOnExhaustion` に `"manual_retry"` を設定しているが、Provider 公開型は boolean | Consumer | `true` として表現できる意味か確認し、意味が一致しなければ変換しない | 未修正 |
| C-06 | Agent routing outcome | Agent Task の `allowedOutcomes` が定義されていない | Consumer | 各 routing outcome を許可し、Agent result の `outcome` への変換境界を実装する | 未修正 |
| C-07 | waitEvent の余分な入力 | `waitEvent` に Task 用の `inputBindings` を付けている | Consumer | wait の公開契約に存在しないフィールドを除去し、必要な値の受け渡し方法を別途確定する | 未修正 |

これらは Consumer の Definition builder と compatibility adapter の責務であり、Provider の変更なしに修正可能な範囲を含む。ただし C-03 は L-03 と結び付くため、終端を即時完了として保持できない場合は Provider 側の機能追加が必要になる。

## Provider 側で検討する事項

| ID | 対象 | 現状の公開契約・実装 | 影響 | 必要な対応 | 状態 |
|---|---|---|---|---|---|
| L-01 | 動的 correlation key | `WaitEventStep.correlationKey` は `string` のみ | `deploymentRequestId` を Trigger Task の結果から解決できない | WaitEvent に session/step binding または同等の動的 matcher を追加する | 未対応 |
| L-02 | event matcher | runtime が `event.correlationKey === step.correlationKey` の固定値比較を行う | deployment request ごとの待機を安全に分離できない | wait 作成時に binding を一度解決し、その resolved key を immutable に保持する | 未対応 |
| L-03 | terminal semantics | 空 Sequence を拒否し、`terminal` / `noop` Step がない | 端末 branch を即時完了として表現できない | 即時完了 Step を追加するか、空 Sequence を正式に許可する | 未対応 |
| L-04 | Choice と branch input | Choice の decision Task は必須だが、validator は branch の lexical visibility に decision ID を加えていない | decision Task の結果を branch 内 Task の input binding で参照しにくい | 意図した可視性を仕様化し、必要なら validator/runtime の両方を修正する | 未対応 |

特に L-01/L-02 は、Consumer 側で固定文字列・ワイルドカード・共通 request ID を設定して解決してはいけない。そうすると別 deployment の event を消費する可能性があり、要件の idempotency と recovery 境界を壊す。

## 共同で確認する事項

| ID | 確認内容 | Consumer の責務 | Provider の責務 | 完了条件 |
|---|---|---|---|---|
| J-01 | Choice の decision 実行モデル | business task と routing task の対応を定義する | decision の visibility と outcome 契約を明文化する | 追加 Task・重複実行・入力参照の意味が受入テストで確認できる |
| J-02 | terminal branch の意味 | terminal が必要な箇所と期待結果を列挙する | 即時終端を表現する公開型を決定する | terminal 後に不要な外部処理・Human Task・再試行が発生しない |
| J-03 | Agent result mapping | `WorkStepResult.details.outcome` などから routing outcome を変換する | `allowedOutcomes` と Agent result 検証を提供する | `continue`、`review_required`、`superseded`、`blocked`、`wait`、`verify` が同じ意味で流れる |
| J-04 | Definition revision | 変更後の canonical hash と revision を更新する | 同一 `(workDefinitionId, revision)` の immutable 登録を保証する | typecheck、hash、snapshot、実登録が全て成功する |

## 実施順序

1. Consumer 側で C-01、C-04、C-05、C-07 の明白な型不整合を修正する。
2. C-02、C-03、C-06 について、Provider の現行 runtime semantics と衝突しない構成を確定する。
3. Provider 側で L-01/L-02 の動的 correlation 契約を追加する。終端表現が必要なら L-03 も同時に追加する。
4. Provider を build/test し、配布対象 `dist` を更新する。
5. Consumer が新しいローカル package を再導入し、2つの WorkDefinition を公開 root の `validateAndHashDefinition()` と `WorkOrchestrator.registerDefinition()` で検証・登録する。
6. 動的 deployment request を2件以上使った event isolation、duplicate event、already-deployed、recovery の smoke test を実行する。

## 現在の検証結果

- `import "work-orchestrator"`: 成功
- `WorkOrchestrator`、`Registry`、`validateAndHashDefinition` の公開 root export: 確認済み
- Consumer `npm test`: 138件成功
- Consumer `npm run build`: 成功
- Production Definition の実登録: `WORK_ORCHESTRATOR_INCOMPATIBLE` で fail closed
- 未完了の主因: C-01〜C-07 の Consumer 側不整合、および L-01/L-02 の Provider 側未対応

## 完了判定

次の全てを満たすまで、Production Definition の登録完了とは扱わない。

- Consumer の公開型不整合が解消されている。
- Provider が動的 `deploymentRequestId` 相関を正確に解決できる。
- terminal branch が即時終端の意味を保っている。
- canonical hash、snapshot、immutable revision が確定している。
- `WorkOrchestrator.registerDefinition()` による2定義の登録が成功する。
- deployment event の誤相関・重複消費がないことを確認している。
