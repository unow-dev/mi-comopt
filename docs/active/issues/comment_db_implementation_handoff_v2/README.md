# Comment DB State Management / Workflow Handoff v2

## Status

- **Normative status:** implementation handoff / design frozen
- **Design completion:** 100%
- **Supersedes:** `references/DESIGN_SPEC_V1_SUPERSEDED.md` for workflow/runtime implementation details
- **Target:** implementer can proceed without making architectural or workflow-design decisions

## Read order

1. `01_NORMATIVE_IMPLEMENTATION_SPEC_V2.md` — sole normative architecture/specification.
2. `02_WORK_ORCHESTRATOR_FLOW.md` — exact business workflow decomposition on `work-orchestrator`.
3. `03_APPLICATION_SERVICE_CONTRACTS.md` — boundary between orchestration workers and Comment DB/application services.
4. `04_DB_SCHEMA_AND_MIGRATION.md` — physical control plane, typed domain state, migration/cutover.
5. `05_ACCEPTANCE_TESTS.md` — mandatory acceptance matrix.
6. `06_IMPLEMENTATION_SEQUENCE.md` — recommended implementation order and completion gates.
7. `08_TASK_IO_AND_PERMISSION_MATRIX.md` — exact per-step semantic inputs, outputs, capabilities/permissions.
8. `07_DECISION_LOG.md` — adopted/rejected alternatives and reasons.
9. `contracts/` — JSON-schema-level handoff contracts.

## Normative hierarchy

If documents conflict, use this order:

`01_NORMATIVE_IMPLEMENTATION_SPEC_V2.md` > `02..06` > `contracts/*` > `07_DECISION_LOG.md` > `references/*` > `source_context/*`.

`references/` and `source_context/` are evidence/context only. They are not normative for the To-Be implementation.

## Core implementation rule

`work-orchestrator` owns **workflow execution state**. Comment DB owns **business authoritative state**. Never merge those responsibilities and never treat an Orchestrator task completion as a business-state commit.

## Package contents

- `contracts/comment-data-update-session-input.schema.json`
- `contracts/work-step-result.schema.json`
- `contracts/deployment-completed-event.schema.json`
- `contracts/comment-data-update-outcome.schema.json`
- `references/WORK_ORCHESTRATOR_API_REFERENCE.md`
- `references/WORK_ORCHESTRATOR_README.md`
- `references/DESIGN_SPEC_V1_SUPERSEDED.md`
- `source_context/ISSUE_BODY.md`
- `source_context/WORK_TASK_SEQUENCE_AS_IS.md`
- `source_context/SEQUENCE_DIAGRAM_AS_IS.md`

## Definition IDs

The initial implementation SHALL provide these definitions:

- `comment-data-update`
- `deploy-promoted-release`

Definition revisions are immutable. Any registered definition change that affects its canonical hash requires a new revision.
