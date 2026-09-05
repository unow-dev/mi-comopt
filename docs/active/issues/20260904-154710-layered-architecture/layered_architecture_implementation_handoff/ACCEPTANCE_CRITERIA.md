# Acceptance Criteria

すべて満たすまでissue完了としない。

## Structure

- [x] keyword加工コードが `src/processing/keyword-candidates/` にある。
- [x] account加工実装本体が `src/processing/account-block-candidates/` にある。
- [x] Comment DBが `src/database/comment-database.js` にある。
- [x] UIコードが `src/ui/` にある。
- [x] keyword filesystem publicationが `scripts/adapters/keyword-publication.js` にある。
- [x] `src/lib/` にはaccount compatibility shim以外の実装がない。

## Dependency boundaries

- [x] ProcessingからDatabaseへのimportがない。
- [x] ProcessingからUIへのimportがない。
- [x] Processingからscriptsへのimportがない。
- [x] ProcessingからReact / `node:sqlite` へのimportがない。
- [x] keyword/account Processing feature間の直接importがない。
- [x] shared validation errorのみ双方から利用する。

## Keyword handoff

- [x] handoffの意味検証がProcessingへ移っている。
- [x] Processing handoff APIはfilesystem pathを受け取らない。
- [x] CLIがfile read/writeを担当する。
- [x] handoff error codeが既存契約から変わっていない。
- [x] handoff bundle / verificationの既存e2eテストを維持している。

## UI boundary

- [x] `candidate-data.js` だけが3つのgenerated JSONをimportする。
- [x] `candidate-data-adapter.js` はpureである。
- [x] Appはraw snake_case artifact fieldsを参照しない。
- [x] `candidateId` をReact keyに使用する。
- [x] `isNewCandidate` の正が `src/ui/new-badge.js` のみになっている。
- [x] UI adapterが未使用artifact fieldsを無条件に全コピーしていない。

## Account provenance compatibility

- [x] `src/lib/account-block-candidate-workflow.js` はre-exportだけ。
- [x] shimはsymlinkではない。
- [x] `scripts/account-block-candidate-workflow.mjs` がbyte-for-byte変更されていない。
- [x] `scripts/verify-data.mjs` を今回変更していない。
- [x] account generator SHA/provenance契約を変更していない。
- [x] `src/data/accountBlockCandidateRunManifest.json` を書き換えていない。

## Non-regression

- [x] candidate評価結果・policy semanticsが不変。
- [x] artifact schema/hash/serialization contractが不変。
- [x] Comment DB schema/migration/API behaviorが不変。
- [x] CLI command名・optionが不変。
- [x] keyword publication atomicity semanticsが不変。
- [x] generated artifactsに差分がない。

## Automated checks

実リポジトリ、Node 24で:

- [x] `npm test` green
- [x] `npm run verify:data` green
- [x] `npm run build` green
- [x] architecture boundary test green
- [x] UI adapter test green
- [x] NEW badge boundary tests green

## Documentation

- [x] `ARCHITECTURE.md` が4責務と依存規則を説明している。
- [x] READMEからarchitecture documentへ到達できる。
- [x] account shimがtemporary compatibility exceptionであることと削除条件が明記されている。
