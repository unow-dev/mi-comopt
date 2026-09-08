# Source paths used by this handoff

The supplied discussion-set ZIP contains the repository snapshot used to ground this handoff. Relevant paths, relative to its `sources/package/` root:

- `package.json`
- `db/comment-database/001-init.sql`
- `db/comment-database/002-raw-snapshots.sql`
- `db/comment-database/003-rich-raw-inputs.sql`
- `db/comment-database/004-nullable-rich-metadata.sql`
- `db/comment-database/005-comment-batch-materialization.sql`
- `src/database/comment-database.js`
- `src/database/raw-snapshot-repository.js`
- `src/processing/analysis-input/raw-snapshot-projection.js`
- `src/three-class-workset/protocol.js`
- `scripts/adapters/three-class-workset.js`
- `scripts/comment-database.mjs`
- `scripts/pack-three-class-workset.py`
- `templates/three-class-workset/PROMPT.md`
- `templates/three-class-workset/RULES.md`
- `templates/three-class-workset/response.schema.template.json`
- `tests/three-class-workset.test.js`
- `tests/raw-snapshot-database.test.js`
- `tests/raw-snapshot-analysis-input.test.js`

Key observed implementation facts:

- current application DB schema version is 5
- current analysis manifest DB schema version constant is 5
- projection version is `1.0.0`, manifest schema version is 3
- current generator performs exact-string first-occurrence comment dedupe inline
- `readSelectedSnapshots()` rejects empty/duplicate selection, verifies snapshot/observation integrity, and returns `snapshot.snapshotId`
- current packager creates the final output with a hard link and then reads it back, so post-link failure ownership cleanup belongs inside the packager
- current CLI runtime errors use exit code 1 and CLI argument errors use exit code 2
