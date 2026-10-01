# Deployment Request Ledger and Event Ingress

This file is normative for deployment concurrency/idempotency.

## 1. Problem fixed

Current code calls `ensureDeployment()` before inserting `deployment_requests`. A fast callback can arrive before the request row exists. Even after reversing insertion order, the trigger response can race with callback and overwrite a terminal state.

The request row must therefore be a durable external-intent ledger with monotonic reconciliation.

## 2. Required deployment request columns

At minimum:

```text
deployment_request_id   PRIMARY KEY
workflow_session_id     NOT NULL
promotion_version_id    NOT NULL
release_id              NOT NULL
target                  NOT NULL
status                  NOT NULL
external_run_ref        NULL
created_at              NOT NULL
updated_at              NOT NULL
```

`workflow_session_id` is routing provenance needed to deliver callback to the correct Orchestrator Session; it is not a duplicate workflow state machine.

## 3. State machine

Allowed status progression:

```text
prepared
  -> requested
  -> succeeded
  -> failed
  -> cancelled

requested
  -> succeeded
  -> failed
  -> cancelled

succeeded | failed | cancelled are terminal
```

Also allow direct `prepared -> terminal` when callback/adapter completes immediately.

Rules:

- never regress terminal to requested/prepared;
- never change one terminal status to another;
- `external_run_ref` may enrich `null -> value` exactly once;
- two different non-null external refs for the same request are conflict.

## 4. `deployment.trigger` two-phase algorithm

Do not wrap the network call inside a SQLite transaction, and do not use the current all-or-nothing `runIdempotent()` shape around the whole trigger.

Algorithm:

1. Check completed application receipt for operation ID; matching receipt returns previous result.
2. Validate target production.
3. Re-read current Promotion and require both:
   - `versionId === request.promotionVersionId`
   - `releaseId === request.releaseId`
   Otherwise return normal `conflict -> superseded`; do not call external adapter.
4. If Deployment head already serves release, return `already_deployed -> verify` (verification still required).
5. Deterministically derive `deploymentRequestId` from Session/release/target.
6. In a short DB transaction, insert or validate the `prepared` ledger row. Existing same ID with different immutable identity is idempotency conflict.
7. Commit transaction.
8. Outside DB transaction call `ensureDeployment({deploymentRequestId, releaseId, target})`.
9. In a short transaction reconcile adapter response with current ledger using monotonic state rules.
10. Save completed application operation receipt in the same transaction as the final trigger reconciliation/result.
11. Re-read/use persisted row as the source of routing result, not raw adapter return.

If process crashes after external request but before step 9/10, technical retry finds the same prepared/requested row, reuses same deploymentRequestId, and calls idempotent/reconcilable `ensureDeployment` again. This is A17.

Routing from persisted row/adapter result:

```text
requested/prepared intent accepted -> triggered -> wait
already serving / immediate succeeded -> already_deployed -> verify
immediate failed/cancelled -> deployment_failed
promotion pin mismatch -> conflict -> superseded
```

External actual failure is a business terminal, not `blocked`.

## 5. Callback event ingress

External callback schema remains `deployment.completed` correlated by `deploymentRequestId`.

Ingress algorithm:

1. validate event schema;
2. lookup request by deploymentRequestId; unknown request is rejected (no Consumer early buffer);
3. verify release ID and target exactly match ledger identity;
4. create deterministic event identity from:

```text
eventType
deploymentRequestId
target
releaseId
status
externalRunRef
```

Do not include `completedAt` in identity.
5. in one DB transaction:
   - detect duplicate/conflicting terminal event;
   - insert immutable event audit row if new;
   - monotonically reconcile deployment request terminal status;
   - insert/update Orchestrator-delivery outbox row;
6. commit;
7. outbox worker calls Provider external-event delivery facade with `workflow_session_id` and canonical event;
8. mark outbox delivered only after facade success.

## 6. Duplicate/conflict policy

- same terminal business content with a different timestamp: duplicate, harmless;
- same request with a different terminal `status`: `DEPLOYMENT_EVENT_CONFLICT`, do not forward;
- same request/release/status but different non-null externalRunRef: conflict;
- existing null externalRunRef may be enriched once by matching event/adapter response.

## 7. Outbox replay

The event audit + outbox must survive process crash between DB commit and Provider delivery. A replay function/worker SHALL resend pending rows until the Provider facade returns success.

Provider semantics:

- existing matching `event:<eventId>` receipt -> prior success;
- active Session -> normal receiveExternalEvent;
- terminal/closed Session with no prior receipt -> persist a receipt/equivalent delivery record for that exact request hash and return `terminal_ignored` success;
- same command ID, different payload -> idempotency conflict, including after a prior `terminal_ignored`.

## 8. Event payload -> workflow

The WaitEvent result is the event payload/result used by downstream binding. `18-route-deployment-event` binds `/status` and has branches:

```text
succeeded -> verification
failed    -> terminal deployment_failed
cancelled -> terminal deployment_failed
```

A succeeded callback never establishes Deployment State by itself. Independent `deployment.verify` and `deployment.record` remain mandatory.

## 9. Deployment State semantics

Deployment semantic state is:

```json
{"target":"production","releaseId":"..."}
```

`verificationRef` is evidence/provenance, not semantic state identity. Persist it in Proposal assessment/provenance (for example `assessmentRefs.verificationRef`) and the typed deployment row as needed, but exclude it from `payload.state` semantic identity/hash. Commit validation requires the Proposal provenance verificationRef, not `payload.state.verificationRef`.

This keeps repeated verification of the same actual release no-op-safe (A22).

`deployment.record`:

- requires non-empty `verificationRef`; remove caller boolean `verified === true` gate;
- requires `state:read,state:propose,state:auto-decide,state:commit`;
- creates/reuses deterministic Proposal;
- on first Proposal creation, in one short DB transaction, resolves current Deployment head + `policy/deployment-production` and persists both expected head and policy dependency;
- retry of same Proposal does not re-resolve head/policy;
- automated Decision uses that policy dependency;
- commit conflict returns `conflict -> superseded`.
