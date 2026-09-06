# Work Task Sequence: raw snapshot拡張とデータベース起点の分析処理

## Purpose

TikTok rich raw snapshot v1をexact bytesの原本として安全に保存・Comment DB v2へ正規化し、明示指定したsnapshotから既存Stage13互換の決定的な5-field JSONとprovenance manifestを生成できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、handoffの最終仕様、契約、受入条件、採択済み事項、撤回済み事項および対象外事項を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、現在のComment DB v1実装、CLI、Stage13入力契約、依存境界およびsource baselineとの差分を確認する。
- [x] 3. raw書込み境界の実装範囲で、AIエージェントが、raw snapshot v1の検証、exact-byte原本保存、additiveなComment DB v2正規化および明示的なimport・整合性検証の経路を実現する。
- [x] 4. raw書込み境界の検証範囲で、AIエージェントまたはCIが、v1互換性、入力契約、原本の完全性、IDの扱い、観測の忠実性、DB整合性およびraw store検証を確認する。
- [x] 5. 分析読取り境界の実装範囲で、AIエージェントが、明示指定snapshotのDB読取り、SQLite非依存の5-field射影、決定的なJSON・manifest生成およびexport経路を実現する。
- [x] 6. 分析読取り境界の検証範囲で、AIエージェントまたはCIが、snapshot選択、出力の完全性、並び順とbyte決定性、raw store非依存性、Stage13互換性およびレイヤー境界を確認する。
- [x] 7. 運用文書の整備範囲で、AIエージェントが、新しいraw store・DB・CLI・プライバシー境界・分析artifactの利用方法と、後続の統合issueへ渡す責務を記録する。
- [x] 8. 受入検証の範囲で、AIエージェントまたはCIが、PR1とPR2のmerge gate、定義済みの受入条件、全自動テストおよびfixtureによるend-to-end再現性を確認する。
- [x] 9. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、変更した契約、後続issueへ引き継ぐartifactおよび残存する非scope事項を記録する。

## Work Notes

- ベースラインコミットは `3c4c4a3` (`chore: establish raw snapshot analysis baseline`)。
- `ajv` 8.x と `ajv-formats` 3.xをruntime依存へ追加し、draft 2020-12 schemaをsingle source of truthとしてvalidationした。invalid UTF-8もcanonical raw store到達前に拒否する。
- `002-raw-snapshots.sql`をadditive migrationとして追加し、既存v1 tables/import/hash/timestamp semanticsを維持した。v1 populated DBのv2移行保持もテストした。
- `import-raw-snapshot`、exact-byte content-addressed raw store、`verify-raw-store`、明示SHA指定の`export-analysis-input`およびSQLite非依存projectionを実装した。
- output JSON/manifestはSHA昇順・source index昇順・固定key順・末尾改行で決定的に生成し、Stage13のexact five-field validatorで受理されることを確認した。raw storeを削除した状態のDB-only exportも確認した。
- `npm test`（75 tests）、`npm run build`、CLI help確認が成功した。候補生成・ラベル・公開・UI・legacy merge/dedupe・raw retentionは非scopeとして変更していない。
- 後続統合issueへは `new-comments.json` と `new-comments.manifest.json` を新規側artifactとして渡し、manifestのoutput SHA/count/rangeを検証してからlegacy 5-fieldと統合する。
- 実装はPR1（raw書込み境界）を先行し、PR1のmerge gate通過後にPR2（分析読取り境界）へ進む。既存v1の`comment-db import`、semantic canonical hash、timestamp正規化および観測保持の意味を変更しない。
- 本issueの所有範囲は `rich raw -> exact-byte raw store -> Comment DB v2 -> explicit snapshot selection -> exact 5-field JSON + manifest` に限定する。既存5-field datasetとの統合、cross-snapshot dedupe、暗黙のlatest/all選択、Stage13 reference reuse、ラベル・候補生成・UI・deployは変更しない。
- raw snapshotのhashは入力ファイルのexact bytesに対するSHA-256であり、valid inputのみをcontent-addressed raw storeへ保存する。raw由来の5文字列、ID、時刻値をtrim・正規化・補完・推測しない。
- 分析出力は明示指定SHAをpayload SHA昇順、各snapshotをsource index昇順に扱い、5キーだけを含むJSONと生成時刻を含まないmanifestをbyte決定的に生成する。exportはraw storeを読まず、raw整合性確認は専用経路で扱う。
- 完了は、PR1・PR2の各merge gateと`npm test`を通過し、fixtureで `rich raw -> raw store -> SQLite -> 5-field JSON + manifest` を決定的に再現できた時点とする。
