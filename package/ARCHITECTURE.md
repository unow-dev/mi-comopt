# Architecture

このpackageは、データの流れに沿ってCollector、Database、Processing、UIの4責務を分離する。

## 責務

- Collectorは外部サービスからデータを収集し、collector固有形式を後段のgeneric inputへ変換する。`src/collector/new-comments-wrapper/` は `tiktokNewCommentsWrapper-1.0.0` の検証・rich DTO変換を、`src/collector/comment-batch/` は `tiktokCommentBatch-1.0.0` の厳格な5-field検証・comment-batch DTO変換を担当する。
- Databaseはgeneric `{ payloadBytes, inputFormat, snapshots }` の保存、migration、transaction、およびComment DB APIを担当する。保存戦略はcollectorの`inputFormat`ではなく、各snapshotの`materializationKind`（`rich-snapshot`または`comment-batch`）で決まる。
- Processingは候補の検証・評価・artifact生成などの意味処理を担当する。具体的なDatabase、UI、filesystem、CLI、React、`node:sqlite`へ依存しない。
- UIはgenerated artifactを`candidate-data.js`で読み込み、`candidate-data-adapter.js`でUI modelへ変換して表示する。

`scripts/adapters/` は第5レイヤーではない。CLIやcomposition rootからfilesystemなどの外部境界へ接続するための実装置き場であり、keyword publicationのatomicityはここで扱う。

## 依存規則

`src/processing/**` はDatabase、UI、scripts、React、`node:sqlite`をimportしない。keyword Processingとaccount Processingも直接importせず、共通のvalidation errorだけを`processing/shared/`から利用する。

Comment DBは`src/database/comment-database.js`が境界となる。Collector固有parsingはDatabaseやProcessingへ混ぜず、Collector側adapterでgeneric `{ payloadBytes, inputFormat, snapshots }` に変換する。Databaseのstrict DTO unionはdiscriminatorを省略せず、richとbatchで保存境界を分ける。

`comment-batch`は動画・作者・コメントmasterを推測して生成せず、取得不能なrich metadataをSQL `NULL`で保持する。各コメント観測の`source_index`は入力array indexであり、入力順と重複を保持する。Processingへはkindを漏らさず、両kindとも同じexact five-field projectionへ渡す。

UIのgenerated JSON importは`src/ui/candidate-data.js`に限定する。adapterはAppが利用するfieldだけをcamelCaseのUI modelへ変換し、artifact schema全体を公開しない。NEW表示判定の正は`src/ui/new-badge.js`に置く。

## account legacy shim

`src/lib/account-block-candidate-workflow.js` は、account generatorのhistorical provenanceを維持するために残す通常のre-export shimである。`scripts/account-block-candidate-workflow.mjs`のbyte列と`src/data/accountBlockCandidateRunManifest.json`のgenerator SHAに結び付いているため、今回CLIのimportを変更しない。

account generator identity/provenanceをentrypoint script単体SHAへの強い結合から再設計する別issueが完了した後に、CLI importの更新とshim削除を行う。
