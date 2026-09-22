# Work Task Sequence: Cumulative Corpus Update実装・Production Recovery

## Purpose

既存有効データと追加データを、保存値完全一致の5項目でfirst-wins重複排除した累積corpusとして扱い、分類・Source Dataset・keyword/account/overview/comments・Release・実配信を同一logical corpusに揃え、既知のproduction欠落状態を復旧して検証済みの状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、累積corpus不変条件、変更対象、非変更対象、受入条件、およびproduction recoveryを含む完了条件を確認する。
- [ ] 2. 未決事項の範囲で、人間が、正常なbaseCorpusVersionId、復旧対象のbrokenHeadCorpusVersionId、実行主体、対象環境、およびproduction実行時の承認事項を確定する。
- [x] 3. 既存実装の範囲で、AIエージェントが、corpus・raw snapshot・classification・source dataset・下流artifact・Release・cutover・operatorの現行境界とテストbaselineを確認する。
- [x] 4. 仕様整理の範囲で、AIエージェントが、schema v2、snapshot参照順、source_index順、5項目完全一致dedupe、分類authority、Source Dataset v2、cross-pin、およびrecovery CLIの実装条件を整理する。
- [x] 5. Corpus投影基盤の範囲で、AIエージェントが、snapshot参照順readerと累積projectionを整備し、observationIdの露出、source_index順、および保存値を変更しないfirst-wins重複排除を実現する。
- [x] 6. Corpus state更新の範囲で、AIエージェントが、prior refsを先に引き継ぐCorpus v2更新、snapshot refのcanonical serialization、重複投入時のno-op、v1 head拒否、およびsession開始前のpreflight guardを整備する。
- [x] 7. 累積classificationの範囲で、AIエージェントが、直前にpinされたClassificationVersionをauthorityとするpure plannerを整備し、exact observationId、同一comment text、human decisionの順で解決し、survivor全件を含むcomplete stateを生成する。
- [x] 8. Classification handoffの範囲で、AIエージェントが、未解決項目だけを決定的にhandoffし、handoff確定直前のpreviously resolved item検査とfail-closedエラーを実装する。
- [x] 9. Source Datasetの範囲で、AIエージェントが、累積survivorとclassificationの完全一致を検証し、schema v2、corpus/classification identity、ordered snapshot refs、および0始まりの公開source_indexを持つSource Datasetを生成する。
- [x] 10. 下流分析の範囲で、AIエージェントが、keyword、account、overview、commentsの全入力を同一Source Dataset v2へ統一し、独自snapshot再読込とsingle-snapshot前提を除去する。
- [x] 11. Release整合性の範囲で、AIエージェントが、corpus/classification/source SHA/downstream source identityのcross-pinをfail-closedで検証し、caller supplied artifact overrideを排除したReleaseとmanifestを整備する。
- [x] 12. Web consumer cutoverの範囲で、AIエージェントが、実Web consumerのschema v2対応とsnapshot固定依存の有無を確認し、必要な同一cutover内の変更を反映する。
- [x] 13. Recovery制御の範囲で、AIエージェントが、`recovery_frozen`、freeze/drain/plan/start/cancel/status/resume、classification/keyword handoff、verify、completeの制御と、既存operation receiptをauthorityとするidempotentな進捗復元を整備する。
- [x] 14. Recovery分類の範囲で、AIエージェントが、明示されたbaseからbroken headまでを対象にexact 5-field dedupe groupを構成し、group memberの最新historical label、recovery内で解決済みの同一comment text、human decisionの順で分類を復旧する。
- [x] 15. 自動検証の範囲で、AIエージェントまたはCIが、projection、Corpus v2、classification、handoff safety、Source Dataset v2、Release gate、Recovery authority、CLI state transition、および小規模E2Eの受入条件を検証する。
- [ ] 16. Production recovery実行の範囲で、人間が、`recovery freeze`、nonterminal sessionのdrain、non-mutating `recovery plan`、plan SHAにbindした`recovery start`、必要なhuman handoff、corrected Releaseのdeployを実行する。
- [ ] 17. 配信検証の範囲で、AIエージェントまたはCIが、recovered corpus/classificationからの再生成結果、materialized artifact、served manifest、comments/keywords/accounts/overviewの実配信read-back、SHA、record count、および依存identityを照合する。
- [ ] 18. 完了処理の範囲で、人間が、`previouslyResolvedItemCount == 0`、recovery verification receipt、実配信済みcorrected Release、および検証証跡を確認したうえで`recovery complete`を実行し、Issueの完了判断を行う。

## Work Notes

- 正本となる不変条件は、`Existing Valid Corpus + Newly Added Data - exact duplicate`であり、dedupe keyは`(username, handle, comment, postedAt, postedDate)`の保存値完全一致とする。trim、normalization、case folding、Unicode normalization、日時の再解釈は行わない。
- Corpus v2のsnapshot ref identityは`(payloadSha256, snapshotIndex)`。prior snapshot refsをincoming refsより先に評価し、同一snapshot refの再投入ではsemantic stateを変更しない。
- v3のclassification authorityはpinされた`classification_state_labels`に限定する。legacy workset DB、snapshot comment label、DB全履歴のglobal label readerはv3通常更新・recoveryのauthorityにしない。
- Recoveryでは、current recovery corpusのexact 5-field dedupe groupに属する全observationをhistorical label検索対象とし、dedupe loserにだけlabelがある場合もsurvivorへ復旧する。recovery corpus外のhistorical comment labelは使用しない。
- Recoveryのcanonical countは`expectedLogicalRecordCount = baseLogicalRecordCount + appendedRawObservationCount - duplicateObservationCount`。固定件数を期待値として実装しない。
- `recovery plan`はfreezeとdrainの後に実行するnon-mutating計画で、`recovery start`は同じcanonical planを再計算し、plan SHA不一致時は`RECOVERY_PLAN_STALE`でmutation前に停止する。
- `recovery_frozen`から通常の`fix_forward_v3`でstartsを再開しない。verification成功に紐づく`recovery complete`だけが`smoke_verified`への復帰を許可する。
- `recovery verify`はmarker確認だけで完了にせず、Source Dataset v2・Overview・Accountをdeterministically rebuildし、served manifestと全公開artifactをprovider read-backして照合する。
- production recovery失敗時は既知の欠落releaseへrollbackせず、現在の配信を維持し、freeze状態とimmutable stageを保ったままretry/resumeする。
- Issue closeにはCI greenだけでなく、production recovery実行、corrected Releaseのdeploy、verification receipt、`previouslyResolvedItemCount == 0`、artifact identityの証跡、および`recovery complete`が必要である。
- ベースラインコミットは `a413a65 chore: baseline cumulative corpus handoff review`。
- 実装では、ordered snapshot reader、累積Corpus/Classification/Source Dataset v2、下流artifactのcross-pin、`recovery_frozen` と recovery CLI、immutable operation receipt、provider read-back verifier、および小規模Recovery E2Eを追加した。
- 構文検査と `git diff --check` は成功し、パッケージ全体の `npm test` は191件成功・0件失敗だった。
- 本番のbase/broken head・実行主体・承認、human classification/keyword handoff、corrected Releaseのdeploy、実配信read-back、`recovery complete` は未実施であり、人間の判断後に実行する。
- 参照する正本は同ディレクトリの`01_IMPLEMENTATION_SPEC.md`、`02_WORK_ITEMS.md`、`04_ACCEPTANCE_TESTS.md`、`05_RECOVERY_RUNBOOK.md`、`09_HANDOFF.yaml`、`11_RECOVERY_CLI_AND_DOD.md`、`13_REVIEW_ROUND_2.md`とする。
