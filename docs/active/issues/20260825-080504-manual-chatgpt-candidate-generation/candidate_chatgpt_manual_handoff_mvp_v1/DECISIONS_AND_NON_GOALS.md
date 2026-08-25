# Final decisions and rejected alternatives

This file exists to prevent reopening settled design choices during implementation.

## Adopted

### Manual boundary, not ChatGPT API
MVP prepares files for a human-operated ChatGPT session and accepts a JSON proposal back.

### Minimal integrity manifest
`handoff_manifest.json` binds exact bytes of the 10 files created before the ChatGPT call.
It is local-only and is not an execution/audit log.

### Two identities for dataset
- request dataset SHA: upstream publication identity
- manifest dataset SHA: exact local handoff file bytes

They are intentionally different concepts.

### Recompute pre-evaluation
Use base registry + selected dataset + existing policy/taxonomy. Do not copy current evaluation when dataset may have changed.

### Existing core contracts remain unchanged
Do not extend candidate proposal/request/change-set schemas with ChatGPT metadata.

### One-time current resolution
Resolve `publication-root/current` once to an immutable publication directory before reading its artifacts.

### Exclusive output directory
No overwrite/force mode. Existing output means hard failure.

### Production canonicalization happens only inside full-update
Standalone `canonicalize-proposal` remains a diagnostic command only.

---

## Rejected

### `request.source_dataset.artifact_sha256 = SHA256(handoff file bytes)`
Rejected because existing contract uses that field as upstream artifact identity.

### Put prompt/model/raw response fields into proposal/request
Rejected because it pollutes provider-neutral deterministic contracts and is outside MVP.

### Execution receipt / attempt history
Rejected for MVP scope.

### Automatic Markdown/JSON repair
Rejected because it creates an ambiguous human/LLM transformation boundary.

### ZIP generation in runtime CLI
Rejected. The operational handoff can be a directory; packaging is not part of candidate semantics.

### Policy/taxonomy change during manual candidate update
Rejected for MVP. Supplied policy/taxonomy must match current publication.

### `canonicalize-proposal → full-update` as operator flow
Rejected because `add` can receive different random IDs on the two canonicalization calls.

### Deterministic candidate ID generation
Rejected as larger workflow semantics change.

### Modify existing `readCurrentPublication()` globally
Rejected to minimize regression surface. Add a dedicated resolver for the new path.

### Runtime dependency on active issue docs
Rejected because issue archival/movement would break the CLI.

### Rewrite schema `$ref` or add Ajv
Rejected for MVP. Ship existing schema/common schema together and instruct ChatGPT to use the attached common schema.
