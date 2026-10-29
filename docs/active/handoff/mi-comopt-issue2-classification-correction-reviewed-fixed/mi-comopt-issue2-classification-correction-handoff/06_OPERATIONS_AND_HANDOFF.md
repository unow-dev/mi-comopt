# 06. 運用導線と作業完了報告

## コマンドラインの方針

既存 `package/scripts/comment-data-update-v3-operator.mjs` と `package/src/integration/v3-operator.js` を拡張し、同じ DB / Workspace / deployment adapter / human task 操作を共有する。専用の CLI も独立 Runtime も作らない。

訂正の起動入力（論理 DTO）：

```json
{
  "baseClassificationVersionId": "<existing-classification-head>",
  "observationId": "101",
  "expectedLabel": "direct_nuisance",
  "newLabel": "normal",
  "reason": "分類基準に照らして誤分類と判断"
}
```

`requestedBy`は**認証済みオペレーターの主体情報**から決定する。`--actor`は現行実装では単なる任意入力なので、それ単独では認証を証明できない。OS/実行環境の認証済み主体と一致することを確認する仕組みがない場合、productionの訂正実行を拒否する。Request JSON内の`requestedBy`も信頼しない。

### 予定するオペレーター操作

実際の CLI のサブコマンド文字列は既存 parser に従い実装する。以下は必要な**操作能力**であり、既存 CLI でこのまま実行できるとの意味ではない。

1. `classification-correction` Session を新規開始する（base Version、対象、旧新ラベル、理由、認証 actor、Session ID）。
2. 対象 Session の Task 状態と Proposal / Assessment ID を列挙する。
3. Proposal が示すコメント文字列、旧/新ラベル、対象件数、理由、要求者を表示する。
4. `05-review-classification` を人間が open / claim し、accept または reject と rationale を入力して完了する。
5. 既存の keyword handoff / keyword review / production promotion review を操作する。
6. deployment event の取り込みと identity 検証、最終状態を確認する。
7. 失敗時は `superseded` / `change_rejected` / `not_promoted` / `deployment_failed` / Task Failure を区別して表示する。

起動後は自動 commit してはいけない。個別訂正に `--auto-accept` のような運用上の逃げ道を設けない。

## Production 操作の安全境界

- **この ZIP はproductionへの変更指示ではない。** 実運用環境での起動、Promotion accept、GitHub Actions dispatchは別途明示的な承認を必要とする。
- `--actor`が検証できる認証基盤・実行ログを欠く場合、productionでの訂正Session起動は保留する。任意文字列をHuman Authorityとして監査記録に流用しない。
- テストでは隔離 DB / Workspace、mock deployment adapter、ローカル ArtifactStore を使う。
- production の Secrets/Token 値をログ・Issue・handoff に含めない。
- 現行 `package/scripts/README.md` の v3 production operator 手順（Cutover、Artifact Identity、GitHub Pages verification）を踏襲する。
- 事故を防ぐため、Session の pin 情報と公開 Release の pin 情報を human reviewer に表示する。
- Workflow 失敗時に確定済みの Classification Version を手動 UPDATE して修復しない。次回の明示的な修正/公開 Session として扱う。

## 既存 Version を改変しない運用

- `classification_state_labels` を `UPDATE` / `DELETE` しない。
- 各 Classification Version は独立した全件 labels を持ち、新 Version の INSERT で訂正を表す。
- reject は Decision の記録のみ。既存 Head の変更なし。
- Proposal/Assessment と Decision の実行 ID は監査可能であること。
- `assessed`等のショートカットでHuman Reviewを省略しないこと、`HEAD_CONFLICT`後にKeyword/Release/Deploymentへ進まないことを実行ログで検証する。

## 最低限の運用ログ

- Workflow Session ID / WorkDefinition ID / revision / Actor
- base Classification Version ID / Corpus Version ID
- Proposal ID / Assessment ID
- 対象 observation / コメント文字列グループ件数
- old/new labels / reason
- reviewer actor / decision / rationale
- new Classification Version ID（承認成立時）
- Keyword Selection Version / Release ID / Promotion Version / Deployment Request ID（下流成立時）
- 最終 outcome と公開 identity 検証結果

## 実装者の完了報告フォーマット

以下の項目を埋めて Issue / PR の報告とする。

```md
## 実装サマリー
- 実装ブランチ・commit:
- 新規/変更ファイル:
- 仕様との差異と理由:

## 動作確認
- AC-01〜AC-08: pass / fail / pending
- T01〜T13: pass / fail / pending
- `npm --workspace package test`:
- 既存テストの回帰:

## Version と監査
- base Classification Version:
- new Classification Version:
- 未変更 observation / 変更 group の確認:
- Proposal / Assessment / Decision の追跡:
- 人間のレビューを必須とした確認:
- 拒否/競合時の Head 不変確認:

## 公開
- Keyword Selection / Release で参照した pin:
- Promotion:
- Deployment + identity verification:
- production 実行許可: あり / なし
- 未実施の項目・阻害要因:
```

## 完了判定

- `05_ACCEPTANCE_AND_TESTS.md` の AC-01〜AC-08 をすべて達成。
- CI/E2E が成功しているだけで、要求に含まれる **production 公開後 identity 検証**を実施したことにはしない。運用承認が未取得なら、AC-08 と Issue クローズは pending。
- 監査可能性・旧 Version 不変・競合拒否・従来の累積分類の非回帰が確認されている。
