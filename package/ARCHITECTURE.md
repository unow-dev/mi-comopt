# Architecture

このpackageは、データの流れに沿ってCollector、Database、Processing、UIの4責務を分離する。

## 責務

- Collectorは外部サービスからデータを収集し、collector固有形式を後段のgeneric inputへ変換する。`src/collector/new-comments-wrapper/` は `tiktokNewCommentsWrapper-1.0.0` の検証・rich DTO変換を、`src/collector/comment-batch/` は `tiktokCommentBatch-1.0.0` の厳格な5-field検証・comment-batch DTO変換を担当する。
- Databaseはgeneric `{ payloadBytes, inputFormat, snapshots }` の保存、migration、transaction、およびComment DB APIを担当する。保存戦略はcollectorの`inputFormat`ではなく、各snapshotの`materializationKind`（`rich-snapshot`または`comment-batch`）で決まる。
- Processingは候補の検証・評価・artifact生成などの意味処理を担当する。具体的なDatabase、UI、filesystem、CLI、React、`node:sqlite`へ依存しない。
- UIは`release-client.js`でrelease rootを起点に公開artifactを検証付きで遅延読み込みし、同一page lifetimeのreleaseを固定して表示する。`App.jsx`は検証済みartifactをread-onlyで表示し、成功したartifactはmemory cacheを再利用する。
- `candidate-data.js`と`candidate-data-adapter.js`は既存packageテストおよびlegacy static dataとの互換性のために残る旧境界であり、新UIのruntime entrypointからは参照しない。

`scripts/adapters/` は第5レイヤーではない。CLIやcomposition rootからfilesystemなどの外部境界へ接続するための実装置き場であり、keyword publicationのatomicityはここで扱う。

## 依存規則

`src/processing/**` はDatabase、UI、scripts、React、`node:sqlite`をimportしない。keyword Processingとaccount Processingも直接importせず、共通のvalidation errorだけを`processing/shared/`から利用する。

Comment DBは`src/database/comment-database.js`が境界となる。Collector固有parsingはDatabaseやProcessingへ混ぜず、Collector側adapterでgeneric `{ payloadBytes, inputFormat, snapshots }` に変換する。Databaseのstrict DTO unionはdiscriminatorを省略せず、richとbatchで保存境界を分ける。

`comment-batch`は動画・作者・コメントmasterを推測して生成せず、取得不能なrich metadataをSQL `NULL`で保持する。各コメント観測の`source_index`は入力array indexであり、入力順と重複を保持する。Processingへはkindを漏らさず、両kindとも同じexact five-field projectionへ渡す。

legacy generated JSONのimportは`src/ui/candidate-data.js`に限定する。新UIのruntime data loadingは`src/ui/release-client.js`に限定し、release rootのsource/policy/artifact SHA、件数、artifact shapeを検証する。新UIはartifactのsnake_case契約を直接表示へ利用するが、未検証のデータを受け取らない。NEW表示判定の正は`src/ui/data-model.js`に置く。

## account legacy shim

`src/lib/account-block-candidate-workflow.js` は、account generatorのhistorical provenanceを維持するために残す通常のre-export shimである。`scripts/account-block-candidate-workflow.mjs`のbyte列と`src/data/accountBlockCandidateRunManifest.json`のgenerator SHAに結び付いているため、今回CLIのimportを変更しない。

account generator identity/provenanceをentrypoint script単体SHAへの強い結合から再設計する別issueが完了した後に、CLI importの更新とshim削除を行う。
