# Work Task Sequence: Cumulative Corpus Update Implementation Handoff

## Purpose

既存の有効なcorpusと追加データを重複排除して累積統合し、分類、Source Dataset、keyword、account、overview、comments、および公開用releaseが同一のlogical cumulative corpusを正本として生成・検証・公開できる状態にする。既に発生しているcorpus欠落がある場合は、承認済みの範囲だけをrecoveryし、corrected releaseのdeployment verificationまで完了する。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、実装仕様、実装順序、変更対象、受入条件、recovery手順、決定事項、対象外事項、および文書間の優先順位を確認する。
- [ ] 2. 実装前確認の範囲で、AIエージェントが、現行corpus更新、snapshot投影、分類、Source Dataset、下流分析、release、operator、cutover、およびWeb consumerの契約と変更境界を確認する。
- [ ] 3. 仕様差異の判断範囲で、人間が、現行実装またはproduction状態が確定済み仕様と矛盾する場合に、仕様へ差し戻す要否、追加の承認、および作業継続条件を判断する。
- [ ] 4. 累積corpus基盤の実装範囲で、AIエージェントが、既存corpusのsnapshot参照を順序どおりに保持し、追加参照をfirst-winsで統合し、5項目完全一致の観測値を重複排除できる状態へ変更する。
- [ ] 5. Corpus v2 stateの実装範囲で、AIエージェントが、累積snapshot参照を正本として保存し、同一stateの再更新をno-opとし、v1 headの通常更新を拒否し、snapshot参照の保存形式を一意に扱える状態へ変更する。
- [ ] 6. 累積分類計画の実装範囲で、AIエージェントが、直前のClassificationVersionをauthorityとして、observation単位、comment text単位、human decisionの順に分類を解決し、survivor全件を含むcomplete stateを生成できる状態へ変更する。
- [ ] 7. 分類handoff安全性の実装範囲で、AIエージェントが、既存分類で解決済みの項目をChatGPT対象へ混入させず、handoff確定直前の検証、human review要否、および失敗時のfail-closed動作を整備する。
- [ ] 8. Source Dataset v2の実装範囲で、AIエージェントが、累積projectionと分類結果を完全一致で検証し、survivor順に公開用indexを再採番し、corpus・classification・snapshot参照を追跡できるsourceを生成する。
- [ ] 9. 下流分析統一の実装範囲で、AIエージェントが、keyword、account、overview、およびcommentsを同一のSource Dataset v2から生成し、各経路に残るsingle-snapshot前提と独自snapshot再読込を解消する。
- [ ] 10. Release整合性の実装範囲で、AIエージェントが、corpus・classification・source・downstream artifactの依存関係とSHAをfail-closedで検証し、production artifactの任意overrideを受け付けないrelease生成・materialize経路を整備する。
- [ ] 11. Web consumer互換性の確認範囲で、AIエージェントが、実Web consumerのSource Dataset契約を確認し、schema versionまたはsingle snapshot参照への固定依存が残る場合に、同一cutoverで必要な対応範囲を特定する。
- [ ] 12. Recovery入力確定の範囲で、人間が、既存欠落状態の有無、recovery実施可否、`baseCorpusVersionId`、`brokenHeadCorpusVersionId`、および対象productionの復旧範囲を確定する。
- [ ] 13. Recovery実装の範囲で、AIエージェントが、明示されたbaseからbroken headまでの承認済み範囲を累積復旧し、既存分類を可能な限り継承し、真に未解決な項目だけを再分類対象にできる状態へ整備する。
- [ ] 14. Production cutover準備の範囲で、AIエージェントが、通常更新とrecoveryを分離し、new startsのfreeze、非終端処理のdrain、head再確認、再実行時のidempotency、およびfailure時のfix-forward条件を検証可能にする。
- [ ] 15. Production公開判断の範囲で、人間が、実装結果、受入結果、recovery対象、公開対象、deployment条件、および失敗時のfix-forward方針を確認してcutover・公開を承認する。
- [ ] 16. Production cutover実行の範囲で、AIエージェントが、承認済みの順序でfreeze、state構築、分類、Source Dataset生成、下流artifact生成、corrected releaseの公開、およびdeployment verificationを実行する。
- [ ] 17. 回帰・受入検証の範囲で、AIエージェントまたはCIが、累積projection、exact dedupe、分類継承、handoff安全性、complete state、Source Dataset v2、release gate、recovery冪等性、およびend-to-endのlogical corpus identityを確認する。
- [ ] 18. 作業結果の範囲で、AIエージェントが、変更内容、検証結果、production recovery・deploymentの結果、未完了事項、運用上の注意点、および対象外事項を記録する。

## Work Notes

- 仕様の正本は `01_IMPLEMENTATION_SPEC.md` とし、実装順序は `02_WORK_ITEMS.md`、変更境界は `03_CHANGE_MAP.md`、必須検証は `04_ACCEPTANCE_TESTS.md`、recovery手順は `05_RECOVERY_RUNBOOK.md`、現行コードの根拠は `07_CURRENT_CODE_EVIDENCE.md`、判断と対象外事項は `08_DECISIONS_AND_NON_GOALS.md` を参照する。
- logical corpusの不変条件は、既存有効corpus + 新規追加データ - 5項目完全一致の重複である。保存値のtrim、normalization、case folding、Unicode normalization、日時の再解釈は行わない。
- snapshot参照は既存corpusを先に評価し、snapshot内は `source_index ASC` とする。同一観測値のdedupeはcollision-freeな5項目tupleでfirst-winsとする。
- v3の分類authorityはpinned ClassificationVersionに限定する。legacy three-class workset DBおよびDB全履歴の分類は、通常更新のauthorityにしない。
- downstream artifactはSource Dataset v2を共通入力とし、分類・corpusのpin不一致、source SHA不一致、artifact identity不一致がある場合は公開を停止する。
- 既存のbroken headがある場合、全raw snapshotまたは全corpus履歴を無条件にunionせず、人間が確定したbaseとbroken headの範囲だけをrecoveryする。broken semanticsへのrollbackは行わず、失敗時はfreezeを維持してfix-forwardする。
- 本番入力、recovery対象、cutover承認、公開可否などの判断は人間が行う。人間による確定前にproduction mutationやcorrected releaseの公開を完了扱いにしない。
- `docs/archive` 配下の文書は参照しない。
