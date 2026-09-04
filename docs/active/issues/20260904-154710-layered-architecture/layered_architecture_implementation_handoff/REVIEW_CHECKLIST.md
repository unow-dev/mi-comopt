# Review Checklist

## Immediate reject conditions

以下が1つでもあれば原則差し戻す。

- account CLI scriptに差分がある。
- `verify-data.mjs` のgenerator verification semanticsを変更している。
- committed generated JSONを再生成・手編集している。
- Comment DB API/schema/migrationをarchitecture整理のついでに変更している。
- UUID/hash/serialization方式を変更している。
- candidate評価policy/algorithmを変更している。
- keyword/account publicationを無理に共通化している。
- collectorの架空interfaceを追加している。
- 新しい汎用 `src/lib` / `utils` を作っている。
- account shimにre-export以外のコードを置いている。
- UI adapterがartifact全schemaをそのまま写しているだけになっている。
- 既存CLI/e2eテストをunit testで置き換えて削除している。

## Architecture review

- Processingが外側の実装詳細を知らないか。
- handoff Processing APIへpathや`fs` objectが漏れていないか。
- UIがraw JSONではなくUI modelを使っているか。
- Database移動がComment DBの挙動変更に化けていないか。
- `scripts/adapters` が業務判断の置き場になっていないか。

## Diff review

- 移動主体のファイルで不要なformat/rename差分を大量に出していないか。
- generated dataに差分がないか。
- account CLI SHAが変更前後で一致するか。
- CLI help / command / optionに差分がないか。
- package dependencyを増やしていないか。

## Tests

- architecture testが禁止importを実際に検出できるか。
- adapter testがsnake_case -> UI model変換を検証するか。
- adapterが未使用fieldを漏らさないことをテストするか。
- NEW badgeの5境界ケースがUI moduleを直接テストするか。
- handoff既存e2e regressionを維持しているか。
