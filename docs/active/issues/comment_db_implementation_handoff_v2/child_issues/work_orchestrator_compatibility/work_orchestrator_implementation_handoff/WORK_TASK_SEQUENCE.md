# Work Task Sequence: Work Orchestrator Compatibility Implementation Handoff

## Purpose

`comment-data-update@2` と `deploy-promoted-release@2` を、Provider と Consumer の公開契約・実行意味論・業務状態境界に適合させ、v1 互換を保ちながら、Policy provenance、Deployment の冪等性・再実行性・Session routing、canonical hash、登録および受入検証まで完了した状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、最終仕様・実装引き継ぎ・受入条件・文書間の優先順位と、v1互換およびv2変更の境界を確定する。
- [ ] 2. Provider公開契約の範囲で、AIエージェントが、schema v2のInputBinding・Choice・Noop・WaitEvent・Task契約・Agent入出力・Human provenance・Session viewを整合させ、v1の公開契約を維持する。
  - [ ] 2.1 構造検証の範囲で、AIエージェントが、schemaVersionごとの定義検証、bindingのJSON Pointer・可視性、Human/Agentのbudget条件、Noopおよび空Sequenceの条件を確認する。
  - [ ] 2.2 公開APIの範囲で、AIエージェントが、Provider root export、型宣言およびパッケージメタデータにv2契約を反映する。
- [ ] 3. Provider実行意味論の範囲で、AIエージェントが、binding Choice、task-source参照、Noop、Agent outcome、blocked介入、Human completedBy、動的WaitEvent相関およびresultsByStepIdを実装する。
  - [ ] 3.1 実行経路の範囲で、AIエージェントが、in-process runtimeとTemporal経路の間で新しいAgent入出力・budget・blocked・wait状態を同じ意味で伝播する。
  - [ ] 3.2 復旧の範囲で、AIエージェントが、WaitRuntimeの確定済み相関値、Task provenanceおよび新しいSession viewをRegistry保存・再読込後も維持する。
- [ ] 4. Provider外部イベント配信の範囲で、AIエージェントが、receipt-first、payload hash照合、active Session配信およびterminal Sessionの`terminal_ignored`を備えた公開facadeを整備する。
  - [ ] 4.1 冪等性の範囲で、AIエージェントが、同一command IDの再送を再利用し、異なるpayloadをactive・closed後のいずれでも競合として扱う。
  - [ ] 4.2 Provider検証の範囲で、AIエージェントまたはCIが、追加プロパティ禁止・minLengthを含むresultSchema検証と外部イベント回帰条件を確認する。
- [ ] 5. Consumer状態とPolicyの範囲で、AIエージェントが、実在するPolicy stream、exact-stream version検証、Session pinning、Recovery入力およびfail-closedなPolicy解決を整備する。
  - [ ] 5.1 起動入力の範囲で、AIエージェントが、corpus・classification・keyword-selection・account・projectionの依存versionとcorpus policyをSession開始時に検証・固定する。
  - [ ] 5.2 業務境界の範囲で、AIエージェントが、ProposalのPolicy dependencyを権威とし、Cross-stream参照・疑似Policy ID・欠落時の空payload fallbackを排除する。
- [ ] 6. Consumer Application ServiceとAgentAdapterの範囲で、AIエージェントが、Promotion propose、finalize、ReleaseのPolicy検証、Deployment record、stable OperationContextおよび明示的なrouting結果を整合させる。
  - [ ] 6.1 Promotionの範囲で、AIエージェントが、Human review前のProposal作成、head・Policyの一度限りのpin、reject時のformal Decision、accept時のstale-head検出を実現する。
  - [ ] 6.2 Agent境界の範囲で、AIエージェントが、`<sessionId>/<stepId>/1`のoperation identity、正常結果・blocked・technical failureの分類、必要権限および`promotion.propose`を確認する。
- [ ] 7. Deployment intent ledgerとevent ingressの範囲で、AIエージェントが、durable prepared intent、monotonic reconciliation、callback audit、workflow Session routingおよびoutbox replayを実現する。
  - [ ] 7.1 Trigger競合の範囲で、AIエージェントが、外部呼出し前の台帳確定、同一deploymentRequestIdの再利用、即時完了・失敗・Promotion ABAおよびterminal state非回帰を扱う。
  - [ ] 7.2 Callback配信の範囲で、AIエージェントが、未知・不一致・重複・競合eventを検証し、auditとProvider配信outboxを原子的に記録して再送可能にする。
  - [ ] 7.3 Deployment正本の範囲で、AIエージェントが、独立verify後のverificationRefを証拠として保持し、Deployment semantic stateから除外したProposal・Decision・Commitを実現する。
