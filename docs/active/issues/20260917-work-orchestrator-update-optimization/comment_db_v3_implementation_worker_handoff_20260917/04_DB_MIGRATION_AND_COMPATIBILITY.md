# 04 — DB Migration and Compatibility

## Chosen migration shape

Use a new additive migration contract `package/db/comment-database/010-comment-db-v3.sql` and mirror its idempotent CREATE TABLE/INDEX operations in the opt-in state-control-plane schema initializer as the repository currently does for migration 009. Do not destructively rewrite or reinterpret v2 rows. Keep existing `STATE_SCHEMA_VERSION = 1` because this handoff adds backward-compatible auxiliary tables rather than changing the meaning/shape required to read existing state-control-plane rows; a future incompatible state-control-plane migration must deliberately bump that version with an explicit migration.

## Required v3 tables

`release_identities_v3` maps `release_key` (PK) to one `release_id` (UNIQUE) plus canonical identity JSON and created timestamp. `deployment_target_sequences_v3` owns the next monotonic sequence per target. `deployment_requests_v3` owns v3 deployment intent and enforces `UNIQUE(promotion_decision_id,target)` and `UNIQUE(target,deployment_sequence)`. `deployment_completed_events_v3` stores immutable normalized terminal event receipts. `deployment_event_outbox_v3` stores provider delivery/reconciliation state with monotonic dispositions.

## Existing tables intentionally retained

`release_bundles`, `release_bundle_members`, `release_artifacts`, state streams/versions/proposals/decisions/transitions, and operation receipts remain shared primitives. Existing `deployment_requests`, `deployment_completed_events`, and `deployment_event_outbox` remain v2-only. Cutover does not require deleting them.

## Migration safety

Migration 010 must be idempotent, additive, and safe before v3 production enablement. PR4 tests must create/open databases both with and without existing v2 data, rerun the migration, and prove v2 queries and frozen Definition tests still pass. No data backfill from v2 deployment ledger into v3 ledger is required or allowed as authority.
