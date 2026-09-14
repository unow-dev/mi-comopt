# Comment DB-Centered Data Update / State Management — Normative Implementation Specification v2

## 1. Purpose

This specification defines the authoritative-state model and implementation boundaries for comment data updates, classification, filter-keyword selection, derived account-block candidates, release construction, production promotion, external deployment, and orchestration.

The system SHALL be understood as a system for **establishing and evolving authoritative state**, not as a generic ETL pipeline.

## 2. Non-negotiable principles

1. Observation does not mutate authoritative state.
2. Assessment does not mutate authoritative state.
3. A normal authoritative transition follows **Proposal -> Decision -> Commit**.
4. Commit is mechanical, guarded, atomic, and does not perform domain judgment.
5. `current` is a mutable head pointer to immutable history, never copied authoritative content.
6. Each State Stream has linear committed history. Competing proposals may branch; committed history does not.
7. Rollback creates a new State Version; a head is never moved backward to erase history.
8. Downstream processing uses explicit version IDs. A running business operation does not silently reread `current`.
9. Exact dependencies are part of state semantics and provenance.
10. Deterministically recomputable values without independent adjudication remain derived views, not independent authoritative state.
11. Release, Promotion, and Deployment are separate concepts.
12. Workflow state is operational truth; Comment DB state is business/domain truth.
13. No dual authoritative write path is permitted during migration.
14. Unverifiable historical transitions SHALL NOT be fabricated.
15. External side effects are not part of the Comment DB state transaction and must be idempotent/reconcilable.

## 3. Mental model

### 3.1 Knowledge / Commitment / Exposure

- **Knowledge:** evidence and observations the system possesses.
- **Commitment:** state the system has authoritatively adopted.
- **Exposure:** representations/releases served externally.

They advance independently.

### 3.2 Core objects

- **Evidence:** observed/received information.
- **Assessment:** interpretation or derivation from evidence + explicit state + policy.
- **Proposal:** immutable candidate authoritative change.
- **Decision:** immutable adjudication of a Proposal by an authorized human or system policy.
- **Commit:** guarded transaction that establishes a new State Version and advances the stream head.
- **Projection:** representation derived from exact authoritative versions.

## 4. State domains and streams

Authoritative versioned state SHALL exist for:

- Corpus
- Policy (separate streams as needed, including classification, keyword-selection, account-candidate)
- Classification
- Keyword Selection
- Promotion (per target/environment)
- Deployment (per target/environment)

Projection Definition SHALL be semantically versioned where mapping/schema/aggregation changes external meaning.

Release Bundle is an immutable aggregate of exact versions + Projection Definition. It is not itself a normal State Stream.

Account Candidate SHALL remain a derived view while it is deterministic from authoritative inputs and has no independent edit/approval semantics.

Example stream keys:

```text
corpus / comments
policy / classification
policy / keyword-selection
policy / account-candidate
classification / comments
keyword-selection / filter-keywords
promotion / production
deployment / production
```

## 5. State version semantics

Each State Version represents the complete logical state at that version, even if physical storage later uses deltas.

A State Version has:

- identity (`version_id`)
- stream
- monotonic `version_no` within stream
- semantic fingerprint
- origin kind
- creation time
- explicit dependencies

Semantic fingerprints SHALL NOT be globally unique in a stream. A legitimate rollback may revisit earlier semantics (`A -> B -> A`). No-op detection compares a proposal to the **current head semantics**, not all history.

Dependency and predecessor are different:

- predecessor is established by Transition (`from_version_id -> to_version_id`)
- dependency is a semantic input version

## 6. Proposal / Decision / Commit

### 6.1 Proposal

A Proposal SHALL include at minimum:

- `proposal_id`
- target stream
- `expected_head_version_id`
- exact dependency versions
- proposed semantic fingerprint
- immutable proposal payload with schema/version
- assessment/evidence references
- creation timestamp

An accepted stale Proposal is never edited or rebased. A new assessment/proposal/decision is created against the new head.

### 6.2 Decision

A Proposal has zero or one final Decision.

