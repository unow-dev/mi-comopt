# Implementation plan

Implement in this order so each change is independently reviewable.

## Step 1 — Generic nullability support

1. Add migration 004 and schema-version constants.
2. Narrowly relax the seven DTO fields.
3. Fix every DB read path so SQL NULL stays JS `null`.
4. Add migration/round-trip tests before adding the new wrapper adapter.

Gate: existing test suite remains green; new null round-trip tests are green; legacy raw snapshot validation remains strict/non-null.

## Step 2 — Wrapper V1 contract

Suggested files:

```text
package/contracts/collector-inputs/tiktokNewCommentsWrapper-1.0.0.schema.json
package/src/collector/new-comments-wrapper/new-comments-wrapper-contract.js
```

Contract module responsibilities:

- fatal UTF-8 decode (`TextDecoder(..., { fatal: true })`)
- JSON parse
- Ajv 2020 schema validation (`allErrors`, strict mode, formats as needed)
- semantic validation:
  - `items.length >= 1`
  - each `comments.loadedCount === comments.items.length`
  - at most one distinct non-empty video ID across `video.id` and comment `videoId`s
- errors include JSON paths / item indexes
- Collector-side error class; do not import Database error types

Do not hash here unless needed by a pure helper; generic `importRawInput` owns stored payload identity.

## Step 3 — Pure DTO adapter

Suggested file:

```text
package/src/collector/new-comments-wrapper/new-comments-wrapper-adapter.js
```

Input: exact `Uint8Array`/Buffer.  
Output:

```js
{
  payloadBytes: originalBytes,
  inputFormat: "tiktokNewCommentsWrapper-1.0.0",
  snapshots: mappedItems
}
```

The adapter must not access filesystem, SQLite, Processing, or UI modules.

## Step 4 — Composition-root connection

At the update-flow boundary that reads the incoming file:

1. read bytes once,
2. call the Collector adapter,
3. call generic `importRawInput` once.

If a thin filesystem bridge is needed, place it under `scripts/adapters/`; do not treat that directory as a new architectural layer.

Do not alter legacy `import-raw-snapshot` to auto-detect wrapper/legacy formats.

## Step 5 — Integration with existing raw analysis flow

The newly imported snapshots should be selectable/exportable through the existing repository/projection path. No Stage13 merge/dedupe work belongs in this issue.

## Error behavior

All parsing/mapping failures occur before `importRawInput`. The final DB import remains atomic. Diagnostics should identify paths such as `items[3].comments.items[7].commentId`; avoid dumping full comment text into errors.
