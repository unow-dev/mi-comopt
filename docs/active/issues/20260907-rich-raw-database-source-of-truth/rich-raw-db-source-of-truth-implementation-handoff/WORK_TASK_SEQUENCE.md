# Work Task Sequence: rich raw DB source of truth implementation

## Purpose

rich raw入力のexact bytesをComment DB内の唯一のsource of truthとして保持し、複数snapshotの正規化済みmaterialization、既存の5-field分析入力、および安全なv2からv3への移行を両立した状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、凍結済み実装仕様、API・CLI契約、受入条件、対象外事項、および文書間の優先順位を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、Comment DB v2のmigration・raw取込み・repository・分析projection・CLI・テストの現状と変更境界を確認する。
- [x] 3. スキーマ移行の実装範囲で、AIエージェントが、既存の正規化済みデータを保持しつつ、exact bytesを完全に検証してv3へ移行できる経路を実現する。
- [x] 4. スキーマ移行の検証範囲で、AIエージェントまたはCIが、空のv2 DBの自動移行、正常なbackfill、失敗時のfail-closed動作、競合検知、および既存ID・値の保持を確認する。
- [x] 5. rich raw書込み境界の実装範囲で、AIエージェントが、collector非依存のraw input取込み、複数snapshotのmaterialization、原子的保存、および不変な重複判定を実現する。
- [x] 6. rich raw書込み境界の検証範囲で、AIエージェントまたはCIが、exact-byte完全性、DTO検証、ID・観測順序、重複・競合、複数snapshot、およびロールバックを確認する。
- [x] 7. 既存raw snapshot互換性の実装範囲で、AIエージェントが、既存TikTok single-snapshot入力を新しい書込み境界へ接続し、正規化専用importを変更せずに通常運用のfilesystem raw store依存を除去する。
- [x] 8. 読取りとprovenanceの実装範囲で、AIエージェントが、DB内raw bytesの読取り、raw inputとsnapshotを区別する選択・整列・検証、およびDB起点の分析入力生成を実現する。
- [x] 9. 読取りとprovenanceの検証範囲で、AIエージェントまたはCIが、rich-only情報の復元、snapshot参照、決定的な順序、DBのみでの操作、5-field出力契約、およびレイヤー境界を確認する。
- [x] 10. CLIと運用経路の実装範囲で、AIエージェントが、rich raw取込み、legacy raw backfill、snapshot選択、およびDB内raw整合性検証の契約を実現する。
- [x] 11. CLIと運用経路の検証範囲で、AIエージェントまたはCIが、引数検証、legacy selectorの曖昧性拒否、終了コード、正常系・失敗系、および廃止したfilesystem raw store経路が通常操作に残らないことを確認する。
- [x] 12. 全体回帰と受入検証の範囲で、AIエージェントまたはCIが、必須テスト、既存の正規化import回帰、package全体のテスト、および受入条件・reject条件の全項目を確認する。
- [ ] 13. 移行適用判断の範囲で、人間が、コピーしたv2 DBとlegacy raw rootでのbackfill結果、復旧可能性、および実運用DBへ適用する可否を判断する。
- [x] 14. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、移行適用判断、残存する運用上の注意点、および対象外のcollector adapter作業を記録する。

## Work Notes

- `98d26f2` に作業開始前のベースラインを記録した。
- v3 migration、SQLite BLOBを正本とする汎用rich raw import、multi-snapshot provenance、DB-only raw read/verify、snapshot-ref CLI、およびlegacy backfillを実装した。normalized-only import、5-field projection、collector固有wrapper parser非導入は維持した。
- `npm test` は81件すべて成功した。コピーしたv2 DBとlegacy raw rootを用いたbackfillの実装テスト、失敗時のv2維持、DB-only read/verify、CLI選択と終了コードを確認した。
- 実運用DBへのbackfill適用可否、復旧可能性、保持方針は人間の判断待ちであり、本実装では実運用DBを変更していない。collector adapterの追加も対象外のままとした。
- v3ではSQLite BLOBに保存した入力のexact bytesとそのSHA-256がrich rawの正本である。`raw_inputs`を親、`raw_snapshots`をderivedな子materializationとし、snapshotのportable identityは`(payload_sha256, snapshot_index)`、コメントの順序は既存どおり`(snapshot_id, source_index)`とする。
- populated v2 DBは、検証済みlegacy raw filesを使う明示的backfillなしにv3へ移行してはならない。prepare中のfilesystem検証は長時間のSQLite write lockの外で行い、移行開始後にv2 source setの変更を検知した場合を含め、失敗時には永続DBをv2のまま残す。
- genericなDatabase境界はraw bytes、wire-format identifier、およびcollector非依存DTOだけを扱う。DatabaseまたはProcessingに`new-comments.json`などcollector固有wrapperのparserを追加しない。既存のTikTok single-snapshot parser/validatorは互換adapterとしてのみ利用する。
- 同一bytesの再取込みは、raw bytes・format・materializationすべての整合性を照合してからno-opにできる。異なるmaterializationやDB破損を通常の再取込みで修復・上書きしてはならない。
- 通常のrich raw取込み・読取り・検証はfilesystem raw rootに依存しない。legacy filesystemはv2 backfillの入力に限定し、`raw_relpath`と`raw_schema_version`をv3の通常read pathへ残さない。normalized-onlyの`import`契約は変更しない。
- 分析のrecord内容は`username`、`handle`、`comment`、`postedAt`、`postedDate`の5フィールドと既存の順序を維持する。`ANALYSIS_PROJECTION_VERSION`は`1.0.0`のままとし、manifest schemaを2、database schemaを3へ更新する。
- canonicalなCLI snapshot selectorは`--snapshot-ref <64桁lowercase SHA>:<非負整数index>`とする。`--snapshot-sha`を残す場合は子snapshotが1件だけのlegacy互換aliasとし、`import-raw-snapshot`と`verify-raw-inputs`の通常経路に`--raw-root`を残さない。
- 最終受入では、正常・異常migration、exact-byte BLOB、multi-snapshot原子性、duplicate conflict、raw read、DB-only export、CLI選択、architecture guardを含む必須試験に加え、`npm test`を実行する。実運用DBへのbackfillは、人間がコピーDBでの結果を確認してから判断する。
