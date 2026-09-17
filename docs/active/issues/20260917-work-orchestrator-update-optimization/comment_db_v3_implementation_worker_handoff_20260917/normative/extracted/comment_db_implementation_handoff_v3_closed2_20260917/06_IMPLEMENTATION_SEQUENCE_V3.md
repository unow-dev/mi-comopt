# Implementation Sequence v3

This file is sequencing guidance. Normative obligations and completion gates are defined by `01`, machine-readable contracts, and `05`.

## PR0 — normative handoff and registry preflight

Deliver this package, schema/rules validation, requirement/acceptance traceability validation, and supporting-document normative-keyword lint. Resolve `TARGET_REVISION` mechanically: starting at 3, build/validate/hash the candidate tree for revision `r`; use an absent slot, reuse an equal-hash slot, or increment past a conflicting immutable slot. No production behavior changes. v2 artifacts remain untouched/frozen.

## PR1 — provider additive compatibility

Implement only additive generic provider prerequisites: ProducedArtifact logicalPath; optional InputBinding; RegistryReader receipt lookup; pure external-event envelope preparation/hash parity. Keep local/Temporal parity and consumer business semantics out of provider code.

## PR2 — consumer v3 foundation

Add new Definition/session/terminal-result contracts, the task-result semantic rules validator, strict Human artifact submission-result schema, and validated Human artifact completion infrastructure. The new revision may be built/validated in test registries but is not reachable from the production default registration/start facade. Keep v2 hashes unchanged.

## PR3 — domain authority and handoffs

Implement common application idempotency, Classification/Keyword preparation, file-response consumption, dependency-aware no-op mode, Human Decision/finalization, and state authority. Use disposable/cloned DB only for v3 execution until cutover. Production remains v2 authority.

## PR4 — release, promotion, Temporal integration, deployment queue/outbox

Implement deterministic Release identity/materialization, Promotion finalization, target-local deployment sequence/FIFO single-flight, v3 workers, Workspace artifact lineage, Temporal runtime, external-event reconciliation, deployment outbox, and full E2E in a production-like environment. Production default start remains revision 2 until PR5.

## PR5 — cutover and legacy authority retirement

Execute the cutover transaction from `04_DB_AUTHORITY_AND_CUTOVER_V3.md`, enable production starts only after legacy authority is disabled, and run production smoke.

## Merge invariant

Each PR should leave `main` safe if no later PR merges; do not rely on temporarily unsafe dual authority between stacked PRs.
