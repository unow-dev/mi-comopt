# Comment DB v3 — Implementation Worker Handoff

Status: **ready for implementation**  
Prepared: 2026-09-17  
Consumer baseline: `unow-dev/mi-comopt@398a904069af3e5e1386e412811f9a8275af1d7a`  
Normative package SHA-256: `0f7ff879a7233dda01da2016a315dc5e35e1a0d0535eee6a5cdc5e023ceabfcb`

## Purpose

This package is the execution handoff for implementing the already-closed Comment DB / Work Orchestrator v3 design. It does **not** replace or amend the normative specification. The normative authority is the exact ZIP under `normative/` and its extracted convenience copy. If implementation guidance conflicts with the normative package, the normative package wins.

The worker should not need the design conversation. Start with this file, then `00_AUTHORITY_AND_BASELINE.md`, `01_EXECUTION_PLAN.md`, `02_IMPLEMENTATION_TICKETS.md`, and `03_FILE_FUNCTION_CHANGE_MAP.md`. Keep `implementation-evidence-v3.json` updated in the implementation repository, not inside the normative handoff.

## Immediate start condition

Before coding, verify `MANIFEST.sha256`, verify the embedded normative ZIP hash above, confirm the consumer checkout is based on the recorded commit (or explicitly record/review drift), and pin the actual Work Orchestrator provider commit before PR1-A is allowed to reach `implemented`.

## Non-negotiable boundaries

- `comment-data-update@2` and `deploy-promoted-release@2` remain immutable; their frozen hashes must not change.
- `deploy-promoted-release` remains revision 2. Only `comment-data-update` gets `TARGET_REVISION`.
- v3 is side-by-side with v2 until cutover; do not retrofit v3 business semantics into v2 runtime paths.
- Shared changes are limited to backward-compatible primitives such as dependency-aware commit equality.
- No v3 production start is reachable before PR5. No legacy writer and v3 authority may be active together.
- Handoff/spec defects are fixed by reissuing a new immutable handoff/revision as required, never by silent implementer interpretation.

## Package map

`00_AUTHORITY_AND_BASELINE.md` fixes authority and repository baselines. `01_EXECUTION_PLAN.md` gives the dependency order. `02_IMPLEMENTATION_TICKETS.md` is the implementer work queue. `03_FILE_FUNCTION_CHANGE_MAP.md` identifies exact existing/new code surfaces. `04_DB_MIGRATION_AND_COMPATIBILITY.md` closes database migration choices. `05_VERIFICATION_AND_EVIDENCE.md` defines evidence handling. `06_CUTOVER_RUNBOOK.md` constrains production cutover. `07_PR_REVIEW_CHECKLIST.md` is the merge checklist. `ticket-map-v3.json` and `implementation-evidence-v3.json` are machine-readable companions.
