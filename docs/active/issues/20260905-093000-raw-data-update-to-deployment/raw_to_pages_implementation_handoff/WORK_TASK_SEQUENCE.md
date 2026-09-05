# Work Task Sequence: 最新raw-dataからGitHub Pagesデプロイまでの継続更新運用

## Purpose

authoritative full raw snapshotを入力として、過去のラベリング判断を安全に継続利用し、同一のthree-class datasetから生成したキーワード候補とアカウント候補を検証済みの状態でGitHub Pagesへ公開し、次回更新へ接続できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、最終仕様、受入条件、対象外事項、実装順序および文書間の優先順位を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、既存のラベリング・候補生成・公開・CIの基準状態、変更境界および回帰確認方法を確認する。
- [x] 3. ラベリング継続性の実装範囲で、AIエージェントが、raw入力契約、Stage 13の前回公開成功reference、および3-Class判断の継続利用を実現する。
- [x] 4. ラベリング継続性の検証範囲で、AIエージェントまたはCIが、raw入力の厳格性、reference再利用、review判断のpromotion、競合拒否および既存分類結果の維持を確認する。
- [x] 5. 共同公開の実装範囲で、AIエージェントが、キーワード候補とアカウント候補を同一three-class datasetから生成し、公開成果物と系譜情報を一つの更新単位として扱えるようにする。
- [x] 6. 公開整合性の実装範囲で、AIエージェントが、恒久runtime contract、release record、および公開前のfail-closed検証を整備する。
- [x] 7. 共同公開の検証範囲で、AIエージェントまたはCIが、親publicationとの系譜、共有dataset SHA、公開対象の限定、release recordおよびruntime contractの整合性を確認する。
- [x] 8. 継続デプロイの実装範囲で、AIエージェントが、PR時の検証、mainへの反映後に限るPages公開、および公開済みrelease recordの一致確認を実現する。
- [x] 9. 運用文書の整備範囲で、AIエージェントが、bootstrapと通常更新を区別した継続runbook、公開後のStage 13 reference promotion、および異常時の停止条件を記録する。
- [ ] 10. 初回更新入力の準備範囲で、人間が、authoritative full raw snapshot、`scope_id`、`source_ref`、およびbootstrapで使用するStage 13 referenceを確定する。
- [ ] 11. 初回ラベリング判断の範囲で、人間が、Stage 13と3-Classの必要なレビューを行い、継続利用可能な判断を確定する。
- [ ] 12. 初回公開の実行範囲で、AIエージェントが、確定済み入力と判断からラベリング、候補生成、共同公開staging、release record生成およびローカル検証を実行する。
- [ ] 13. 公開判断の範囲で、人間が、公開対象、検証結果、raw snapshotの妥当性および公開可否を判断する。
- [ ] 14. CI・Pages公開の検証範囲で、AIエージェントまたはCIが、main反映後の検証、Pagesデプロイ、および公開済みrelease recordのbyte一致を確認する。
- [ ] 15. 公開後継続性の確認範囲で、AIエージェントが、公開成功したStage 13出力をprivate referenceへpromotionし、次回runで参照できることを確認する。
- [x] 16. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、公開したrunとdatasetの対応、および残存する運用上の注意点を記録する。

## Work Notes

- 仕様の正本は `README_FIRST.md`、`docs/IMPLEMENTATION_SPEC.md`、`docs/PR_1_LABELING_CONTINUITY.md`、`docs/PR_2_JOINT_PUBLICATION.md`、`docs/PR_3_CI_AND_BOOTSTRAP.md`、`docs/ACCEPTANCE_TESTS.md` の順とする。snapshot内の既存実装・文書と矛盾する場合は、このhandoffの最終仕様を優先する。
- 本作業の公開更新単位は、キーワード5 artifact、アカウント3 artifact、および実データから生成する `data-release.json` である。通常更新でその他のgenerated data、UI schema、account evidence schema、Comment DBは変更しない。
- rawは差分ではなくauthoritative full snapshotであり、各rowの5 fieldはすべてJSON stringとする。同一5-field rowを自動dedupしない。collector実装は対象外とする。
- Stage 13はbootstrap時だけ検証済みlegacy outputまたはimmutable baselineを使用できる。通常runでは前回の公開成功runをprivate referenceとして用い、欠損時はbaselineへ暗黙に戻らず停止する。raw・作業directory・Stage 13/three-class full output・review CSV・handoff/proposalはGitへcommitしない。
- 3-Classのreview判断はoperational registryへpromotionし、異なる既存判断の上書きは許可しない。人間のfree-text noteを公開registryのrationaleへ直接コピーしない。判断訂正・retirementは本作業の対象外とする。
- keyword/accountのdataset SHAと`data-release.json`のthree-class SHAは一致が必須である。不一致、mandatory review未解決、release verification失敗、またはPages公開失敗時は公開を中止し、Stage 13 referenceをpromotionしない。
- 実装完了後の初回bootstrapには、未同梱のauthoritative raw snapshotと人間によるラベリング判断が必要である。これらの提供・確定前はタスク10以降を開始しない。
- issue closeは、受入テストのEnd-to-end bootstrapをすべて満たし、Pages上の`data-release.json`がrepository/build版とbyte一致し、次回のStage 13 prepareがpromoted private referenceを読めることを確認した時点とする。
- 2026-09-05時点で、ベースラインコミットは `88ab813`、実装コミットは `bf5ada2`、系譜検証強化コミットは `1c5aa38`。作業ツリーにはhandoff入力ディレクトリのみ未追跡で残し、raw・作業成果物・handoffはコミットしていない。
- 実装および検証済み: `npm test`（61件成功）、Integrated Labelingテスト（24グループ成功）、`npm run build`、`npm run verify:data`、`git diff --check`。
- `npm run verify:release` は `package/public/data-release.json` 未生成で停止した。これは初回raw・scope/source・Stage 13出力・three-class判断が未提供のためであり、公開成果物を捏造せずfail-closedになっていることを確認した。
- タスク10〜15は、authoritative full raw snapshot、人間によるStage 13/3-Class判断、公開可否の人間判断、およびPages公開環境が未提供のため未完了。提供後にbootstrap、ローカルrelease検証、main反映、Pages byte一致確認、reference promotionを順に実施する。