- [ ] 8. Consumer revision-2定義の範囲で、AIエージェントが、Blueprintどおりの2つのWorkDefinitionを構築し、semantic Record binding、Noop終端、正しい分岐継続、動的deploymentRequestId相関およびrecovery経路を反映する。
  - [ ] 8.1 定義構造の範囲で、AIエージェントが、review accept/rejectを必ずfinalizeへ通し、`blocked` Choice分岐・空Sequence終端・positional inputBindings・blind suffix rewriteを除去する。
  - [ ] 8.2 互換性境界の範囲で、AIエージェントが、Provider公開validatorを唯一の構造validatorとして利用し、Consumer側では業務不変条件・stable ID・権限・hash snapshotのみを検証する。
- [ ] 9. Outcome projectionの範囲で、AIエージェントが、completed Session viewの`resultsByStepId`とNoop terminal markerから業務結果を投影し、diagnosticなdetailsを権威として扱わない状態にする。
- [ ] 10. Definition hash・パッケージ・登録の範囲で、AIエージェントが、Provider package version、生成dist・型宣言、v2 canonical hash、immutable snapshotおよび両WorkDefinitionの公開root登録を確定する。
  - [ ] 10.1 Revision保護の範囲で、AIエージェントが、v2 treeの変更をrevision 1へ割り当てず、revision-1 hash不変とrevision-2 hashの最終生成後pinを確認する。
  - [ ] 10.2 配布整合性の範囲で、AIエージェントまたはCIが、Provider・Consumerのbuild、依存lock、公開distおよび登録結果を確認する。
- [ ] 11. 受入検証の範囲で、AIエージェントまたはCIが、Provider互換性テスト、Consumer定義・Policyテスト、Deployment race/crash/outboxテスト、OutcomeテストおよびA01〜A32を実行して完了条件を確認する。
  - [ ] 11.1 Provider回帰の範囲で、AIエージェントまたはCIが、v1挙動維持、v2構造・runtime・Temporal parity・recovery・event facadeを確認する。
  - [ ] 11.2 Consumer回帰の範囲で、AIエージェントまたはCIが、exact-stream、formal Decision、pin isolation、revision immutability、deployment lifecycleおよびrecoveryを確認する。
  - [ ] 11.3 完了判定の範囲で、AIエージェントが、未完了事項・検証結果・残存リスクを整理し、すべての必須チェックが満たされたことを記録する。

## Work Notes

- 規範上の参照順は、`01_FINAL_SPEC.md`、`02_PROVIDER_IMPLEMENTATION.md`、`03_CONSUMER_IMPLEMENTATION.md`、`04_DEPLOYMENT_INGRESS_AND_LEDGER.md`、`05_DEFINITION_V2_BLUEPRINT.md`、`06_ACCEPTANCE_AND_REGRESSION.md`、`07_IMPLEMENTATION_SEQUENCE.md`、`08_FILE_CHANGE_MAP.md`、`09_DECISION_DELTA.md`、`10_IMPLEMENTER_CHECKLIST.md`、`source_context/`の順とする。
- `docs/archive` 配下の文書は参照しない。既存の親Issue文書およびsource_contextは現状・補助情報として扱い、最終互換仕様と矛盾する場合は上記の規範順を優先する。
- Providerはworkflow execution state、Comment DB/Applicationはbusiness authoritative stateを所有する。Task完了やterminal Noopの完了だけでは業務状態のCommitとみなさない。
- schema v1の挙動は維持し、Consumerの新規定義は`comment-data-update@2`と`deploy-promoted-release@2`に限定する。`blocked`はv2のrouting outcomeではなく、Agent実行のoperational dispositionとして扱う。
- Policyは`policy/corpus`、`policy/classification`、`policy/keyword-selection`、`policy/account-candidate`、`policy/promotion-production`、`policy/deployment-production`の実在versionを使用し、Decisionへ疑似Policy IDやcross-stream versionを記録しない。
- Deploymentでは、request ledgerを外部呼出しより先に確定し、callbackのauditとProvider配信outboxを再実行可能にする。成功callbackだけではDeployment Stateを確定せず、独立したverifyとrecordを必須とする。
- 技術的再試行は同一Session・同一Task・同一operation IDで再利用し、意味上の競合は自動rebaseせず、新しいSessionまたはRecovery Sessionで扱う。RecoveryはPromotion versionとreleaseの同一head観測ペアをpinする。
- 各タスクの完了時に、検証結果・判断・差戻し・未完了事項を本節へ追記し、完了したタスクだけを`[x]`へ更新する。
