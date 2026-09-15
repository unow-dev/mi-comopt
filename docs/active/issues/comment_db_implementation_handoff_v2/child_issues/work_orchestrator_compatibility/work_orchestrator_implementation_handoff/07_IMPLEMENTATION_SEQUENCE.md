# Implementation Sequence and Gates

Do not parallelize across a gate if downstream work would require guessing an unfinished upstream contract.

## Phase 1 — Provider public schema v2

Files: contracts + validation + exports.

Deliver:

- v1/v2 schema distinction;
- InputBinding task source;
- binding Choice;
- Noop;
- dynamic correlation type;
- v2 Task contract Human/Agent budget distinction;
- Agent request/result shape.

Gate 1:

- Provider typecheck/build passes;
- all existing v1 validation tests pass;
- new v2 structural tests pass.

## Phase 2 — Provider runtime / Temporal

Deliver:

- binding resolution and Choice runtime;
- wait correlation resolve-once;
- blocked intervention semantics;
- Human completedBy;
- Noop results;
- resultsByStepId public Session view;
- Agent fields propagated in in-process and Temporal paths.

Gate 2:

- in-process and Temporal integration tests assert equivalent behavior;
- recovery tests cover dynamic wait correlation and ActorRef persistence.

## Phase 3 — Provider external-event facade

Deliver receipt-first/terminal-ignored facade and public export.

Gate 3:

- duplicate after workflow closure is idempotent;
- altered payload under same command ID conflicts.

## Phase 4 — Consumer state/policy foundations

Deliver:

- three new policy streams;
- strict exact-stream version validation;
- Session pin validation including corpus policy;
- separate recovery Session input/starter;
- fail-closed policy lookup.

Gate 4:

- cross-stream injection tests fail as expected;
- fixtures/migration include real policy versions before v2 enablement.

## Phase 5 — Application services + AgentAdapter

Deliver:

- Promotion propose boundary;
- finalize policy dependency semantics;
- Release strict policy streams;
- deployment record semantics/permissions;
- Provider AgentAdapter with stable OperationContext and explicit routing map;
- blocked error classification.

Gate 5:

- application-service tests pass independent of WorkDefinition;
- no pseudo policy IDs remain in production Decision creation.

## Phase 6 — Deployment intent ledger/event ingress

Deliver schema migration, two-phase trigger, monotonic reconcile, event audit/outbox/replay.

Gate 6:

- D01–D17 pass under forced race/crash simulations.

## Phase 7 — Consumer revision-2 definitions

Only now replace/introduce v2 builders.

Deliver exact tree from `05_DEFINITION_V2_BLUEPRINT.md`, semantic binding Records, Noop terminal markers, removal of blind suffix tree rewriting, public Provider validation.

Gate 7:

- definitions validate through Provider public root;
- both register;
- exact hashes recorded as @2 snapshots;
- revision-1 hashes remain unchanged.

## Phase 8 — Outcome projection and end-to-end

Deliver completed-Session projector and API outcome validation.

Gate 8:

- O01–O06;
- A01–A32;
- Consumer tests/build;
- Provider tests/build;
- provider `dist` regenerated;
- file dependency lock reflects Provider package bump.

## Completion checklist

The issue may close only when:

- [ ] Provider package version and dist updated.
- [ ] schema-v1 regression suite green.
- [ ] schema-v2 suite green.
- [ ] no pseudo policy Decision version IDs remain.
- [ ] no v2 blocked Choice branches remain.
- [ ] no positional `inputBindings` arrays remain in v2 definitions.
- [ ] no Human review bypasses finalize on reject.
- [ ] deployment callback can always find workflow_session_id.
- [ ] deployment trigger external call occurs after durable prepared intent.
- [ ] event outbox replay works after workflow closure.
- [ ] v2 canonical hashes are generated and pinned.
- [ ] A01–A32 all pass.
