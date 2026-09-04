# Work Task Sequence: レイヤーモデルによるアーキテクチャ整理

## Purpose

データ加工、データベース、UI、および外部境界の責務と依存関係がディレクトリ単位で明確になり、既存の動作・生成物・account generator provenanceを維持した状態で変更と検証を行えるようにする。

## Task Sequence

- [ ] 1. 実装前確認の範囲で、AIエージェントが、実行環境、既存変更、生成物、およびaccount generator provenanceの基準を確認する。
- [ ] 2. 共通責務の分離範囲で、AIエージェントが、加工機能間で共有する検証責務を整理する。
- [ ] 3. レイヤー構造の分離範囲で、AIエージェントが、Processing、Database、UI、および外部境界の実装責務を変更する。
- [ ] 4. keyword handoffの責務分離範囲で、AIエージェントが、意味処理とCLIによる入出力の境界を変更する。
- [ ] 5. UIデータ境界の範囲で、AIエージェントが、生成artifactからUI modelへの変換責務を変更する。
- [ ] 6. 互換性維持の範囲で、AIエージェントが、account generator provenanceおよび既存の外部契約が維持されていることを確認する。
- [ ] 7. 依存境界の検証範囲で、AIエージェントが、レイヤー間の禁止依存とUIデータ境界を検証する。
- [ ] 8. 非機能回帰の検証範囲で、AIエージェントが、既存テスト、データ検証、およびビルドを実行して結果を確認する。
- [ ] 9. 文書化の範囲で、AIエージェントが、アーキテクチャの責務、依存規則、および互換性例外を記録する。
- [ ] 10. 変更結果の確認範囲で、AIエージェントが、受入条件とレビュー観点に照らして完了可否を確認する。

## Work Notes

- 詳細な実装方針、最終ディレクトリ構造、およびファイル対応は `IMPLEMENTATION_HANDOFF.md` と `FILE_CHANGE_MAP.md` を正とする。
- `scripts/account-block-candidate-workflow.mjs` は byte-for-byte で変更せず、`scripts/verify-data.mjs` と historical generated artifacts もこの作業では変更しない。旧account import pathは通常ファイルのre-export shimとしてのみ維持する。
- ProcessingはDatabase、UI、scripts、React、`node:sqlite` に依存しない。keywordとaccountのProcessing機能間の直接依存も設けない。
- keyword handoffでは意味処理をProcessingに置き、CLIは引数処理、filesystemのread/write、標準出力、および終了処理を担当する。Processing APIにfilesystem pathを渡さない。
- UIでは `candidate-data.js` だけがgenerated JSONを読み込み、adapterはUIが使用するfieldだけをUI modelへ変換する。NEW表示判定の正はUIに置く。
- Comment DBのAPI、SQLite schema/migration、normalized payload・hash・transactionの意味、candidate評価、artifact schema/hash/serialization、CLI command/option、keyword publicationのatomicityは変更対象外とする。
- collector実装は今回追加しない。`scripts/adapters` は第5レイヤーではなく、filesystemなどの外部境界を接続する配置とする。
- 最終判定はNode `>=24 <25` の実リポジトリで `npm test`、`npm run verify:data`、`npm run build` をすべて成功させる。supplied discussion set上の既知のfixture・文書欠落によるbaseline失敗は、本issueの回帰として扱わない。
- 完了確認には `ACCEPTANCE_CRITERIA.md` と `REVIEW_CHECKLIST.md` を用いる。account shimの削除条件は `ACCOUNT_GENERATOR_PROVENANCE_EXCEPTION.md` を参照する。
