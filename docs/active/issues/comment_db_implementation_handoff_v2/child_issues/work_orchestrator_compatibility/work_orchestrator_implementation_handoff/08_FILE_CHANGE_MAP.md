# File Change Map

This map is based on the supplied source snapshot. Line numbers are intentionally omitted because implementation edits will shift them; function/type names are stable anchors.

## Provider

| File | Change anchors |
|---|---|
| `provider/package/src/contracts.ts` | `TaskContract`, `InputBinding`, `ChoiceStep`, `WaitEventStep`, `Step`, `TaskRuntime`, `AgentRunRequest`, `AgentRunResult`, public Session view types |
| `provider/package/src/validation.ts` | `validateAndHashDefinition`, Step validator, Task contract validator, Choice/Wait validation, schemaVersion branching |
| `provider/package/src/domain.ts` | input binding resolver, Choice traversal, Task completion, Agent result reducer, intervention/manual retry, Wait creation/matching, Noop traversal |
| `provider/package/src/runtime.ts` | `AgentAdapter`, `FakeAgentAdapter`, Codex adapters, dispatch/drive agent execution, public session state/view |
| `provider/package/src/registry.ts` | task serialization, command receipts, Session persistence/query, completedBy persistence |
| `provider/package/src/temporal-contracts.ts` | Agent activity request/results, external event inputs if required |
| `provider/package/src/temporal-activities.ts` | Agent request construction/result propagation |
| `provider/package/src/temporal-workflow.ts` | budgets on Agent only, blocked handling, waits, Session view |
| `provider/package/src/temporal-client.ts` | external-event delivery support/facade integration |
| `provider/package/src/index.ts` | export v2 public API/facade/types |
| `provider/package/tests/acceptance.test.js` | v1 regression + v2 semantics |
| `provider/package/tests/temporal-integration.test.js` | v2 Temporal parity/recovery |
| `provider/package/package.json` | `0.0.0 -> 0.1.0` |
| `provider/package/dist/*` | regenerate; do not hand-edit |

## Consumer workflow/integration

| File | Change anchors |
|---|---|
| `consumer/package/src/workflow/definitions.js` | revision/schema v2, semantic Record bindings, Noop, new Promotion propose, parameterized continuations, no blocked branches, new routing outcomes |
| `consumer/package/src/workflow/compatibility.js` | Provider structural validation as sole authority; remove revision override to v1 tree |
| `consumer/package/src/workflow/session-input.js` | corpus policy pin, exact-stream validation, recovery input/starter |
| `consumer/package/src/workflow/outcomes.js` | explicit stateResult mapping, no details authority, completed-Session projector, deployment_failed validation |
| `consumer/package/src/integration/task-handlers.js` | `promotion.propose`, Provider AgentAdapter, stable OperationContext, error classification |
| `consumer/package/src/integration/index.js` | export adapter/ingress as needed |

## Consumer application/state

| File | Change anchors |
|---|---|
| `consumer/package/src/application/services.js` | new policy stream keys, strict policy lookup, Corpus/Classification/Keyword policy dependencies/finalize |
| `consumer/package/src/application/release-services.js` | Release exact policy streams, Promotion propose/finalize changes, remove stale same-release shortcut |
| `consumer/package/src/application/deployment-services.js` | two-phase trigger, Promotion version check, event ingestion split/outbox, record semantics/policy/permissions |
| `consumer/package/src/deployment/adapter.js` | confirm `ensureDeployment` is idempotent/reconcilable by deploymentRequestId; no API ambiguity |
| `consumer/package/src/comment-db-state.js` and schema/migration owner | add ledger columns, new policy stream fixtures/migrations, event outbox tables if schema is centralized there |
| `consumer/package/src/state/query.js` | exact stream/version query helpers as appropriate |
| `consumer/package/src/state/errors.js` | new conflict/ingress error codes if not already generic |

## Contracts/docs/tests

| File | Change |
|---|---|
| `.../contracts/work-step-result.schema.json` | add deployment_failed; keep schema aligned with runtime copy |
| `.../contracts/comment-data-update-session-input.schema.json` | add corpusPolicyVersionId |
| add recovery Session schema | promotionVersionId + releaseId + target |
| `consumer/package/tests/comment-db-state.test.js` | policy/application/definition/deployment tests; split if file becomes unwieldy |
| `provider/docs/.../ISSUE_BODY.md` | update accepted Provider scope if project process requires issue text to match implementation |

## Existing problematic anchors in snapshot

These are concrete places the implementer should expect to replace/fix:

- Consumer `definitions.js`: `WORK_DEFINITION_REVISION = 1`.
- Consumer `definitions.js`: `ROUTING_OUTCOMES` currently contains `blocked`.
- Consumer `definitions.js`: Agent/Human `inputBindings` passed as arrays despite Provider public type being Record.
- Consumer `definitions.js`: `interventionOnExhaustion: "manual_retry"` instead of boolean.
- Consumer `definitions.js`: Human Task uses Agent WorkStepResult schema.
- Consumer `definitions.js`: terminal implemented as empty Sequence.
- Consumer `definitions.js`: Wait correlation is target instead of deploymentRequestId.
- Consumer `definitions.js`: blind `suffixStepTree()`.
- Consumer `outcomes.js`: authoritative use of `details.outcome`.
- Consumer `services.js`: `policyPayload()` silently falls back to `{}`.
- Consumer `release-services.js`: Promotion finalize can choose request policy and has same-release early return before stale-head guard.
- Consumer `deployment-services.js`: external ensure call occurs before request row insertion.
- Consumer `deployment-services.js`: callback blindly UPDATEs request status.
- Consumer `deployment-services.js`: deployment record requires caller boolean `verified` and uses pseudo policy ID.
- Consumer `task-handlers.js`: lacks `promotion.propose` and is not yet a Provider AgentAdapter.
- Provider `contracts.ts`: Wait correlation only string, Choice decision only Task, no task binding/no Noop/top-level Agent outcome/blocked/session context.
- Provider `validation.ts`: Wait requires string correlation, all Task budgets required.
