# Work Task Sequence: Comment DB State Management / Workflow Handoff v2

## Purpose

`comment-data-update` と `deploy-promoted-release` を実装し、Comment DBを業務状態の単一正本として、証拠取込・Corpus・Classification・Keyword Selection・Release・Production Promotion・Deploymentを明示的な状態遷移と検証可能な系譜で運用できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、規範仕様・受入条件・実装順序・対象外事項および文書間の優先順位を確認する。
  - [x] 1.1 正本確認の範囲で、AIエージェントが、実装判断に使用する規範文書と補助資料の境界を整理する。
  - [x] 1.2 完了条件の範囲で、AIエージェントが、定義テスト・移行ゲート・受入テストA01〜A32を実装領域へ対応付ける。
- [x] 2. 既存実装の範囲で、AIエージェントが、Comment DB、work-orchestrator、既存のraw evidence・分類・候補publication・公開・デプロイ経路の現状と変更境界を確認する。
- [x] 3. 仕様整理の範囲で、AIエージェントが、Proposal → Decision → Commit、immutable versionとhead、明示的なversion参照、operation receipt、権限、再試行、単一正本およびAccount Candidateの派生扱いを実装条件として整理する。
- [x] 4. Work Orchestrator定義の範囲で、AIエージェントが、安定したStep ID・分岐構造・TaskContract・Human Task・waitEvent・結果参照を備えた2つのWorkDefinitionを構築・検証・登録できる状態にする。
  - [x] 4.1 定義グラフの範囲で、AIエージェントが、reviewable state update、Production Promotion、Deploymentおよびrecoveryの分岐を仕様どおり表現する。
  - [x] 4.2 定義互換性の範囲で、AIエージェントが、公開型への変換、型検査、検証、canonical hash、snapshotおよび登録結果を確認する。
  - [x] 4.3 失敗時制御の範囲で、AIエージェントが、必要な意味を表現できない実行基盤をfail closedに扱う。
- [x] 5. 状態制御基盤の範囲で、AIエージェントが、汎用State Control Plane、typed domain state、StateQuery・Proposal・Decision・Commitの境界および楽観的同時実行制御を整備する。
  - [x] 5.1 正本遷移の範囲で、AIエージェントが、依存関係・遷移・head更新・no-op・rollback・stale proposal conflictを一貫して扱える状態にする。
  - [x] 5.2 操作再実行の範囲で、AIエージェントが、同一operation IDの同一要求を再利用し、異なる要求を競合として拒否し、状態変更とreceiptを原子的に確定できる状態にする。
  - [x] 5.3 基盤検証の範囲で、AIエージェントまたはCIが、制御基盤の整合性、権限境界および同時実行・冪等性の条件を確認する。
- [x] 6. CorpusとPolicyの範囲で、AIエージェントが、raw evidenceを再利用しながらCorpusの意味上の採用状態とversioned policyを明示的に扱える状態にする。
  - [x] 6.1 入力固定の範囲で、AIエージェントが、Session開始時に解決したhead・policy・Projection Definitionを後続処理へ固定して渡せる状態にする。
  - [x] 6.2 Corpus更新の範囲で、AIエージェントが、変更・不変・競合・介入要の結果を正本遷移の規則に従って扱える状態にする。
- [ ] 7. Classification Stateの範囲で、AIエージェントが、既存分類結果のGenesis移行、評価・提案・人間レビュー・finalizeおよび新しいClassification headの利用を実現する。
  - [x] 7.1 移行検証の範囲で、AIエージェントまたはCIが、旧分類結果との意味的同値性、履歴を推測しないGenesisの扱いおよび互換projectionを確認する。
  - [x] 7.2 遷移確定の範囲で、AIエージェントが、承認権限・期待head・Transition Policy・proposalを再検証してからDecisionとCommitを行う境界を整備する。
  - [ ] 7.3 切替判断の範囲で、人間が、Classificationの移行検証結果と切替条件を確認し、単一正本への切替可否を判断する。
- [ ] 8. Keyword Selection Stateの範囲で、AIエージェントが、legacy publicationの状態・head・提案・成果物を分離してGenesis移行し、評価・レビュー・finalizeおよび明示version参照を実現する。
  - [x] 8.1 旧経路の扱いの範囲で、AIエージェントが、legacyのcurrent markerとfilesystemのcurrentを権威として扱わない互換projectionへ整理する。
  - [x] 8.2 切替検証の範囲で、AIエージェントまたはCIが、旧publicationとの意味的同値性、候補履歴・provenanceおよびlegacy writerの停止条件を確認する。
  - [ ] 8.3 切替判断の範囲で、人間が、Keyword Selectionの移行検証結果と切替条件を確認し、単一正本への切替可否を判断する。
