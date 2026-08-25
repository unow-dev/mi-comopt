# Patch map

## `src/lib/publication.js`

Add:

- `resolveCurrentPublicationDir(rootDir)`
- unit test: current symlinkをresolve後にcurrentを別runへ切り替えても、resolved pathが旧immutable publicationを指し続けること。

Do not modify existing `readCurrentPublication()` semantics in this issue.

---

## `src/lib/update-flow.js`

At the beginning of `prepareFullUpdate()` after/with registry stale check, add request binding validation for:

- `policy.policy_version`
- `contentSha256(policy)`
- `taxonomy.taxonomy_version`
- `contentSha256(taxonomy)`

Mismatch code: `REQUEST_ARTIFACT_MISMATCH`.

Do **not** compare dataset file byte SHA with `request.source_dataset.artifact_sha256`.

Keep `canonicalizeProposal()` inside `prepareFullUpdate()` as the production add-ID issuance point.

---

## `scripts/candidate-workflow.mjs`

### Imports

Need/use existing:

- `buildCandidateView`
- `buildPreEvaluation`
- `contentSha256`
- `conflictSet`
- `createRequestId`
- `evaluateCandidates`
- `makeGenerationRequest`

Add/import:

- `resolveCurrentPublicationDir`
- crypto SHA-256 helper (`node:crypto`) if byte hash helper is local to CLI.

### New helpers suggested

Names are not normative, behavior is:

- `readFileBytes(file)`
- `readJsonWithBytes(file)`
- `byteSha256(bytes)` → `sha256:<hex>`
- `resolveDatasetSourceSha(dataset, explicitSha)`
- `assertHandoffBaseBindings(...)`
- `verifyHandoffManifest(...)`
- `copyBytes(...)`

Avoid introducing a generic abstraction layer beyond what this command needs.

### New command

`prepare-handoff` per `IMPLEMENTATION_SPEC.md`.

### Extend `full-update`

Parse optional `--handoff-manifest`.
When present, perform raw-byte manifest verification before `prepareFullUpdate()`.

Do not alter existing behavior when option is absent, except for the library-level policy/taxonomy binding hardening.

### Usage text

Add `prepare-handoff` and `--handoff-manifest` syntax.

---

## `contracts/candidate-handoff/v1/`

Install the four files included with this implementer handoff:

- `prompt.txt`
- `PROMPT_CONTRACT_v1.md`
- `candidate-proposal.schema.json`
- `common.schema.json`

Do not rewrite `$id` / `$ref` for MVP.

---

## `tests/`

Add focused tests described in `ACCEPTANCE_TESTS.md`.

Prefer unit tests for helpers/bindings and one end-to-end manual handoff fixture. Do not duplicate every existing proposal lifecycle test.

---

## `scripts/README.md`

Document the exact 4-step manual operator flow:

1. prepare handoff
2. paste `prompt.txt` as the chat message and upload the other 9 files (never upload manifest)
3. save JSON-only proposal
4. run full-update with `--handoff-manifest`

Explicitly say standalone `canonicalize-proposal` is not a production pre-step.
