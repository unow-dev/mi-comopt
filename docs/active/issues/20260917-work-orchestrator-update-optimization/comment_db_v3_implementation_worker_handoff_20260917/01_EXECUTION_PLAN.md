# 01 — Execution Plan

## Strategy

Implement v3 side-by-side. Preserve v2 business paths and frozen Definition hashes. Reuse low-level state/canonical/artifact primitives where behavior is backward-compatible; create v3-specific workflow/result/routing/promotion/deployment paths where semantics differ. Every merged sub-PR must leave `main` safe if later work never lands.

## Dependency order

- `PR0-A` — Freeze normative handoff and revision preflight; depends on nothing in this handoff.
- `PR0-B` — Implementation evidence ledger and normative lint; depends on `PR0-A`.
- `PR1-A` — Provider additive compatibility prerequisites; depends on `PR0-B`.
- `PR2-A` — V3 machine contracts and result validator; depends on `PR0-B`.
- `PR2-B` — V3 Definition, Session and terminal outcome; depends on `PR2-A`.
- `PR2-C` — Validated Human artifact completion; depends on `PR1-A`, `PR2-A`.
- `PR3-A` — V3 authority and application idempotency base; depends on `PR2-A`, `PR2-B`.
- `PR3-B` — Dependency-aware commit mode; depends on `PR3-A`.
- `PR3-C` — Classification v3 workflow services; depends on `PR2-C`, `PR3-A`, `PR3-B`.
- `PR3-D` — Keyword Selection v3 workflow services; depends on `PR2-C`, `PR3-A`, `PR3-B`.
- `PR3-E` — V3 agent adapter and capability wiring; depends on `PR3-C`, `PR3-D`.
- `PR4-A` — Deterministic Release v3 identity/materialization; depends on `PR3-E`.
- `PR4-B` — Promotion v3 Decision/CAS finalization; depends on `PR4-A`.
- `PR4-C` — Deployment v3 ledger, FIFO and outbox; depends on `PR4-B`, `PR1-A`.
- `PR4-D` — V3 runtime and full E2E integration; depends on `PR4-C`, `PR3-E`.
- `PR5-A` — Freeze v2 starts and drain; depends on `PR4-D`.
- `PR5-B` — Authority cutover and v3 start enable; depends on `PR5-A`.
- `PR5-C` — Production smoke and fix-forward controls; depends on `PR5-B`.

## Parallelism

After PR0-B, PR1-A and PR2-A can proceed in parallel. PR3-C and PR3-D can proceed in parallel after PR3-A/PR3-B and PR2-C. PR4-A/PR4-B/PR4-C are intentionally ordered because the authoritative identity flows Release -> Promotion Decision -> Deployment intent. PR5 begins only after all 79 mandatory verifications, including the four full E2E tests, have passing evidence.

## Merge invariant

Until PR5-B, production start registration continues to resolve normal Comment DB updates to revision 2. v3 may be built, validated, registered in test registries, and exercised against disposable/cloned DBs, but it must not become the production default.