- [x] 9. 派生候補とReleaseの範囲で、AIエージェントが、明示的なCorpus・Classification・Keyword Selection・PolicyからAccount Candidateを再計算し、exact-versionのRelease Bundleを構築・materialize・検証できる状態にする。
  - [x] 9.1 派生値の範囲で、AIエージェントまたはCIが、同じ正本入力から同じAccount Candidateを再生成でき、独立したauthoritative stateを作成しないことを確認する。
  - [x] 9.2 Release識別の範囲で、AIエージェントが、exact versionの組合せとProjection Definitionに基づくReleaseを重複なく扱える状態にする。
  - [x] 9.3 成果物検証の範囲で、AIエージェントまたはCIが、成果物の完全性・fingerprint・参照関係およびmaterialize後の整合性を確認する。
- [x] 10. Production Promotionの範囲で、AIエージェントが、検証済みReleaseに対する常時Human Taskの承認・拒否・競合・no-opを正本Promotion Stateとして扱える状態にする。
  - [x] 10.1 承認経路の範囲で、AIエージェントが、人間の結果を正式なDecisionへ変換し、承認されたReleaseだけをDeployment経路へ渡せる状態にする。
  - [x] 10.2 拒否・競合の範囲で、AIエージェントまたはCIが、Promotion headを不正に変更せず、not_promoted・superseded・blockedを仕様どおり返すことを確認する。
- [x] 11. DeploymentとRecoveryの範囲で、AIエージェントが、ensure semantics、deployment event、独立検証、Deployment State記録およびpromoted Releaseのみを再試行するrecovery経路を実現する。
  - [x] 11.1 外部処理の範囲で、AIエージェントが、同一deploymentRequestIdによる再実行、既存配信のverify、重複eventおよび失敗eventを安全に扱える状態にする。
  - [x] 11.2 実状態記録の範囲で、AIエージェントが、検証結果を根拠としてDeploymentのProposal・Decision・Commitを行い、未検証の成功を正本へ反映しない状態にする。
  - [x] 11.3 障害復旧検証の範囲で、AIエージェントまたはCIが、crash-before-receipt、duplicate event、external verification failure、already-deployedおよびrecoveryの条件を確認する。
- [ ] 12. ドメイン移行の範囲で、AIエージェントが、Corpus・Classification・Keyword Selection・Release・Promotion・Deploymentを順次Backfilled、Verified、Cutover、Legacy Read Compatibility、Retiredへ移行する。
  - [ ] 12.1 単一正本の範囲で、AIエージェントが、各cutover後に新しいCommit経路だけがauthoritative stateを変更する状態にする。
  - [ ] 12.2 互換性の範囲で、AIエージェントが、必要なlegacy-shaped outputを新しい正本から再生成し、旧current marker読取とauthoritative dual writeを排除する。
  - [ ] 12.3 廃止判断の範囲で、人間が、各streamの受入結果とcutover gateを確認し、legacy writer・readerの停止およびretireを判断する。
- [x] 13. 統合検証の範囲で、AIエージェントまたはCIが、Work OrchestratorとComment DB・外部Deploymentの接続を行い、定義テスト、移行テストおよび受入テストA01〜A32を実行する。
  - [x] 13.1 正常系の範囲で、AIエージェントまたはCIが、auto-commit、human accept、Release materialize、PromotionおよびDeployment完了までの結果を確認する。
  - [x] 13.2 判断・競合系の範囲で、AIエージェントまたはCIが、human reject、stale head、権限不備、dependency不備、no-opおよびpinned input isolationを確認する。
  - [x] 13.3 障害・再試行系の範囲で、AIエージェントまたはCIが、technical retry、retry exhaustion、idempotency conflict、registry復旧および外部Deployment失敗を確認する。
- [x] 14. 作業結果の範囲で、AIエージェントが、実装内容、切替済みstream、定義revision、検証結果、未完了事項、残存する互換経路および運用上の注意点を記録する。

## Work Notes

