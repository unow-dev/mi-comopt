# 03 — File / Function Change Map

## Freeze: do not retrofit v3 semantics here

`package/src/workflow/definitions.js` remains the v2 Definition implementation. It currently emits revision 2 only; keep it that way. `package/src/workflow/session-input.js` and `package/src/workflow/outcomes.js` are also v2 behavior. `package/src/integration/task-handlers.js` remains v2 because it includes `businessAttempt` in operation identity and maps operational errors to `blocked`. `package/src/application/services.js`, `release-services.js`, and `deployment-services.js` remain v2 business paths; do not conditionally branch them into hybrid v2/v3 services.

## Add v3 workflow boundary

Create `package/src/workflow/v3/`. `contracts.js` loads/implements the normative schema boundary; `result-rules.js` validates exact `(stepId,routingOutcome,stateResult,refs)` rules; `definitions.js` emits `comment-data-update@TARGET_REVISION`; `session-input.js` validates the exact v3 Session shape; `outcomes.js` projects only the five v3 terminal statuses; `index.js` exports the v3 surface. Root `workflow/index.js` gets additive exports only. `deploy-promoted-release` remains the existing revision-2 builder.

## Add v3 application boundary

Create `package/src/application/v3/`. `result.js` is the only v3 WorkStepResult constructor and validates results before return. `context.js` creates `operationId=<sessionId>/<stepId>` and the stable business request DTO/hash contract. Classification and Keyword services may reuse pure helper algorithms but not the v2 `stepResult()` helper, which emits removed generic fingerprints.

## Shared state primitive: one backward-compatible extension

Modify `package/src/state/control-plane.js` only to add explicit commit equality mode. Default remains semantic-only. `semantic_and_dependencies` additionally requires exact dependency equality before returning unchanged. No Promotion/Deployment business policy belongs in StateControlPlane.

## Release

Reuse `package/src/release/artifact-store.js` for bytes. Add v3 Release service and an additive `release_identities_v3` table. Do not reinterpret existing v2 release rows. The v3 releaseKey is the normative eight named pins under JCS/SHA-256, while the existing `release_bundles`/artifact tables remain storage primitives referenced by the v3 identity mapping.

## Promotion

Add a v3 Promotion service. It creates an immutable proposal, consumes Human review evidence, records the formal Decision, then performs guarded Commit. On accept + head conflict the accepted Decision remains and Commit is skipped. Do not use the v2 early same-release shortcut as a substitute for expected-head validation.

## Deployment

Create v3-specific deployment ledger/outbox modules and tables. Do not extend v2 `deployment_requests` semantics in-place. v3 identity is accepted Promotion Decision x target; sequence is target-local monotonic; same-target external deployment is durable FIFO single-flight. Verification checks Promotion head before and after external verification; record uses both Promotion guard and sequence guard.

## Integration

Add `package/src/integration/task-handlers-v3.js` rather than modifying the v2 adapter into a dual-mode switch. Bind exactly one top-level side-effecting Application Service command per Agent step. Provider/runtime failures remain execution failures unless the normative business outcome explicitly says otherwise.
