# Provider Prerequisites

This file elaborates provider-side implementation required by `V3-REQ-ART-007`, `V3-REQ-DEPLOY-002`, `V3-REQ-DEPLOY-003`, and `V3-REQ-REV-006`. Provider changes remain additive and generic; consumer-specific business protocols stay in consumer code.

## P1. ProducedArtifact logicalPath

Add `logicalPath?: string` to public `ProducedArtifact`. Preserve it when Agent outputs are materialized into ArtifactVersionRuntime in local and Temporal paths. Outgoing names used by this flow:

- `three-class-workset.zip`
- `keyword-candidate-handoff.zip`

## P2. Optional InputBinding

Add `optional?: boolean` to `InputBinding`, default false. Validation/runtime semantics:

- strict behavior unchanged when omitted/false;
- optional step/task predecessor not executed/unselected -> resolved value omitted;
- predecessor executed -> normal JSON pointer resolution; invalid path fails closed;
- artifact propagation includes the predecessor's accepted output ArtifactVersions when it executed;
- local and Temporal behavior is identical.

## P3. RegistryReader receipt lookup

Expose read-only `RegistryReader.getReceipt(sessionId, commandId)` with the existing Registry receipt return shape. It does not grant mutation capability.

## P4. External event preparation/parity

Create a workflow-safe pure external-event envelope builder with no Node crypto dependency. Canonical external-event command ID is `event:<eventId>`. Node/runtime helper `prepareExternalEventDelivery(session,event)` produces update input plus request hash. Local runtime and Temporal client/workflow use equivalent envelope identity. Dispatcher reconciliation is receipt-first.

## Distribution gate

Provider build/tests, Temporal integration/parity, and package distribution/pack checks are part of the `V3-RV06`/deployment verification surface. Production dependency is an immutable exact provider package version rather than an unpinned workspace fallback.