- 実装上の優先順位は、`01_NORMATIVE_IMPLEMENTATION_SPEC_V2.md`、`02_WORK_ORCHESTRATOR_FLOW.md`〜`06_IMPLEMENTATION_SEQUENCE.md`、`contracts/`、`07_DECISION_LOG.md`、`08_TASK_IO_AND_PERMISSION_MATRIX.md`、補助資料の順とする。
- `docs/archive` 配下の文書は参照しない。`references/` と `source_context/` は現状確認・証拠としてのみ扱い、To-Be実装の正本にはしない。
- Work Orchestratorはworkflow execution state、Comment DBはbusiness/domain stateを所有する。両者を単一の正本として扱わず、RegistryとComment DBの権限・receipt・再実行境界を分離する。
- 人間のレビュー完了は正式なDecisionではない。finalize処理ではactor権限、proposal、期待head、Transition Policyおよびreview outcomeを再検証する。
- 技術的再試行は同一Task・同一Session・同一operation IDで扱い、意味上の競合は自動rebaseせず、新しいSessionで再実行する。外部Deploymentの失敗は業務フロー内で無制限にループさせない。
- Account Candidateは独立したState Streamを持たない派生値とし、Release Builderはlatest/currentを暗黙に解決せず、Sessionで確定した明示versionだけを入力にする。
- 各タスクの完了時に、検証結果・判断・差戻し・未完了事項を本節へ追記し、完了したタスクだけを `[x]` に更新する。
- `03b396a` を着手前のベースラインコミットとして作成した。
- State Control Planeは既存v8 read-model接続との互換性のため明示有効化方式で追加し、状態変更はStateControlPlane/Application Service経由に集約した。
- `comment-db-state.test.js`でA01〜A32の主要シナリオをグループ化して検証し、定義hash、human review、stale head、idempotency、release dedupe、deployment event/verify、pinned input、cutover projectionおよび派生候補を確認した。
- Classification/Keyword Selectionの人間によるcutover判断、全streamの本番Retired判断は未実施であり、該当する人間タスクと移行ゲートは未完了のまま残している。
- `/home/uya/Workspace/work-orchestrator/package` を `work-orchestrator` のローカル runtime dependency として `--install-links` 付きで導入し、公開 root import を確認した。
- 互換実装前の実パッケージ登録では、Choice の decision Task 必須・空 terminal sequence 不可・deploymentRequestId の動的 correlationKey 不可という公開契約差分を検出して fail closed した。その後、Provider/Consumerの互換実装により公開契約へ適合させ、両定義の実登録まで完了した。
- 公開 `validateAndHashDefinition` の拒否は `WORK_ORCHESTRATOR_INCOMPATIBLE` に正規化し、公開 root import と fail-closed 経路をテストで固定した。
- Consumer と Provider の互換性ギャップを、相互依存を保つ1件の子Issueへ統合し、`ISSUE_BODY.md` と `WORK_TASK_SEQUENCE.md` を作成した。
- 互換実装前の導入後も `npm test` は138件全件成功し、`npm run build` は成功した。
- 子Issueの互換実装をConsumer `318f800`、Provider `5f3d836` としてコミットし、公開Provider rootから両定義を実登録できることを確認した。
- 定義hashは `comment-data-update@2=77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`、`deploy-promoted-release@2=aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`。Provider 27件、Consumer 141件のテスト、双方のbuildが成功した。
- 公開Provider `WorkOrchestrator` とComment DB `ApplicationServiceAgentAdapter` の実統合で、human Promotion accept、Deployment callback/outbox配信、最終Session `deployed` およびDeployment State commitを確認した。
- 親タスク4.2と13系は上記の定義登録・受入検証を根拠に完了とした。Classification/Keyword Selectionおよび全streamの本番cutover・Retiredは人間判断が必要なため未完了のまま残している。
- 移行ライフサイクルに `Backfilled -> Verified -> Cutover -> Legacy Read Compatibility -> Retired` の順序と、cutover gate（意味同値性、Commit経路の排他、legacy writer停止、projection再生成、current marker非権威化、rollback時の二重正本防止）を実装した。
- Classificationのlegacy label writerとKeyword Selectionのlegacy publication writer/current marker readerは、対応streamがcutover以降になるとfail closedする境界を追加した。実際の全stream cutoverとlegacy-shaped output利用者の切替は、12.1/12.2の未完了範囲として残している。
- 実DB `var/comment-history.sqlite3` はread-only確認時点でState Control Plane未導入、legacy keyword publicationは2件（current 1件）、legacy classification labelは24,622件だった。実DBへのschema追加・Genesis backfill・cutoverは未実施であり、運用判断と検証計画の確定後に行う。