Decision fields include:

- `decision_id`
- `proposal_id` (unique)
- `outcome` = accepted/rejected
- authority kind/ref
- transition-policy version
- rationale
- decision timestamp

Absence of a Decision means no final adjudication yet. Do not model mutable `pending` Decision rows.

Automated adjudication uses the same Decision abstraction as human adjudication.

### 6.3 Commit

Only Commit Service may create committed State Versions/Dependencies/Transitions and update stream heads.

Generic guards include:

- Proposal exists and is immutable
- accepted Decision exists when required
- Proposal expected head equals actual head
- dependencies exist and satisfy generic integrity constraints
- proposed semantics differ from current head for a real transition
- domain handler validates typed payload and dependency roles

Successful commit is one DB transaction. For SQLite use a writer transaction appropriate for serialized head update (e.g. `BEGIN IMMEDIATE`). Never calculate `MAX(version_no)+1` outside that transaction.

## 7. Comment DB planes

Comment DB semantics are separated into three planes:

### Evidence Plane

Existing raw inputs, raw snapshots, observations, and imported source material.

### Authoritative State Plane

State Streams, Versions, Heads, Dependencies, Proposals, Decisions, Transitions, typed domain payload, Release Bundles, Promotion and Deployment states.

### Operational / integration provenance

Only domain-side operational data that cannot be delegated to `work-orchestrator`, such as application-operation idempotency receipts and deployment request references.

**Do not duplicate Work Orchestrator Session/Task/Execution/Wait state into Comment DB.**

## 8. Release / Promotion / Deployment

### 8.1 Release Bundle

A Release Bundle references exact state versions and a Projection Definition. It never resolves “latest” internally.

The same exact state set + projection semantics SHALL be deduplicated by bundle fingerprint and reused.

### 8.2 Promotion

Promotion State means the release desired for a target/environment. Production promotion requires human approval in v1 of this implementation.

Re-promoting the already desired release is a no-op and does not create a new Promotion Version.

### 8.3 Deployment

Deployment State means the release actually verified as served externally.

`desired=R12, actual=R11` is a valid state during pending/failed deployment.

An external deployment attempt never changes Deployment State by itself. Deployment verification provides the basis for an automated Proposal/Decision/Commit of Deployment State.

## 9. Architecture boundary with work-orchestrator

`work-orchestrator` SHALL be used to define and execute business workflows.

It owns:

- WorkDefinition/revision
- Session
- Task
- Execution
- Human Task lifecycle
- Wait/Event/Timer
- Task retry and manual intervention
- runtime history and receipts

Comment DB/Application owns:

- Evidence
- Assessment
- Proposal
- Decision
- authoritative Commit
- State Version / Dependency / Head / Transition
- Release Bundle
- Promotion State
- Deployment State
- domain idempotency receipt

The Orchestrator Registry and Comment DB SHALL remain separate persistence/authority boundaries.

## 10. WorkDefinition strategy

Production execution SHALL prefer Temporal-backed `work-orchestrator`; local/unit/acceptance semantics may use in-process `WorkOrchestrator`.

Do not build a second general-purpose workflow runtime in Comment DB.

The initial definitions are:

- `comment-data-update`
- `deploy-promoted-release`

A Session operates against pinned semantic inputs. Technical retry remains within the Session. A semantic head conflict ends that logical attempt as `superseded`; reevaluation starts a new Session with newly pinned versions.

## 11. Workflow routing semantics

Workflow `outcome` is used for routing; domain detail is stored in task result JSON.

Canonical workflow routing outcomes:

- `continue`
- `review_required`
- `rejected`
- `superseded`
- `blocked`
- `wait`
- `verify`

For example, both domain results `committed` and `unchanged` may route as `continue`.

Human review outcomes are exactly:

- `accept`
- `reject`

Human Task completion itself is not a Comment DB Decision. A finalize Application Service validates the actor against Transition Policy and records the formal Decision.

## 12. Input pinning

Head resolution happens before Session start (or at an explicitly defined new semantic boundary). Resolved version IDs are passed in Session input and then propagated through explicit step results/input bindings.

