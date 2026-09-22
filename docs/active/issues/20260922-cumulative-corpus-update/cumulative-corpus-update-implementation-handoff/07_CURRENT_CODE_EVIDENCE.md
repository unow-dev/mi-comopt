# Current Code Evidence / Why These Changes Are Required

この文書はdiscussion set収録コードを基準にした実装者向け索引。行番号ではなくsymbol/挙動で探すこと。

## Corpus replacement bug

`src/application/v3/domain-services.js`

`CorpusApplicationServiceV3.update()` は現状、概ね以下でstateを作る。

```text
request.state ?? {
  snapshot_refs: requestedSnapshotRefs,
  evidence_ids: evidenceIds
}
```

`initialCorpusVersionId`は競合検知に使われるが、prior stateの`snapshot_refs`を新stateへ継承しない。

## Current unresolved count is raw-snapshot based

同ファイルの`countUnresolvedClassificationObservations()`は`readSelectedSnapshots()`でsnapshotを読み、selected snapshot内observationとclassification labelsをSQLで比較する。cumulative dedupe survivor基準ではない。

## Existing workset path reads DB-global labels

`src/database/three-class-label-repository.js`

- `readWorksetSnapshotRefs()`
- `readTargetObservations()`
- `readExistingCommentLabels()`

`scripts/adapters/three-class-workset.js`でも`readExistingCommentLabels(db)`を使用している。

このpathをv3 cumulative classificationのauthorityにしない。

## readSelectedSnapshots changes order

`src/database/raw-snapshot-repository.js`

`readSelectedSnapshots()`はselected refsをSHA/index順に扱う既存意味論がある。legacy挙動を変更せず、reference-order readerを別途追加する。

## Legacy projection sorts snapshots

`src/processing/analysis-input/raw-snapshot-projection.js`

`projectRawSnapshots()`は既存analysis semantics用。今回のfirst-win precedenceを実装するため、この関数自体の意味は変えずcumulative projectionを追加する。

## Source Dataset currently requires exactly one snapshot

`src/processing/optimicom-ui-release/source-dataset.js`

`validateLabelCompleteness()`が`selectedSnapshots.length !== 1`を拒否する。

v1 shapeは:

```text
schema_version
labeling_status
snapshot_ref
records
```

今回v2でcorpus-aware sourceへ移行する。

## Keyword adapter is single snapshot

`scripts/adapters/keyword-candidate-comment-db.js`

単一`snapshotRef`を`readSelectedSnapshots(db, [snapshotRef])`へ渡すpathがある。

## Production operator extracts one corpus snapshot

`scripts/comment-data-update-v3-operator.mjs`

`corpusSnapshotRef()`がcorpus stateから単一snapshotを取り出し、classification/keyword handoffへ`--snapshot-ref`を渡す。

cutover時に撤去必須。

## UI export requires exactly one corpus snapshot

`scripts/export-v3-optimicom-ui-release.mjs`

現状:

```text
corpus version must contain exactly one snapshot reference
```

という制約がある。

## Release materialize accepts caller artifacts

`src/application/v3/release-services.js`

現状:

```text
request.artifacts ?? artifactBuilder(...)
```

production authorityをpins由来builderに統一するため、request overrideを撤去する。

## Corpus snapshot index serialization bug

`src/application/services.js`

`typedCorpusHandler()`は現状object `snapshotRef`へ`String(snapshotRef)`を使うため`[object Object]`になる。複数ref保存時の衝突要因になる。

## Existing cutover supports freeze/fix-forward

`src/migration/v3-cutover.js`

現行stateには`smoke_verified` / `v3_frozen`があり、`smoke_failed`後は`fix_forward_v3`で戻る設計。planned recoveryもこのfail-closed思想と整合させる。
