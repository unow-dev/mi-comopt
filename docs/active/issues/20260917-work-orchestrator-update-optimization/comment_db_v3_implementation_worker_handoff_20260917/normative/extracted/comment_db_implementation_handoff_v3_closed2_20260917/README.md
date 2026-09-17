# Comment DB / Work Orchestrator Implementation Handoff v3

Status: **implementation-ready normative handoff**  
Prepared: 2026-09-17  
Scope: Comment DB update architecture v3; `comment-data-update@TARGET_REVISION` plus unchanged `deploy-promoted-release@2`

## 1. Purpose

This package is the sole design/implementation handoff for the next Comment DB / Work Orchestrator update. It is self-contained with respect to the preceding design conversation and the v2 handoff. It intentionally reuses explicitly identified pre-existing repository protocols; where compatibility matters, `01` pins the repository baseline that defines the reused protocol.

The central change is that the operational business workflow is modeled explicitly: input-file receipt, external-LLM file handoff, human business decisions, authoritative Comment DB commits, release construction, production promotion, and deployment verification are separate boundaries.

## 2. Normative hierarchy

Normative obligations originate only from requirement IDs in `01_NORMATIVE_IMPLEMENTATION_SPEC_V3.md`. The following machine-readable contracts are normative because `01` explicitly incorporates them:

- `contracts/comment-data-update-v3-session-input.schema.json`
- `contracts/comment-data-update-v3-outcome.schema.json`
- `contracts/human-artifact-submission-result-v1.schema.json`
- `contracts/work-step-result-v3.schema.json`
- `contracts/work-step-result-v3-rules.json`

`V3-REQ-RESULT-002`, `V3-REQ-ART-011`, and the Session requirement block explicitly incorporate the terminal-outcome, Human-artifact-result, and Session-input schemas respectively. `05_ACCEPTANCE_TESTS_V3.md` defines mandatory verification for those requirements. `08_TASK_IO_AND_PERMISSION_MATRIX_V3.md` is the human-readable rendering of task inputs, permissions, outcomes, and permitted authoritative refs; when its result-ref summary conflicts with `work-step-result-v3-rules.json`, the machine-readable rules win.

`02`, `03`, `04`, `06`, and `09` explain implementation structure and sequencing but do not create additional normative obligations. `07_DECISION_LOG_V3.md` records rationale only. `references/` is historical/reference material only.

`traceability-v3.json` is a non-normative machine-readable index of normative requirements and verification coverage.

## 3. Revision policy

- `deploy-promoted-release` remains revision **2**.
- WorkDefinition `schemaVersion: 2` is distinct from WorkDefinition business revision.
- Existing registered revisions are immutable.
- The new update Definition uses `TARGET_REVISION`, resolved mechanically starting at 3: build/validate/hash a candidate at revision `r`; if registry slot `r` is absent, use it; if the registered hash equals the candidate hash, reuse it; otherwise increment `r` and repeat.
- Expected immutable v2 hashes:
  - `comment-data-update@2`: `77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`
  - `deploy-promoted-release@2`: `aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`
- The new Definition canonical hash is recorded only after the final tree passes provider `validateAndHashDefinition()`.

## 4. Business flow in one line

`Human update artifact -> Evidence -> Corpus Commit -> Classification handoff/decision/commit -> Keyword handoff/decision/commit -> Release -> Production review/promotion -> Deployment trigger/event/verify -> Deployment Commit`.

## 5. Read order for implementers

Read `01`, machine-readable `contracts/`, `02`, `08`, `03`, `09`, `04`, `05`, `06`, and finally `IMPLEMENTER_CHECKLIST.md`.

Do not treat the v2 handoff, archived handoffs, legacy publication paths, or source-context documents as new implementation authority.
