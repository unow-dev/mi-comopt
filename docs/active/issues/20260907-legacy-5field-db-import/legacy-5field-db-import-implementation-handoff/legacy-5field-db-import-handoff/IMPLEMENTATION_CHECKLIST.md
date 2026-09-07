# Implementation Checklist

## 推奨実装順

### Phase 1 — Contract / adapters

- [x] `contracts/collector-inputs/tiktokCommentBatch-1.0.0.schema.json` 新規
- [x] `src/collector/comment-batch/comment-batch-contract.js` 新規
- [x] `src/collector/comment-batch/comment-batch-adapter.js` 新規
- [x] comment-batch contract unit tests
- [x] comment-batch adapter unit tests
- [x] `src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js` に `materializationKind: "rich-snapshot"`
- [x] `src/database/comment-database.js::mapTikTokSnapshotToDto()` に同field

Gate: invalid inputはDB open/write前にreject。rich adaptersの既存value mappingは不変。

### Phase 2 — DB v5 / generic union

- [x] `APPLICATION_SCHEMA_VERSION = 5`
- [x] `005-comment-batch-materialization.sql`
- [x] `raw_snapshots.materialization_kind`
- [x] kind-specific NULL/NOT NULL CHECK
- [x] `loaded_count >= 0`
- [x] rich-only comment six fields nullable + all-or-none CHECK
- [x] v4 rowsを`rich-snapshot`としてcopy
- [x] v4→v5 populated migration regression
- [x] `validateSnapshotDto()`をstrict kind dispatchへ変更
- [x] comment-batch DTO validator
- [x] rich validator behaviorを維持

Gate: rich-only test fixtureをv5へimportして既存意味が変わらない。

### Phase 3 — Persistence / idempotency

- [x] `insertRawInputMaterialization()` kind dispatch
- [x] comment-batch snapshot metadataをNULLでinsert
- [x] batchではvideo observationをinsertしない
- [x] batchではvideo/author/comment mastersを作らない
- [x] batch commentsを`source_index = array index`でinsert
- [x] `materializationForDto()`にkind + sourceIndex
- [x] `materializationForDatabase()`にkind + sourceIndex、nullable conversion修正
- [x] `assertSameMaterialization()`からrich-only `actual.video === null`拒否を除去
- [x] exact-byte reimport tests
- [x] materialization conflict tests
- [x] transaction rollback tests

Gate: duplicate recordsを含むbatchが完全にround-tripし、master row数を増やさない。

### Phase 4 — Repository integrity

- [x] internal selected/verification queryで`materialization_kind`を取得
- [x] public `toPlainSnapshot()`にはkindを追加しない
- [x] normal readで`source_index === 0..N-1`検証
- [x] verify: batch video count 0 / rich 1
- [x] verify: parent kindとcomment row shape一致
- [x] verify: source-index gap検出

Gate:人工corruptionが`DATABASE_INTEGRITY_ERROR`になる。

### Phase 5 — CLI / E2E

- [x] `scripts/adapters/comment-batch.js`
- [x] `import-comment-batch` usage / parser / dispatch
- [x] CLI invalid file / invalid schema test
- [x] CLI import + reimport test
- [x] CLI → analysis export E2E

Gate: 1 raw input / 1 snapshot / ordered observationsとしてCLIから利用可能。

### Phase 6 — Processing / manifest

- [x] `DATABASE_SCHEMA_VERSION = 5`
- [x] `ANALYSIS_MANIFEST_SCHEMA_VERSION = 3`
- [x] `ANALYSIS_PROJECTION_VERSION = "1.0.0"`維持
- [x] manifestにmaterialization kindを追加しない
- [x] nullable provenance manifest fixture/test
- [x] rich+batch mixed selection test

Gate: output 5-field JSON contractは従来どおり。

### Phase 7 — Architecture / docs

- [x] `ARCHITECTURE.md`
- [x] `docs/comment-database.md`
- [x] architecture-boundaries test強化
- [x] `npm test`全通過

### Phase 8 — Private data acceptance

Repository外の実データで実行:

- [ ] strict schemaを通る
- [ ] expected count = 24,622
- [ ] import count = 24,622
- [ ] export count = 24,622
- [ ] input[i] と export[i] の5値が全件一致
- [ ] duplicate multiplicity一致
- [ ] source order一致
- [ ] reimportが`already-imported`
- [ ] video/author/comment masterにbatch由来の新規rowなし

失敗時はschemaを緩めず、反例をissueへ戻す。

---

## ファイル変更マップ

### 新規

```text
contracts/collector-inputs/tiktokCommentBatch-1.0.0.schema.json
src/collector/comment-batch/comment-batch-contract.js
src/collector/comment-batch/comment-batch-adapter.js
scripts/adapters/comment-batch.js
db/comment-database/005-comment-batch-materialization.sql
```

新規testは既存構成に合わせ、`tests/comment-batch.test.js`を1本追加するのを推奨。

### 変更

```text
src/database/comment-database.js
src/database/raw-snapshot-repository.js
src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js
src/processing/analysis-input/raw-snapshot-projection.js
scripts/comment-database.mjs
ARCHITECTURE.md
docs/comment-database.md
tests/raw-snapshot-database.test.js
tests/new-comments-wrapper.test.js
tests/raw-snapshot-analysis-input.test.js
tests/architecture-boundaries.test.js
```

`src/database/comment-database.js`内のsingle raw snapshot adapter (`mapTikTokSnapshotToDto`) もrich discriminator追加のため変更対象。

---

## PR分割

推奨は2 PRまで。

### PR 1: contract preparation

- new comment-batch schema/contract/adapter + unit tests
- rich DTO producersへdiscriminator追加
- generic validatorがまだ未対応なら、PR 1単独mergeでproduction pathを壊さない構成にすること。難しければPR 1/2を分けず1 PRにまとめる。

### PR 2: DB v5 + importer + repository + CLI + Processing + E2E

DB schemaだけを先行mergeしない。
