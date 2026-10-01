# Provider Implementation Handoff

Source root: `provider/package/`

## A. Public contracts — `src/contracts.ts`

Implement schema-v2 additions while preserving v1:

1. `InputBinding.source += "task"`.
2. `ChoiceStep.decision: TaskStep | InputBinding`.
3. `WaitEventStep.correlationKey: string | InputBinding`.
4. Add `NoopStep` and include in `Step` union.
5. Split/relax Task contract so Agent requires budgets and Human does not in schema v2.
6. Add `TaskRuntime.completedBy?: ActorRef`.
7. Add `AgentRunRequest.session` with Session/Definition context.
8. Add top-level `AgentRunResult.outcome?: string` on succeeded result.
9. Add `AgentRunResult.status = "blocked"`.
10. Do **not** add `ExecutionState="blocked"`.
11. Extend public Session view with `resultsByStepId`.

`CommandEnvelope.schemaVersion` stays `1`.

## B. Definition validation — `src/validation.ts`

Validation is schema-version aware.

### v1

Preserve current behavior and existing tests.

### v2

- only accepted `schemaVersion` values: 1 and 2;
- validate Noop;
- empty Sequence remains invalid;
- Human Task may omit budgets;
- Agent Task still requires valid wall budget;
- binding Choice validates binding syntax and lexical visibility;
- Task Choice preserves branch-key/allowed-outcome validation;
- binding Choice runtime result set is branch keys; statically known task-outcome bindings should be checked against branch keys;
- WaitEvent accepts string or binding correlation;
- validate `source:"task"` requires `stepId` and valid JSON Pointer;
- root pointer is `""`, not `"/"`;
- branch lexical visibility includes a legacy Choice decision Task;
- dynamic/other v1 step behavior is unchanged unless schema v2 explicitly changes it.

`validateAndHashDefinition()` remains the sole structural validation/hash authority. Consumer shall not duplicate it.

## C. Domain reducer/runtime — `src/domain.ts`

### Binding resolution

Add task-source resolution from completed Task runtime:

```ts
{ outcome: task.outcome, actor: task.completedBy, result: task.result ?? null }
```

Resolve exactly one static completed Task for the referenced visible step ID.

### Choice

For InputBinding decision:

1. resolve binding;
2. require string;
3. select same-named branch;
4. otherwise reject/fail as `OUTCOME_INVALID`.

### WaitEvent

At wait creation:

1. resolve `correlationKey` if binding;
2. require non-empty string;
3. store on `WaitRuntime.correlationKey`.

External event matching compares event against persisted wait matcher only.

### Noop

Noop immediately completes and publishes its static result through normal results/scope completion.

### Human provenance

On `completeHumanTask`, store full command ActorRef in `completedBy`. Do not enforce `actorType === "human"` at Provider level.

### Blocked execution

When Agent result status is `blocked`:

- mark Execution attempt `succeeded` (the worker call itself completed);
- do not complete the business Task;
- Task becomes `waiting`, records attention if useful;
- create intervention/manual-retry Task immediately;
- do not consume normal retry budget;
- do not emit normal task outcome/branch progress.

On resume/manual retry clear stale fields defined in the final spec.

### Agent outcome

For v2, successful Agent completion validates top-level `outcome` against `allowedOutcomes`. Do not read `result.outcome` as fallback. Preserve legacy v1 semantics for v1 definitions.

## D. Runtime adapter path — `src/runtime.ts`

- populate `AgentRunRequest.session`;
- parse/pass top-level outcome;
- allow blocked result;
- all built-in adapters (`FakeAgentAdapter`, Codex adapter/CLI parser) must preserve new result fields;
- Codex CLI allowed status list includes `blocked`, and succeeded JSON may include `outcome`;
- timeout reads budgets only for Agent Tasks.

## E. Temporal path

Files:

- `src/temporal-contracts.ts`
- `src/temporal-activities.ts`
- `src/temporal-workflow.ts`
- `src/temporal-client.ts`
- `src/temporal-worker.ts`

Requirements:

- new Agent request/result shape survives Workflow -> Activity -> Adapter -> Workflow without field loss;
- Human tasks do not dereference missing budgets;
- blocked semantics are identical to in-process runtime;
- dynamic wait correlation persists in Workflow state and recovery;
- `completedBy` persists through Registry serialization/reload;
- session view exposes `resultsByStepId` in both backends.

## F. Registry — `src/registry.ts`

Schema/persistence changes:

- persist `TaskRuntime.completedBy` as JSON or normalized actor fields;
- ensure new Noop/session-result state round-trips;
- keep command receipt behavior/idempotency unchanged unless required by added facade.

Migrate local schema safely for tests; do not silently discard existing columns/data.

## G. External event delivery facade

Add a Provider public service/facade, name may follow existing naming conventions, with semantics equivalent to:

```ts
deliverExternalEvent(sessionId, event)
```

Algorithm:

1. derive command ID `event:<eventId>`;
2. check Registry command receipt **before** contacting a Temporal workflow;
3. if receipt exists and request hash matches, return stored prior success;
4. if same command ID has different payload, return idempotency conflict;
5. if no receipt and Session is active, deliver via normal runtime/Temporal Update;
6. if no receipt and Session is already terminal/closed, persist a receipt (or equivalent facade delivery receipt) for this exact request hash with response `terminal_ignored`, then return success;
7. future replay of the same command ID must compare against that stored hash, so a changed payload conflicts even after Session closure.

Do not alter the reducer to accept arbitrary new events into terminal Sessions. This facade exists so Consumer outbox retries can terminate safely even after Temporal workflow closure.

Export facade from public root if Consumer integration needs it.

## H. Schema validator

The JSON-schema subset used by Agent `resultSchema` must enforce `additionalProperties:false` and `minLength`; add regression tests.

## I. Build/package

- bump package from `0.0.0` to `0.1.0`;
- update lockfile as needed;
- run `npm test` (which rebuilds);
- inspect regenerated `dist/*.d.ts` and `dist/*.js`;
- public root exports all required v2 types/functions/facade.

## J. Provider mandatory tests

At minimum add tests for:

- v1 definition behavior unchanged;
- v2 Noop validation/runtime;
- binding Choice from step and task outcome;
- invalid binding decision -> `OUTCOME_INVALID`;
- `source:"task"` root uses `""`;
- Human Task without budget accepted in v2;
- Human completed actor retained;
- Agent top-level outcome routes in v2;
- v2 does not accept only `result.outcome` as routing source;
- blocked -> waiting + intervention without automatic retry;
- manual retry resets stale fields;
- dynamic event correlation resolves once and survives recovery;
- wrong correlation stays buffered/does not wake wait;
- duplicate event receipt replay;
- event facade returns prior receipt after Workflow closure;
- event facade returns `terminal_ignored` for new event targeting already-terminal Session;
- `additionalProperties:false` and `minLength` enforcement;
- `resultsByStepId` appears in public Session view.
