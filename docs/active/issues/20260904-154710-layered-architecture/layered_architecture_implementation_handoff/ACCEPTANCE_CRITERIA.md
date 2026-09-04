# Acceptance Criteria

すべて満たすまでissue完了としない。

## Structure

- [ ] keyword加工コードが `src/processing/keyword-candidates/` にある。
- [ ] account加工実装本体が `src/processing/account-block-candidates/` にある。
- [ ] Comment DBが `src/database/comment-database.js` にある。
- [ ] UIコードが `src/ui/` にある。
- [ ] keyword filesystem publicationが `scripts/adapters/keyword-publication.js` にある。
- [ ] `src/lib/` にはaccount compatibility shim以外の実装がない。

## Dependency boundaries

- [ ] ProcessingからDatabaseへのimportがない。
- [ ] ProcessingからUIへのimportがない。
- [ ] Processingからscriptsへのimportがない。
- [ ] ProcessingからReact / `node:sqlite` へのimportがない。
- [ ] keyword/account Processing feature間の直接importがない。
- [ ] shared validation errorのみ双方から利用する。

## Keyword handoff

- [ ] handoffの意味検証がProcessingへ移っている。
- [ ] Processing handoff APIはfilesystem pathを受け取らない。
- [ ] CLIがfile read/writeを担当する。
- [ ] handoff error codeが既存契約から変わっていない。
- [ ] handoff bundle / verificationの既存e2eテストを維持している。

## UI boundary

- [ ] `candidate-data.js` だけが3つのgenerated JSONをimportする。
- [ ] `candidate-data-adapter.js` はpureである。
- [ ] Appはraw snake_case artifact fieldsを参照しない。
- [ ] `candidateId` をReact keyに使用する。
- [ ] `isNewCandidate` の正が `src/ui/new-badge.js` のみになっている。
- [ ] UI adapterが未使用artifact fieldsを無条件に全コピーしていない。

## Account provenance compatibility

- [ ] `src/lib/account-block-candidate-workflow.js` はre-exportだけ。
- [ ] shimはsymlinkではない。
- [ ] `scripts/account-block-candidate-workflow.mjs` がbyte-for-byte変更されていない。
- [ ] `scripts/verify-data.mjs` を今回変更していない。
- [ ] account generator SHA/provenance契約を変更していない。
- [ ] `src/data/accountBlockCandidateRunManifest.json` を書き換えていない。

## Non-regression

- [ ] candidate評価結果・policy semanticsが不変。
- [ ] artifact schema/hash/serialization contractが不変。
- [ ] Comment DB schema/migration/API behaviorが不変。
- [ ] CLI command名・optionが不変。
- [ ] keyword publication atomicity semanticsが不変。
- [ ] generated artifactsに差分がない。

## Automated checks

実リポジトリ、Node 24で:

- [ ] `npm test` green
- [ ] `npm run verify:data` green
- [ ] `npm run build` green
- [ ] architecture boundary test green
- [ ] UI adapter test green
- [ ] NEW badge boundary tests green

## Documentation

- [ ] `ARCHITECTURE.md` が4責務と依存規則を説明している。
- [ ] READMEからarchitecture documentへ到達できる。
- [ ] account shimがtemporary compatibility exceptionであることと削除条件が明記されている。
