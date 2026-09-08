# Decision log

This file records important alternatives that were explicitly rejected so they are not silently reintroduced during implementation.

## Source binding

Rejected: ask for `--snapshot-ref` again during apply.

Reason: it cannot prove the operator selected the same snapshots used during generation; a different set may produce the same unique comment ITEMS.

Rejected: put provenance into the existing v1 ZIP.

Reason: v1 has an exact five-member archive contract; changing it is a protocol/versioning change outside this MVP.

Rejected: sidecar provenance file.

Reason: introduces loss/desynchronization failure modes and is less robust than binding in the generating DB.

Adopted: DB registry, workset bound to its generating DB.

## Provenance key

Rejected after review: duplicate `payload_sha256 + snapshot_index` in registry.

Adopted: `snapshot_id`, because DB portability is intentionally not a goal and this is the smallest internal FK.

## Label persistence

Rejected: add a label column to `snapshot_comment_observations`.

Reason: raw observation state and derived classification must remain separate.

Rejected: append-only application/event history in MVP.

Reason: useful for correction/audit but materially expands the state model.

Rejected: `source_workset_id` on the current label table.

Reason: it is incomplete provenance (only the first inserting workset) and can be mistaken for an audit trail.

Adopted: current observation label only.

## Correction

Rejected: last-write-wins / UPDATE / `--allow-correction`.

Reason: loses previous value/history without a proper correction model.

Adopted: conflicting current label rejects the whole apply. Correction is future work.

## Comment consistency

Initial possibility rejected: only compare current labels on selected target observations.

Reason: the issue defines classification by exact comment, not by observation. Disjoint worksets could otherwise create different current labels for the exact same comment.

Rejected: introduce a normalized comment master table now.

Reason: stronger normalization than required for the current dataset/MVP.

Rejected: DB trigger for cross-table comment semantic consistency.

Reason: duplicates workflow preflight, complicates diagnostics, and runs cross-table checks on every insert.

Adopted: DB-wide read-only semantic conflict preflight in apply; selected snapshots remain the only write scope.

## Hashes

Rejected: workset ZIP hash, source projection hash, response semantic hash.

Reason: direct source reconstruction + ITEMS deep equality + existing validator are sufficient for the issue's write-scope safety goal. Tamper/audit hardening is not MVP scope.

## Concurrency

Rejected: long generation-time writer lock.

Reason: package/projection work is long; source is revalidated at apply time and any unsupported mutation fails closed.

Rejected: retry/backoff, lock tables, new busy-timeout policy.

Adopted: short `BEGIN IMMEDIATE` transactions and operator retry when SQLite contention causes failure.

## Legacy compatibility

Rejected: automatically apply/import old unregistered v1 worksets.

Reason: old artifacts lack sufficient generation-time snapshot provenance.

## Performance

Rejected for MVP: new comment-text label index and batched requested-comment queries.

Reason: current issue dataset is small enough for one grouped existing-label read; avoid inventing batching/index policy before it is needed.
