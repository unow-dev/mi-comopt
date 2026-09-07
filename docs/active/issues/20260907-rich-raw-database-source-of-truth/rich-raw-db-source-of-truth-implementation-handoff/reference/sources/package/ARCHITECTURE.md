# Architecture

このpackageは、データの流れに沿ってCollector、Database、Processing、UIの4責務を分離する。

## 責務

- Collectorは外部サービスからデータを収集し、collector固有形式を後段のnormalized inputへ変換する。今回この実装は追加しない。
- Databaseはnormalized comment payloadの保存、migration、transaction、およびComment DB APIを担当する。
- Processingは候補の検証・評価・artifact生成などの意味処理を担当する。具体的なDatabase、UI、filesystem、CLI、React、`node:sqlite`へ依存しない。
- UIはgenerated artifactを`candidate-data.js`で読み込み、`candidate-data-adapter.js`でUI modelへ変換して表示する。

`scripts/adapters/` は第5レイヤーではない。CLIやcomposition rootからfilesystemなどの外部境界へ接続するための実装置き場であり、keyword publicationのatomicityはここで扱う。

## 依存規則

`src/processing/**` はDatabase、UI、scripts、React、`node:sqlite`をimportしない。keyword Processingとaccount Processingも直接importせず、共通のvalidation errorだけを`processing/shared/`から利用する。

Comment DBは`src/database/comment-database.js`が境界となる。Collector固有parsingはDatabaseやProcessingへ混ぜず、将来のcollector側adapterでnormalized payloadに変換する。

UIのgenerated JSON importは`src/ui/candidate-data.js`に限定する。adapterはAppが利用するfieldだけをcamelCaseのUI modelへ変換し、artifact schema全体を公開しない。NEW表示判定の正は`src/ui/new-badge.js`に置く。

## account legacy shim

`src/lib/account-block-candidate-workflow.js` は、account generatorのhistorical provenanceを維持するために残す通常のre-export shimである。`scripts/account-block-candidate-workflow.mjs`のbyte列と`src/data/accountBlockCandidateRunManifest.json`のgenerator SHAに結び付いているため、今回CLIのimportを変更しない。

account generator identity/provenanceをentrypoint script単体SHAへの強い結合から再設計する別issueが完了した後に、CLI importの更新とshim削除を行う。
