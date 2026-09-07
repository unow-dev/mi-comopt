# Work Task Sequence: `new-comments.json` DTO adapter implementation

## Purpose

`new-comments.json` wrapperのexact bytesを保持したまま、Collector側で厳格に検証してgeneric raw input DTO列へ変換し、既存のrich raw database取込みへ原子的に接続できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、設計完了済みhandoffの採択事項、受入条件、拒否条件、対象外事項、および文書間の優先順位を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、現行のgeneric DTO検証・Comment DB v3 migration・read path・legacy raw adapter・更新フロー・テストの変更境界を確認する。
- [x] 3. generic DTOとDBの実装範囲で、AIエージェントが、実wrapperで正当にnullとなる7項目だけを表現できるv4移行、検証、および読取り経路を実現する。
- [x] 4. generic DTOとDBの検証範囲で、AIエージェントまたはCIが、v3からv4への値・外部キー保持、7項目のnull round-trip、nullと0の区別、およびlegacy入力契約の不変性を確認する。
- [x] 5. Collector入力境界の実装範囲で、AIエージェントが、versionedかつ厳格な`new-comments.json` wrapper契約、完全wrapperの検証、および副作用のないDTO変換を実現する。
- [x] 6. Collector入力境界の検証範囲で、AIエージェントまたはCIが、UTF-8・JSON・shape・件数・video IDの拒否条件、source順序、ID投影、null値、および入力bytesの不変性を確認する。
- [x] 7. 更新フロー接続の実装範囲で、AIエージェントが、wrapper adapterの出力を1回のgeneric `importRawInput`へ渡し、DatabaseおよびProcessingをwrapper形式から独立させる経路を実現する。
- [x] 8. 更新フロー接続の検証範囲で、AIエージェントまたはCIが、複数snapshotの原子的取込み、raw bytes保存、snapshot/commentのsource順序、失敗時の非部分反映、および分析入力projectionとの接続を確認する。
- [x] 9. 実データ受入検証の範囲で、AIエージェントまたはCIが、非コミットのlocal `new-comments.json`に対するSHA-256、8 snapshot、2,677 comment、null metadata、およびexact-byte復元を確認する。
- [x] 10. 全体回帰と受入検証の範囲で、AIエージェントまたはCIが、代表・異常fixture、migration、architecture guard、package必須チェック、および全受入条件・reject条件を確認する。
- [x] 11. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、schema version・入力契約の変更、残存する運用上の注意点、および対象外事項を記録する。

## Work Notes

- 正本は `README.md`、`DECISIONS.md`、`DATABASE_CHANGES.md`、`MAPPING_MATRIX.md`、`IMPLEMENTATION_PLAN.md`、`TEST_PLAN.md`、`ACCEPTANCE_CRITERIA.md`、`REVIEW_CHECKLIST.md` の順で参照する。詳細な対応規則はhandoffの各文書を優先し、本sequenceで再定義しない。
- adapterの入力形式は厳密に `tiktokNewCommentsWrapper-1.0.0` とする。embedded versionの推測やlegacy `tiktokRawSnapshot-1.0.0`との自動判別は行わない。
- wrapper固有のparse・validate・mapはCollector/composition-rootに閉じ込める。DatabaseとProcessingはgeneric `{ payloadBytes, inputFormat, snapshots }` のみを扱い、wrapper固有の依存を追加しない。
- 元wrapper bytesは一度だけ読み込み、再シリアライズせずに`payloadBytes`へ渡す。全itemの検証・変換が成功してから、`importRawInput`を一度だけ呼び出す。
- null許容を広げる対象は `reportedCount`、`video.duration`、およびvideo統計5項目の計7項目に限定する。source値を`0`や空文字へ補完・trim・正規化・日時変換してはならない。
- 実データはlocal verification専用であり、repositoryのfixture・成果物・ログへ取り込まない。期待SHA-256は `77a679587ce091207ccf8654213a9d454cd5af50849d10ebd8186a4dba440ee9` とする。
- 現在のworking treeには本issueと独立した未コミット変更があるため、実装時はそれらを変更・破棄せず、変更範囲と検証結果を分離して記録する。
- ベースラインコミットは `1c7e99c`（`chore: record baseline before new comments adapter`）。
- Comment DBはschema version 4へ移行し、`004-nullable-rich-metadata.sql`で7項目だけをSQL NULL許容化した。legacy `tiktokRawSnapshot-1.0.0` contractは不変である。
- `package/src/collector/new-comments-wrapper/`にstrict contractとpure DTO adapter、`package/scripts/adapters/new-comments-wrapper.js`に明示的なCLI接続を追加した。CLIは`import-new-comments`（および明示alias `import-new-comments-wrapper`）を使用する。
- 検証結果: package test 90件成功、real fileはSHA一致・8 snapshot・2,677 comment・null metadata 4件・exact-byte復元・foreign-key違反0件。real file自体はcommitしていない。
- `npm run build`は成功済み。legacy merge/dedupe、Stage13生成、production backfill、real raw fileのrepository取り込みは対象外である。