A running Session SHALL NOT silently adopt a newer head/policy/projection definition.

## 13. Application operation idempotency

Orchestrator command idempotency and Comment DB application idempotency are distinct layers.

Each side-effecting Application Service call receives a stable `operationId`:

```text
<sessionId>/<stepId>/<businessAttempt>
```

Technical retries reuse the same `operationId`. Semantic conflict starts a new Session, therefore a new operation identity.

Comment DB SHALL store completed operation receipts:

```text
application_operation_receipts
  operation_id        PRIMARY KEY
  operation_kind      NOT NULL
  request_sha256      NOT NULL
  result_json         NOT NULL
  completed_at        NOT NULL
```

Same operation ID + same request hash returns the prior result. Same ID + different hash fails with `IDEMPOTENCY_CONFLICT` and performs no mutation.

For state mutation, the domain mutation and completed receipt are committed atomically in the same Comment DB transaction.

Do not keep long-running external work inside a Comment DB transaction.

## 14. External side-effect idempotency

Deployment adapters SHALL expose “ensure” semantics, conceptually:

```text
ensureDeployment(deploymentRequestId, releaseId, target)
```

The same deploymentRequestId must identify one deployment intent across retries, using provider idempotency keys or reconciliation with existing external runs.

Release business artifacts SHALL use a release-owned artifact store/reference. `work-orchestrator` ArtifactStore may contain work/diagnostic artifacts, but is not the business authority for release artifact lifetime.

## 15. Retry and time budgets

Technical retry SHALL be controlled by Work Orchestrator TaskContract, not duplicated by an additional application retry loop. Temporal-level automatic retry SHALL not be increased in a way that creates layered opaque retries.

Normative initial values are defined in `02_WORK_ORCHESTRATOR_FLOW.md`.

Human approval has no business timeout in this handoff. If future SLA/expiry is required, it is a new workflow-contract change and Definition revision.

## 16. Migration

Use domain-by-domain strangler migration with single authority at every point.

Lifecycle:

```text
Legacy -> Backfilled -> Verified -> Cutover -> Legacy Read Compatibility -> Retired
```

No authoritative dual-write.

Where legacy history is insufficient, create a Genesis Version at migration time with `origin_kind=genesis_migration`. Preserve prior files/timestamps/artifacts as evidence/provenance; do not fabricate Decisions/Transitions.

Migration order:

```text
0. State Control Plane
1. Corpus semantics
2. Policy registration/versioning
3. Classification
4. Keyword Selection
5. Release Bundle
6. Promotion
7. Deployment
8. Legacy authority removal
```

Account Candidate remains derived.

## 17. Definition revision policy

Registered WorkDefinition revisions are immutable.

Increase revision if canonical definition hash changes, including changes to graph, step IDs, bindings, schemas, outcomes, capabilities, permissions, retry contract, or even other definition content that changes the hash.

Internal repository/SQL optimization that does not alter WorkDefinition does not require a Definition revision.

Projection semantic changes are versioned through Projection Definition, not WorkDefinition revision.

## 18. Compatibility adapter rule

Business semantics SHALL NOT depend on undocumented literals of `work-orchestrator` types.

Implement a narrow compatibility/builder layer that maps local workflow semantics into public `work-orchestrator` TaskContract/Step types.

If a required semantic cannot be represented exactly by the installed library version, fail closed during definition build/validation. Do not silently approximate behavior.

All normal package imports use the public root entry point (`from "work-orchestrator"`).

## 19. Validation before registration

Every generated WorkDefinition SHALL pass:

1. TypeScript typecheck
2. `validateAndHashDefinition()`
3. snapshot/canonical-definition test
4. registration acceptance test

The generated, validated definition is the artifact that determines the immutable revision hash.

## 20. Completion criterion

Implementation is conformant only when all mandatory tests in `05_ACCEPTANCE_TESTS.md` pass, migration gates in `04_DB_SCHEMA_AND_MIGRATION.md` are satisfied, and no legacy direct-authority path remains after each stream cutover.
