# Acceptance tests — MVP v1

## A. `prepare-handoff`

### A1. Happy path

Given a valid publication root, same policy/taxonomy, valid dataset and source identity:

- command succeeds
- exactly 11 expected files exist
- success stdout contains request ID, fingerprint, source ref/SHA, outdir

### A2. Current resolution is single-snapshot

Arrange two immutable publication dirs A/B and `current -> A`.
Resolve/start handoff, then switch `current -> B` during the operation (test via injected/helper-level sequence).
Generated base artifacts/request must be entirely from A; no mixed A/B values.

### A3. Current artifact validation

Corrupt registry / manifest / current meta relationship.
Existing `validateGeneratedArtifacts()` error must surface rather than being collapsed into a generic handoff error.

### A4. Handoff-specific cross-binding

Create a publication where existing validator passes but one of these bindings is inconsistent:

- meta run ID vs manifest run ID
- dataset SHA across meta/manifest/evaluation
- policy version/hash across meta/manifest/evaluation/input policy
- taxonomy version/hash across meta/manifest/input taxonomy

Expect `HANDOFF_INPUT_MISMATCH`.

### A5. New dataset source-ref required

New resolved source SHA != base source SHA and no `--source-ref`.
Expect `SOURCE_REF_REQUIRED`.

### A6. Explicit source-ref wins

Same source SHA as base but explicit new `--source-ref`.
Request must use explicit ref.

### A7. Source SHA resolution

Cover:

- top-level dataset `artifact_sha256`
- nested `manifest.artifact_sha256`
- explicit `--source-sha`
- explicit vs embedded mismatch
- no discoverable SHA → `SOURCE_SHA_REQUIRED`

### A8. Dataset SHA semantics

Assert `request.source_dataset.artifact_sha256` equals resolved upstream identity, **not** raw bytes SHA of `source_dataset.json` unless coincidentally equal.

### A9. Re-evaluation

Base publication evaluation may refer to old dataset. New handoff `pre_evaluation.json` must equal `buildPreEvaluation(evaluateCandidates(base registry, new dataset,...))`, not copied current evaluation.

### A10. Raw copy behavior

Input dataset/policy/taxonomy contain intentionally non-pretty whitespace.
Generated handoff copies must be byte-identical to the input files.

### A11. Generated JSON behavior

`candidate_view.json`, `pre_evaluation.json`, `candidate_generation_request.json`, `handoff_manifest.json` equal `prettyJson()` output with trailing newline.

### A12. Manifest byte hashes

For every one of the 10 non-manifest files:

```text
handoff_manifest.files[name] == SHA256(actual file bytes)
```

Manifest request ID/fingerprint equal generation request.

### A13. Determinism

With:

- same resolved base publication
- same exact input file bytes
- same runtime contract bytes
- same CLI args
- same `--request-id`

all 11 output file bytes must be identical across two separate runs.

### A14. Existing outdir is never touched

Place sentinel bytes in existing outdir.
Run command.
Expect `HANDOFF_OUTPUT_EXISTS` and sentinel byte-identical afterwards.

### A15. Owned-output cleanup

Inject/trigger a handled failure after exclusive outdir creation.
The newly-created outdir is removed.
A pre-existing outdir must never enter cleanup ownership.

---

## B. `prepareFullUpdate()` binding hardening

### B1. Policy version mismatch

Request version != supplied policy version → `REQUEST_ARTIFACT_MISMATCH`.

### B2. Policy content mismatch

Same version but modified policy content → `REQUEST_ARTIFACT_MISMATCH`.

### B3. Taxonomy version mismatch

→ `REQUEST_ARTIFACT_MISMATCH`.

### B4. Taxonomy content mismatch

Same version but modified taxonomy content → `REQUEST_ARTIFACT_MISMATCH`.

### B5. Registry binding remains stale-parent behavior

Different registry content vs request base hash → existing `STALE_PARENT`.

### B6. Dataset upstream identity remains existing contract

Dataset top-level `artifact_sha256` differs from request source SHA → existing `DATASET_ARTIFACT_HASH_MISMATCH` through evaluation/validation.
Do not introduce a raw file SHA comparison here.

---

## C. Handoff manifest verification in `full-update`

### C1. Valid manifest

All supplied handoff files byte-match manifest and IDs match → processing continues.

### C2. Dataset file edited after handoff

Change a comment while preserving embedded upstream `artifact_sha256`.
Expect `HANDOFF_MANIFEST_MISMATCH` before publication.

### C3. Policy formatting-only edit

Even if canonical `contentSha256(policy)` would remain equal, raw bytes differ from manifest → `HANDOFF_MANIFEST_MISMATCH`.

This is intentional: manifest binds the actual handoff file, while request binds semantic canonical content.

### C4. Request file edited/reformatted

Raw bytes mismatch → `HANDOFF_MANIFEST_MISMATCH`.

### C5. Candidate-view/pre-evaluation required for manifest flow

When `--handoff-manifest` is supplied but either CLI file is omitted → fail closed.

### C6. Manifest ID/fingerprint mismatch

→ `HANDOFF_MANIFEST_MISMATCH`.

### C7. Missing static handoff file

Delete `prompt.txt` or one schema from manifest directory → manifest verification fails.

---

## D. End-to-end manual flow

### D1. Empty proposal

prepare-handoff → fixture `actions: []` proposal → full-update with manifest succeeds and preserves deterministic semantics.

### D2. Add proposal issues ID once

Use fixture `add` proposal.
Run production `full-update` directly, without standalone canonicalize command.
Assert:

- exactly one add ID is generated in the successful operation
- `candidate_change_set.json` candidate ID == `candidate_registry.json` added candidate ID
- first-publication history is correct

### D3. Stale current after handoff

Generate handoff against publication A.
Publish another run B as current.
Attempt full-update using A request/proposal.
Expect existing `STALE_PARENT`; no automatic rebase and no change to B.

### D4. ChatGPT prose/fence output

Proposal file contains Markdown fence or explanatory prose.
Existing JSON parse path fails. No repair/parser fallback is added.

---

## E. Regression

- Existing valid/invalid proposal lifecycle tests remain green.
- Existing full-update empty action behavior remains green.
- Existing publication stale-parent behavior remains green.
- No core schema version changes.
- `canonicalize-proposal` command remains available, but README no longer presents it as a production handoff pre-step.
