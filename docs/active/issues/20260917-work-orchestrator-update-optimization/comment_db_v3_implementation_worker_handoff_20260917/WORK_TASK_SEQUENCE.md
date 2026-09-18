# Work Task Sequence: Comment DB v3 実装ワーカー引き継ぎ

## Purpose

Comment DB / Work Orchestrator v3を、正本の契約、v2互換性、依存関係、証跡および切替条件を満たした状態で実装・検証し、本番でv3を安全に運用開始できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、normative package、受入条件、対象外事項、PR0〜PR5の依存順およびv2/v3の変更境界を確認する。
- [x] 2. 実装前提の範囲で、AIエージェントが、normative packageとmanifestの整合性、consumer baseline、実際のprovider commit、`TARGET_REVISION`の候補および凍結済みv2 Definition hashを確認・記録する。
- [x] 3. 証跡基盤の範囲で、AIエージェントが、implementation evidence ledger、requirement・verification traceabilityおよびsupporting-document lintを整備し、実装進捗を正本の外で追跡できる状態にする。
- [x] 4. provider互換性の範囲で、AIエージェントが、logicalPath、optional binding、receipt lookupおよびexternal-event parityの追加要件をconsumerの業務意味論と分離して整備する。
- [x] 5. v3基盤契約の範囲で、AIエージェントが、WorkStepResult、Session、terminal outcome、DefinitionおよびHuman artifact completionの契約・検証・side-by-side登録を整備する。
- [x] 6. state authorityの範囲で、AIエージェントが、operation id、JCS business DTO hash、transactionと外部呼出しの境界、application idempotencyおよびdependency-aware no-opを整備する。
- [x] 7. domain workflowの範囲で、AIエージェントが、ClassificationとKeyword Selectionのhandoff、Human review、finalize、agent adapterおよびcapability wiringを、指定された入力・依存・routing・result rulesに従って整備する。
- [x] 8. Release・Promotionの範囲で、AIエージェントが、八つのpinによる決定的なRelease identityとmaterialization、Human Decision、expected-head guardおよびPromotion CAS finalizationを整備する。
- [x] 9. Deployment・runtime統合の範囲で、AIエージェントが、加算的なDB migration、target-local sequence、FIFO single-flight、receipt-first outbox、provider event reconciliation、local/Temporal runtimeおよびfull E2Eを整備する。
- [ ] 10. 検証と証跡閉鎖の範囲で、AIエージェントまたはCIが、79件の必須verification ID、全85要件のcoverage、v2回帰・hash、local/Temporal parityおよび4件のfull E2Eに合格する証跡を候補commitへ記録する。
- [ ] 11. 本番切替判断の範囲で、人間が、全検証結果、provider互換性、v2 hash凍結、切替手順および失敗時のfix-forward方針を確認し、cutover実施を承認する。
- [ ] 12. 本番cutoverの範囲で、AIエージェントが、v2新規開始の凍結、非終端v2 sessionのdrain、legacy authorityの無効化、v3開始の有効化およびcontrolled smokeを順序どおり実行し、失敗時は新規v3開始を凍結してfix-forwardする。
- [ ] 13. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、implementation evidence、切替結果、残存する運用上の注意点および必要なimmutable revision更新を記録する。

## Work Notes

- normative authorityは `normative/comment_db_implementation_handoff_v3_closed2_20260917.zip`（SHA-256: `0f7ff879a7233dda01da2016a315dc5e35e1a0d0535eee6a5cdc5e023ceabfcb`）とする。抽出コピーは参照用であり、正本の代替や変更対象ではない。
- consumer baselineは `unow-dev/mi-comopt@398a904069af3e5e1386e412811f9a8275af1d7a`。providerの実体とcommitは実装前に特定し、`implementation-evidence-v3.json`へ記録する。
- `comment-data-update@2`（`77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`）と `deploy-promoted-release@2`（`aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`）の登録Definition hashは変更しない。v3はside-by-sideで実装し、PR5-B完了前に本番開始経路へ到達させない。
- v3のDB変更は加算的で再実行可能なmigration 010とし、既存v2行を再解釈・backfillせず、既存state schema versionの意味を変更しない。
- PR1-AとPR2-AはPR0-B後に並行可能。PR3-CとPR3-Dは前提完了後に並行可能。それ以外は `01_EXECUTION_PLAN.md` の依存順に従う。
- `implementation-evidence-v3.json`は実装進捗の台帳とし、normative配下のtraceabilityやmanifestへ進捗を書き込まない。各PRは担当verification合格、必要なv2回帰、要件のimplementation refsおよびmain安全性を満たして完了とする。
- 本番切替ではlegacy authority writerとv3 authorityを同時に有効化しない。smokeまたは切替後検証が失敗した場合、revision 2への業務復帰やlegacy authorityの再有効化は行わず、fix-forwardする。
- ベースラインコミットは consumer 側 `3a9fea5`（`chore: establish comment db v3 implementation baseline`）。
- provider 実体は `/home/uya/Workspace/work-orchestrator`、着手時の基準 commit は `976aa2f4b8ac68b0f72aeb4b1e35c96a71900bcb`、互換性実装 commit は `567c34e32634ebe1f0916d36e3a5662fbd6b638e`。provider の互換性変更は consumer の業務意味論と分離して実装した。
- consumer/provider の v3 定義 hash は revision 3 / `9598f503ba9a8e8753e0b1d9d1e4af2f1a80a4d10b718aba5ab250840438a726` で一致した。v2 の凍結 hash は `implementation-evidence-v3.json` と integrity test で再確認する。
- consumer の基盤実装コミットは `6247cf7a6116f9c649faad17cbadefd0b54aae84`、deployment/runtime統合コミットは `e4b4724dd40fcba44af96af6112522938f927bd0`、Temporal/race検証コミットは `04f6b01cc613f2318b735c09baee6b8e7e37e592`、guarded cutover control実装コミットは `cc6e42f6719455c19af68a78c35ebbcfbfcc808e`、cutover verification labelingコミットは `21f17b5384d01d5473cc47d1fb936c3646d3f59f`。
- local V3 E2E、Temporal上のE2E01〜04、Human reject境界、Promotion stale-head、deployment queueのsingle-flight/FIFO/receipt-firstおよびE2E04相当を実装した。Temporal E2E01〜04は個別テストで合格しているが、TestWorkflowEnvironmentの複数再起動時にWorker終了待ちが長くなるため、全件実行の安定性はタスク10で閉鎖する。
- `v3_cutover_control` と `v3_cutover_events` を加算し、`comment-db-v3-cutover.mjs` で v2 freeze/drain、legacy disable、v3 enable、controlled smoke、failure freeze を順序・証跡付きで制御する。V3-CUT01〜07は `21f17b5` 上で合格証跡を記録したが、残り72件のmandatory verification IDと全85要件のcoverageは未閉鎖である。
- ユーザーからcutover承認を受領した。ただし `06_CUTOVER_RUNBOOK.md` の全79件合格、provider互換性、候補commit上のv2 hash再確認および対象production authority/session inventoryが未達のため、本番既定値の切替は実行せず、制御面実装とpreflight検証までを進めた。
- Temporal Test Environmentと既存テストの干渉を避けるため、consumerのtest scriptは `--test-concurrency=1` で実行する。
