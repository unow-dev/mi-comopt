# Acceptance criteria

Implementation is complete only when all statements below are true.

- [x] V1 wrapper contract is explicit, versioned, strict for object keys, and rejects unknown shape changes.
- [x] Original wrapper bytes are passed unchanged to generic raw import and stored once.
- [x] Every wrapper item maps deterministically to one snapshot DTO in original order.
- [x] Every comment maps deterministically in original order; no adapter dedupe occurs.
- [x] `loadedCount` mismatch rejects before DB import.
- [x] conflicting non-empty video IDs reject before DB import.
- [x] `comments.note` maps verbatim to coverage note.
- [x] external-ID empty-string semantics match the existing legacy adapter.
- [x] exactly seven generic DTO/DB fields gain nullable support; no unrelated constraints are loosened.
- [x] SQL NULL survives every read/round-trip as JS/JSON `null`, never `0`.
- [x] legacy `tiktokRawSnapshot-1.0.0` input contract remains unchanged.
- [x] complete wrapper validation/mapping happens before one atomic `importRawInput` call.
- [x] Database and Processing contain no wrapper-specific parser dependency.
- [x] representative anonymized fixture and negative fixtures/tests cover contract and mapping rules.
- [x] local real-file verification succeeds for 8 snapshots / 2,677 comments without committing the raw file.
- [x] full repository tests/build/lint/checks required by the package are green.
