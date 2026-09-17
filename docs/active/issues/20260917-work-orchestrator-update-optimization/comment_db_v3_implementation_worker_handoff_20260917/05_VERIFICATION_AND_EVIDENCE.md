# 05 — Verification and Evidence

The normative package contains **85 requirements** and **79 mandatory verification IDs**. `implementation-evidence-v3.json` is initialized from the exact normative traceability and is the only implementation-progress ledger in this package. Do not change `normative/.../traceability-v3.json` to record progress.

## Status transitions

Per requirement, status moves `not_started -> implemented -> verified`. `implemented` requires concrete implementation refs (commit/PR/file refs). `verified` additionally requires passing evidence for every mandatory verification ID attached to that requirement. If the normative handoff SHA changes or a relevant requirement is reissued, reset affected requirements to `not_started` and re-establish evidence.

## Test naming

Use existing Node test infrastructure. Every mandatory acceptance test title begins with its ID, for example `[V3-DEP07] Human accept conflict retains decision`. CI evidence should capture commit SHA, test ID, pass/fail, and workflow/job URL or local reproducible command. A passing test without its verification ID is not sufficient evidence.

## Gate closure

A PR0–PR5 owner gate closes only when all requirements owned by that gate are `verified` and all cross-cutting E2E IDs relevant to the gate have current passing evidence. PR5 cannot begin while any of the 79 mandatory IDs lack passing evidence on the candidate commit.

## Integrity checks

CI should verify the normative ZIP SHA, its internal manifest, exact 85-requirement coverage, exact verification coverage, no unexpected RFC-2119 obligations in supporting Markdown, frozen v2 Definition hashes, ticket-map requirement uniqueness, and evidence-ledger requirement equality with normative traceability.
