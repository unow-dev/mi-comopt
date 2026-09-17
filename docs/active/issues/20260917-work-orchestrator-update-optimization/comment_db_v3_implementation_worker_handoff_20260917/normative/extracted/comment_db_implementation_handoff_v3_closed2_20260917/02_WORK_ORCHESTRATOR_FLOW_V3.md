# Work Orchestrator Flow v3

## 1. Definition identities

- `comment-data-update`: schemaVersion 2, `TARGET_REVISION` resolved by `V3-REQ-REV-007` (normally starts search at revision 3).
- `deploy-promoted-release`: unchanged revision 2.

## 2. Business flow

```text
00 receive update artifact (Human/file)
01 ingest evidence
02 update corpus
03a prepare classification handoff
  handoff_required -> 03b receive response
  reuse/ready_without_handoff -> no 03b
03 assess classification
  review_required -> 05 Human decision
06 resolve/finalize classification
07a prepare keyword handoff
  handoff_required -> 07b receive candidate proposal
07 assess keyword selection
  review_required -> 09 Human decision
10 resolve/finalize keyword selection
11 build release bundle
12 materialize release
13 propose production promotion
13-review Human production decision
14 finalize production promotion
16 trigger deployment
  wait -> 18 deployment.completed event
19 resolve/verify deployment
20 record deployment state
```

## 3. Join strategy

The provider tree has no general DAG join. v3 avoids duplicating downstream subtrees by using additive optional predecessor bindings (`InputBinding.optional`). Optional Human/Wait predecessors may be skipped, while downstream resolver steps have one stable physical Step ID.

### Classification

```text
03a
 -> choice: handoff_required => 03b; otherwise no-op
 -> 03
 -> choice: review_required => 05; otherwise no-op
 -> 06 resolver
 -> route 06 outcome
```

`06-finalize-classification` is a resolver/finalizer: if 03 already resolved unchanged/dependency-only state, 06 passes the resolved Classification Version through without new domain mutation; if 05 ran, 06 validates review and records formal Decision/Commit; if 03 became superseded, 06 returns superseded.

### Keyword

The same pattern is used by 07a/07b/07/09/10. `10-finalize-keyword-selection` always produces the resolved Keyword Selection Version on `continue`.

### Deployment

16 routes either to optional wait 18 or directly forward. `triggered` means the durable target-local deployment queue accepted the intent, not that the external provider already started it. Step 18 may end `succeeded`, `failed`, `cancelled`, or `superseded`. Step 19 resolves trigger/event context: `verify` verifies immediately; `wait+succeeded` verifies after event; event failed/cancelled returns deployment failure; superseded passes through without verification. Step 19 checks Promotion head before and after verification. Step 20 runs only after successful verification and applies the final Promotion-head plus deployment-sequence guards.

## 4. Terminal statuses

The v3 business terminal set is:

- `deployed`
- `change_rejected`
- `not_promoted`
- `superseded`
- `deployment_failed`

Terminal payloads are exact per `comment-data-update-v3-outcome.schema.json`: `change_rejected` includes `stage=classification|keyword-selection`; `superseded` includes `conflictAt=corpus|classification|keyword-selection|promotion|deployment`; the other three terminal statuses carry no stage/conflict discriminator. Step 20 uses `conflictAt=promotion` for its Promotion-head guard and `conflictAt=deployment` for an older deployment-sequence guard.

No formal reject path loops back inside the same Session.
