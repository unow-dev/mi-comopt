# Implementation Sequence and Handoff Gates

## Phase 0 — Test harness and compatibility adapter

Implement the narrow `work-orchestrator` compatibility/build layer first.

Deliverables:

- workflow policy/build helpers
- `comment-data-update` and `deploy-promoted-release` skeleton definitions
- definition typecheck/validate/hash/register tests
- FakeAgentAdapter acceptance harness where useful

Gate: Definition graph and stable IDs are testable before domain migration.

## Phase 1 — Generic State Control Plane

Implement generic tables/repositories/query services and Commit Service transaction boundary.

Deliverables:

- migrations for seven control-plane tables
- application operation receipts
- StateQueryService
- ProposalService
- DecisionService
- CommitService
- optimistic concurrency/no-op tests

Gate: generic state tests including rollback semantic reuse and stale proposal conflict pass.

## Phase 2 — Corpus + Policy

Reuse raw evidence structures and establish explicit Corpus adoption/state. Register versioned policies.

Gate: exact-version Corpus and policy reads work; no downstream component needs to infer policy/current implicitly.

## Phase 3 — Classification

Backfill Genesis from current labels, implement typed Classification State and Application Service assess/finalize.

Gate: semantic equivalence verified and legacy label writes no longer authoritative after cutover.

## Phase 4 — Keyword Selection

Decompose legacy keyword publication authority, backfill Genesis, implement assess/finalize and current-head usage.

Gate: no consumer treats `keyword_candidate_publications.is_current` or filesystem current as authority.

## Phase 5 — Derived account candidates

Refactor consumers to derive Account Candidate from explicit authoritative versions/policy. Do not create a state stream.

Gate: deterministic regeneration test passes.

## Phase 6 — Release and projection

Implement exact-version Release Builder, bundle dedupe, release artifact materialization/verification, Projection Definition usage.

Gate: `buildRelease` cannot resolve latest/current internally; same bundle is reused.

## Phase 7 — Promotion

Implement production Promotion stream and always-human production approval flow.

Gate: reject/no-op/conflict tests pass.

## Phase 8 — Deployment

Implement DeploymentAdapter ensure semantics, waitEvent integration, external verification, Deployment State recording, and recovery Definition.

Gate: crash-before-receipt, duplicate event, external failure, verification failure, already-deployed, and recovery tests pass.

## Phase 9 — Full workflow and Temporal-backed production integration

Connect workers/services to `work-orchestrator`, register definitions, run end-to-end acceptance matrix.

Respect current library Registry single-writer-host constraint.

Gate: A01-A32 all pass in the relevant environment set.

## Phase 10 — Legacy retirement

Remove/disable legacy authoritative writers/current readers only after stream-specific cutover gates pass.

Keep compatibility projections temporarily only where required by remaining consumers.

## Pull-request decomposition guidance

Prefer PRs aligned to the phases above. Do not combine workflow runtime replacement, every domain migration, and deployment cutover into one Big Bang PR.

A PR must not create dual authority as a temporary convenience.
