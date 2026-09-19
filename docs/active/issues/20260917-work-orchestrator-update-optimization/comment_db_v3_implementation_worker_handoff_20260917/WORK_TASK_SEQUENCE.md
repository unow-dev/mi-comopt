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
- [x] 10. 検証と証跡閉鎖の範囲で、AIエージェントまたはCIが、79件の必須verification ID、全85要件のcoverage、v2回帰・hash、local/Temporal parityおよび4件のfull E2Eに合格する証跡を候補commitへ記録する。
- [x] 11. 本番切替判断の範囲で、人間が、全検証結果、provider互換性、v2 hash凍結、切替手順および失敗時のfix-forward方針を確認し、cutover実施を承認する。
- [x] 12. 本番cutoverの範囲で、AIエージェントが、v2新規開始の凍結、非終端v2 sessionのdrain、legacy authorityの無効化、v3開始の有効化およびcontrolled smokeを順序どおり実行し、失敗時は新規v3開始を凍結してfix-forwardする。
- [x] 13. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、implementation evidence、切替結果、残存する運用上の注意点および必要なimmutable revision更新を記録する。
- [x] 14. 本番運用操作の範囲で、AIエージェントが、v3 Session開始とHuman Task操作をv3 application-service adapter経由で実行する専用entrypointを整備する。
- [x] 15. 専用entrypoint検証の範囲で、AIエージェントまたはCIが、永続Workspaceを跨ぐSession開始、Human artifact検証、Human review完了およびactor境界を確認する。
- [x] 16. 専用entrypoint作業結果の範囲で、AIエージェントが、利用コマンド、制約および検証結果を記録する。
- [x] 17. Human artifact運用情報の範囲で、AIエージェントが、前段結果に由来するworkset/request identityを専用entrypointのTask表示へ提示する。
- [x] 18. 永続Release artifact運用の範囲で、AIエージェントが、プロセス再起動後も既存materializationを検証・再利用できるproduction operator構成を整備する。
- [x] 19. GitHub Pages deployment連携の範囲で、AIエージェントが、workflow dispatch、完了event配送および公開release identity検証をproduction operatorへ接続する。

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
- consumer の基盤実装コミットは `6247cf7a6116f9c649faad17cbadefd0b54aae84`、deployment/runtime統合コミットは `e4b4724dd40fcba44af96af6112522938f927bd0`、Temporal/race検証コミットは `04f6b01cc613f2318b735c09baee6b8e7e37e592`、guarded cutover control実装コミットは `cc6e42f6719455c19af68a78c35ebbcfbfcc808e`、cutover verification labelingコミットは `21f17b5384d01d5473cc47d1fb936c3646d3f59f`、受入coverage閉鎖候補commitは `dff344ab94a4be6e9fb2723040b90b9fde31f856`。
- local V3 E2E、Temporal上のE2E01〜04、Human reject境界、Promotion stale-head、deployment queueのsingle-flight/FIFO/receipt-firstおよびE2E04相当を実装・検証した。TestWorkflowEnvironmentはlocal modeへ切り替え、全consumerテスト171件が合格した。Temporal履歴サイズ警告は出力されるが、テスト失敗はない。
- `v3_cutover_control` と `v3_cutover_events` を加算し、`comment-db-v3-cutover.mjs` で v2 freeze/drain、legacy disable、v3 enable、controlled smoke、failure freeze を順序・証跡付きで制御する。`dff344a` 上で79件のmandatory verification IDと全85要件を `verified` として台帳へ記録した。
- ユーザーからcutover承認を受領し、全79件の受入ID、provider互換性および候補commit上のv2 hash再確認を完了した。一方、対象production authority/session inventoryはこのworkspaceから確認できないため、本番既定値の切替は実行せず、制御面実装とpreflight検証までを進めた。
- 受入coverage閉鎖後も、対象production authority/session inventoryはこのworkspaceから確認できないため、cutover CLIのmutating commandは実行していない。実施時はrunbookのpreflightを対象DBで再確認し、同じ順序でfix-forwardする。
- 2026-09-19のread-only preflightでは、対象DBに `v3_cutover_control` と `v3_cutover_events` が存在せず、`workflow_start_policies` とproduction session inventoryも確認できなかった。既存の `state_cutovers` 3系統は検証済みだが、いずれも `legacy_writer_enabled=1` のため、このDBをproduction cutover対象としてmutateしていない。
- 2026-09-19に一時staging control plane（`/tmp/comment-db-v3-staging.nOd9Ez`）を作成し、Comment DB、Work Orchestrator registry、start policyを分離して構成した。registry上の `comment-data-update@2` / `@3` hashは凍結値・候補値と一致し、非終端v2 Sessionは0件だった。stagingでは `v2_open -> v2_frozen -> v2_drained -> legacy_disabled -> v3_enabled -> smoke_verified` の証跡を確認し、controlled smoke session `staging-v3-controlled-smoke-20260919-retry` はcompleted、Deployment verificationはverified、recordはcommittedとなった。ただしstaging実行であり、本番cutover完了とは扱わない。
- Temporal Test Environmentと既存テストの干渉を避けるため、consumerのtest scriptは `--test-concurrency=1` で実行する。
- ユーザー指定のproduction authority DBを `/home/uya/Workspace/tiktok-filter-keywords/var/comment-history.sqlite3` と確定し、初回mutation前のSHA-256 `4589aa93f3001f9f19b6f18de11f8ace2d3a6eaef85cadc312bc66c41c802660` と、fix-forward前のバックアップSHA-256 `a146e7fbbc64b40d3b4ca7dab642f10d8a4c7083a0dfbbb1dab73e7fbdc1cd9d` を保存した。production registry/start policyは `var/work-orchestrator-production` に作成し、v2/v3 Definition hashを凍結値・候補値に一致させた。
- productionでは `v2_open -> v2_frozen -> v2_drained -> legacy_disabled -> v3_enabled` を実行し、最初のcontrolled smokeで `INVALID_REVIEW_OUTCOME` を検出したため、runbookどおり `v3_frozen`、新規v3開始停止、legacy再有効化なしで固定した。Domainの自動確定結果再利用修正をconsumer commit `d1fc7da`、optional input binding修正をprovider commit `3a6359f` として実装し、Definition revision 3のimmutable hashは変更していない。
- fix-forward後のproduction controlled smoke `production-v3-controlled-smoke-20260919-fix-forward-final` はcompleted、outcomeはdeployed、releaseは `release-v3_d8425ff73a1135c15e0deefc6d2a0e74`、deployment requestはsucceeded、external event outboxはdelivered、deployment recordはcommittedとなった。cutover controlは `smoke_verified`、legacy writer無効、v2新規開始無効、v3新規開始有効、非終端v2 session 0件である。
- controlled smokeのdeployment境界はこのworkspaceで利用可能な `MemoryDeploymentAdapter` であり、実外部production deployment adapterの接続確認ではない。実運用では同じreceipt/event/verification契約を満たすproduction adapterと、作成済みstart policyの配布・監視を引き継ぐ。
- v3 production operatorとして `comment-data-update:v3` entrypointを追加し、既存authority DBとWork Orchestrator Workspaceを明示的に開いて、Session開始、Session/Human Task一覧、Human Task claim/open、artifact completion、decision completionおよびclaim releaseを提供した。targetはproduction固定で、v3 application-service adapterを使用し、汎用provider CLIの`new`経路は使用しない。
- operatorは指定されたproduction authority DBが存在しない場合にfail closedし、Session inputは開始時にpolicy/state pinを解決してv3 cutover guardへ渡す。artifact completionは既存のbytes、logical filename、cardinality、execution identityおよびArtifactVersion identity検証を再利用する。
- 専用operatorの永続Workspace跨ぎテストでartifact、Classification review、Keyword review、Promotion reviewおよびactor境界を確認した。consumer全体は173 tests passed、operator focused testsは2 tests passed、buildと`git diff --check`も成功した。
- operator CLIはlocal persistent runtime向けであり、外部production deployment adapterを自動構成しない。deployment境界を通すには実adapterと`deployment.completed` event配送・verificationを別途構成する。
- `tasks`のartifact Human Task表示に、Classificationの`worksetId`またはKeyword proposalの`requestId`・`inputFingerprint`を前段結果から提示するよう補強した。operatorがDBのruntime snapshotを直接参照せず、提示されたidentityでartifactを作成できる。
- production Session `production-comment-data-update-20260918T232637Z-15719` のread-only診断で、`12-materialize-release` が `ARTIFACT_INTEGRITY_ERROR` を3回記録し、`RETRY_EXHAUSTED` interventionになっていることを確認した。原因はDBの既存materialization metadataに対して、operatorのプロセス内MemoryReleaseArtifactStoreが再起動後に空になることだった。
- operatorはWorkspace配下のFileReleaseArtifactStoreを使用し、既存の既定`release.json` materializationはDBのbundleと保存hashを照合してrehydrateする。対象release `release-v3_d8425ff73a1135c15e0deefc6d2a0e74` はread-only検証で再生成hashとDB hashが一致した。
- GitHub Pages連携では、production operatorがActions workflow dispatchの入力として`deployment_request_id`、`release_id`、release bundle SHA-256を渡し、完了runを`deployment.completed`へ変換する。workflowはPages公開物に`comment-db-v3-deployment.json`を生成し、operatorは公開markerの同一identityを検証してからv3 deployment verificationへ進む。
- GitHub Pagesの実workflowは`unow-dev/mi-comopt`の`.github/workflows/deploy-pages.yml`（workflow id `343090137`）であり、公開先は`https://unow-dev.github.io/mi-comopt/`。workflow変更がGitHub側へ反映されるまでは、現行production SessionのPromotion reviewをacceptしない。
- GitHub Pages連携をconsumer commit `165ea83`から`3a66875`まで段階的に反映し、private provider checkout用の`WORK_ORCHESTRATOR_REPO_TOKEN` secret、provider build/link、workspace依存installおよびdeploy jobの公開後検証依存を構成した。最終push起点run `35442948209` はvalidate・Pages deploy・公開UI release検証まで成功した。
- production Session `production-comment-data-update-20260918T232637Z-15719` のPromotion reviewを`production-reviewer`がacceptし、workflow_dispatch run `35443131060`（deployment request `deployment-request-v3_1f890e659af56ce584a1e5cab94bffd4`）がvalidate・Pages deploy・v3 marker検証まで成功した。operator syncで`deployment.completed`をDBへ配送し、Sessionは`completed`、deployment requestは`succeeded`となった。
- 公開marker `https://unow-dev.github.io/mi-comopt/comment-db-v3-deployment.json` はtarget `production`、release `release-v3_d8425ff73a1135c15e0deefc6d2a0e74`、deployment requestおよびrelease bundle SHA-256がDB・workflow入力と一致した。
