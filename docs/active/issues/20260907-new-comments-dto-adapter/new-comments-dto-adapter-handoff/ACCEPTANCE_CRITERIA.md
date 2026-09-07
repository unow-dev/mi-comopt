# Acceptance criteria

Implementation is complete only when all statements below are true.

- [ ] V1 wrapper contract is explicit, versioned, strict for object keys, and rejects unknown shape changes.
- [ ] Original wrapper bytes are passed unchanged to generic raw import and stored once.
- [ ] Every wrapper item maps deterministically to one snapshot DTO in original order.
- [ ] Every comment maps deterministically in original order; no adapter dedupe occurs.
- [ ] `loadedCount` mismatch rejects before DB import.
- [ ] conflicting non-empty video IDs reject before DB import.
- [ ] `comments.note` maps verbatim to coverage note.
- [ ] external-ID empty-string semantics match the existing legacy adapter.
- [ ] exactly seven generic DTO/DB fields gain nullable support; no unrelated constraints are loosened.
- [ ] SQL NULL survives every read/round-trip as JS/JSON `null`, never `0`.
- [ ] legacy `tiktokRawSnapshot-1.0.0` input contract remains unchanged.
- [ ] complete wrapper validation/mapping happens before one atomic `importRawInput` call.
- [ ] Database and Processing contain no wrapper-specific parser dependency.
- [ ] representative anonymized fixture and negative fixtures/tests cover contract and mapping rules.
- [ ] local real-file verification succeeds for 8 snapshots / 2,677 comments without committing the raw file.
- [ ] full repository tests/build/lint/checks required by the package are green.
