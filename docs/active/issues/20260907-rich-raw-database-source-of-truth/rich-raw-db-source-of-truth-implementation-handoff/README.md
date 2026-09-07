# Implementation Handoff: rich raw DB source of truth

## Status

Decision status: **frozen for implementation**.

This handoff converts the discussion into an implementation contract. The worker should implement the decisions in this package rather than reopen the architecture unless a concrete repository constraint makes a decision impossible.

## Goal

For the **rich raw ingestion path**, make the Comment DB the authoritative store for the exact input bytes while preserving the existing normalized snapshot/observation tables used by downstream analysis.

The resulting data flow is:

```text
collector / adapter
  ├─ exact original input bytes
  └─ validated normalized snapshot materializations (1..N)
              │
              ▼
          Comment DB
          ├─ raw_inputs                    authoritative rich raw
          ├─ raw_snapshots                 derived snapshot materialization
          ├─ snapshot_video_observations   derived
          └─ snapshot_comment_observations derived
                       │
                       ▼
       username / handle / comment / postedAt / postedDate
```

## Non-goal that must remain a non-goal

Do **not** implement parsing for the production `new-comments.json` wrapper in Database or Processing. `ARCHITECTURE.md` assigns collector-specific parsing to Collector and explicitly says that implementation is not added here. This change must only make the DB boundary capable of accepting exact raw bytes plus one or more normalized snapshots.

The existing single-snapshot TikTok raw contract remains the compatibility adapter for `import-raw-snapshot`.

## Read first

1. `IMPLEMENTATION_SPEC.md` — frozen behavior and schema.
2. `MIGRATION_SPEC.md` — v2 → v3 backfill and migration mechanics.
3. `API_CLI_CONTRACTS.md` — function and command contracts.
4. `TEST_PLAN.md` — required regression and new tests.
5. `REVIEW_CHECKLIST.md` — reject conditions.
6. `SOURCE_MAP.md` — current implementation facts and affected files.
7. `DECISION_LOG.md` — why alternatives were rejected.

The `reference/` directory contains the supplied discussion set unchanged.

## Completion rule

The implementation is complete only when all acceptance criteria in `IMPLEMENTATION_SPEC.md` and all mandatory tests in `TEST_PLAN.md` pass.
