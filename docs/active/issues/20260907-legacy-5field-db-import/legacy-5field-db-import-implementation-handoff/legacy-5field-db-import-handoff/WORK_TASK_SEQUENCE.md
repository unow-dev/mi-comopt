# Work Task Sequence: legacy 5-field DB import implementation

## Purpose

旧5-field raw JSONを値の推測・補完なしに厳格なcollector input契約で受け入れ、現行のgeneric raw input経路からComment DBへ原子的・冪等に保存し、既存の分析処理で入力順・重複を保持したexact five-field recordsとして利用できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、凍結済み実装仕様、受入条件、拒否条件、対象外事項、および文書間の参照関係を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、Comment DB v4のmigration・generic DTO検証・保存・読取り・検証・分析projection・CLI・テストの現状と変更境界を確認する。
- [x] 3. Collector入力境界の実装範囲で、AIエージェントが、厳格なversioned comment-batch入力契約、exact bytesを保持する副作用のないDTO変換、およびrich DTOの明示的なdiscriminatorを実現する。
- [x] 4. Collector入力境界の検証範囲で、AIエージェントまたはCIが、UTF-8・JSON・5-field shape・空配列・空文字・opaque日時・順序・重複・入力bytes・rich DTO回帰を確認する。
- [x] 5. スキーマ移行の実装範囲で、AIエージェントが、rich-snapshotとcomment-batchを区別して保存でき、未知のmetadataをSQL NULLで表現するComment DB v5への安全な移行を実現する。
- [x] 6. スキーマ移行の検証範囲で、AIエージェントまたはCIが、v4からv5への既存データ・ID・provenance・外部キー・indexの保持、rich-snapshotへの移行、および新しすぎるDBのfail-closed動作を確認する。
- [x] 7. generic DTOと保存境界の実装範囲で、AIエージェントが、strict discriminated unionの検証、kind別のmaterialization、入力順と重複を保つcomment-batch observation保存、およびrich保存動作の維持を実現する。
- [x] 8. 保存境界の検証範囲で、AIエージェントまたはCIが、exact-byte保存、metadataのNULL表現、video・master identityの非生成、loaded count、source index、原子性、再取込み、およびraw input競合を確認する。
- [x] 9. repository整合性の実装範囲で、AIエージェントが、kind固有の内部照合、source indexの連続性確認、read/verify時の整合性検証、およびProcessingへ形式固有情報を漏らさない読取り境界を実現する。
- [x] 10. repository整合性の検証範囲で、AIエージェントまたはCIが、kindとcomment row shapeの一致、video observation数、source-index破損、外部キー破損、および再取込み比較による破損検出を確認する。
- [x] 11. CLIと分析出力の実装範囲で、AIエージェントが、comment-batchの明示的な取込み経路、既存のsnapshot選択契約、同一projectionへの接続、およびnullable provenanceを扱うmanifest契約を実現する。
- [x] 12. CLIと分析出力の検証範囲で、AIエージェントまたはCIが、引数・読取り・validation error・取込み・再取込み、richとbatchの混在選択、5-field出力、manifestの互換性、および決定的な並び順を確認する。
- [x] 13. アーキテクチャと文書の整備範囲で、AIエージェントが、Collector固有処理をDatabase/Processingから分離する境界、利用方法、およびDB v5の契約を記録する。
- [x] 14. 全体回帰と受入検証の範囲で、AIエージェントまたはCIが、必須test matrix、既存rich経路の回帰、architecture boundary、およびpackage全体のテストを確認する。
- [x] 15. private実データ受入の範囲で、AIエージェントまたはCIが、24,622件の厳格な検証、取込み・exportの全件五値一致、順序・重複・idempotency、およびbatch由来master row非生成を確認する。
- [x] 16. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、private実データの確認結果、残存する運用上の注意点、および仕様再オープンの要否を記録する。

## Work Notes

- 実装契約の正本は `HANDOFF.md` とし、具体的な作業順序・完了条件は `IMPLEMENTATION_CHECKLIST.md`、必須検証は `TEST_MATRIX.md`、採択理由は `DECISIONS.md` を参照する。
- 入力formatは `tiktokCommentBatch-1.0.0`、generic DTO discriminatorは必須の `materializationKind`、kindは `rich-snapshot` と `comment-batch` に固定する。Databaseは `inputFormat` ではなくkindで保存戦略を分岐する。
- 旧5-field値はtrim、Unicode正規化、日時解析、欠損補完、dedupeを行わない。存在しないrich metadata、video、master identityは捏造せず、定められた保存境界でSQL NULLとして表現する。
- comment-batchは1 raw inputを1 materializationとして保存し、`source_index`は入力arrayのindexとする。空配列も有効な1 materializationである。
- 分析recordの5-field契約と `ANALYSIS_PROJECTION_VERSION = "1.0.0"` は維持する。Comment DB schema versionは5、analysis manifest schema versionは3とし、manifestへmaterialization kindを追加しない。
- private実データはrepositoryへ追加せず、検証にのみ利用する。仕様を再オープンできるのは、実データが契約に適合しない具体例が見つかった場合、またはrich回帰を維持したv5実装が具体的に不可能と示された場合に限る。
- ベースラインコミットは `0952e78`（`chore: baseline legacy 5-field import handoff`）。
- `package/tests/comment-batch.test.js` を追加し、contract、adapter、exact-byte round-trip、NULL、master非生成、idempotency、CLI、analysis projection、source-index/kind破損を確認した。
- `npm test` は97件すべて通過。private実データはrepositoryへ追加せず、workspace外保存方針の入力を指定して受入検証を実施した。
- private入力 `work/20260826/current_raw.json` は厳格契約を通過し、payload SHAは `98b1a2d6ca08fe61b8b821d4498e8bab8683d4cf0c4ac0843cb5b89f7a014c7c`。取込みは24,622 observations、exportも24,622 recordsだった。
- 入力とexportは全件で5値・順序・重複数が一致し、manifestはschema 3、batch由来video observationは0、comment master linkは0、再取込みは`already imported`だった。
- 残存する運用上の注意点は、既定DBがworkspace内の既存rich inputsと共存していること。今回のbatchは既存rich masterを参照・変更していない。仕様再オープン条件に該当する反例はない。
