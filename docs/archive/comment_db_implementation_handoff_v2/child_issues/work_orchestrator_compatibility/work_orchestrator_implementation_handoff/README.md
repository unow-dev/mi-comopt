# Work Orchestrator Compatibility — Implementer Handoff

## Status

- **Implementation readiness:** 100%
- **Design decisions remaining:** none
- **Target:** an implementer can execute this handoff without making architecture, workflow, retry, correlation, policy-provenance, or concurrency decisions.
- **Input snapshot:** `work_orchestrator_compatibility_discussion_set.zip` supplied on 2026-09-15.

## Normative order for this handoff

If files in this ZIP conflict, use this order:

1. `01_FINAL_SPEC.md`
2. `02_PROVIDER_IMPLEMENTATION.md`
3. `03_CONSUMER_IMPLEMENTATION.md`
4. `04_DEPLOYMENT_INGRESS_AND_LEDGER.md`
5. `05_DEFINITION_V2_BLUEPRINT.md`
6. `06_ACCEPTANCE_AND_REGRESSION.md`
7. `07_IMPLEMENTATION_SEQUENCE.md`
8. `08_FILE_CHANGE_MAP.md`
9. `09_DECISION_DELTA.md`
10. `10_IMPLEMENTER_CHECKLIST.md`
11. source files in `source_context/`

The pre-existing `docs/active/issues/comment_db_implementation_handoff_v2/*` in the source snapshot is **context, not the final compatibility specification**. Several points were intentionally superseded during the compatibility discussion. Those supersessions are enumerated in `09_DECISION_DELTA.md`.

## Required delivery

The implementation is complete only when all of the following are true:

- Provider supports Definition `schemaVersion: 2` while preserving v1 behavior.
- Provider package public types, validator, runtime, Temporal path, `dist`, and tests agree.
- Consumer registers `comment-data-update@2` and `deploy-promoted-release@2` through the Provider public root.
- Consumer uses explicit semantic input bindings and no duplicate structural WorkDefinition validator.
- Promotion and Deployment policy provenance is backed by real versioned policy streams.
- Deployment request/event ingress is race-safe, idempotent, replayable, and session-routable.
- A01–A32 plus the additional compatibility tests in this handoff pass.
- Definition hashes are calculated by Provider `validateAndHashDefinition()` and snapshot-pinned only after the exact v2 tree is built.

## High-level implementation order

Do not start by rewriting the Consumer definition against the old Provider API. Implement in this order:

1. Provider schema v2 + v1 compatibility.
2. Provider runtime/Temporal semantics and external-event facade.
3. Consumer strict policy/session boundaries.
4. Deployment request ledger + event ingress/outbox.
5. Consumer AgentAdapter and application-service fixes.
6. Revision-2 WorkDefinitions and outcome projector.
7. Hash/snapshot/package build updates.
8. Full regression and acceptance tests.

See `07_IMPLEMENTATION_SEQUENCE.md` for gates.
