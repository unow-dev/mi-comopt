# Implementation Handoff: Comment DB 3-class labels → keyword-candidate handoff → DB → UI JSON

## Status

This handoff is implementation-ready. The design decisions are closed; do not reopen architecture unless the current repository contradicts an explicit assumption below.

Target issue: `Comment DBの3分類ラベルからChatGPT向けフィルターキーワード候補workset-handoffを生成する`.

## Required scope

Implement all three independent operational ranges:

1. Generate a candidate workset-handoff from exactly one Comment DB snapshot whose observations are fully labeled with the existing three classes.
2. After the existing candidate `full-update` has validated/evaluated/published a ChatGPT proposal, import that validated publication into Comment DB with provenance back to the snapshot and handoff.
3. Export the DB-current keyword-candidate publication to the existing UI file contract (`filterKeywordCandidates.json`).

Do not narrow the issue to only handoff generation.

## Architectural invariant

The existing immutable filesystem candidate publication remains the semantic source of truth for candidate state and lineage.

Comment DB is a verified durable mirror of publications that were explicitly applied to DB. It must not implement a second candidate state machine, evaluator, or complete publication-history authority.

This implies:

- candidate state transitions remain in the existing candidate workflow;
- DB import occurs only after a successful existing `full-update` publication;
- DB publication history may contain gaps;
- DB `current` may advance from A directly to C even if B was never mirrored into DB, provided filesystem publication C and its parent binding are valid;
- UI JSON is generated only from DB-current data, not directly from filesystem publication.

## Start here

1. Read `IMPLEMENTATION_SPEC.md` completely.
2. Use `SOURCE_MAP.md` to locate existing functions/contracts to reuse.
3. Implement in the sequence in `IMPLEMENTATION_SPEC.md` → “Implementation order”.
4. Satisfy every case in `ACCEPTANCE_TESTS.md`.
5. Do not add candidate-domain behavior to Comment DB beyond the explicit persistence/verification contract.

## Explicitly out of scope

- DB-side candidate `add/update/retire/reactivate` engine.
- DB-side re-evaluation implementation.
- New UI candidate schema or UI component changes.
- Mandatory binding to a three-class `workset_id`.
- Backfilling every historical candidate filesystem publication into DB.
- DB rollback/re-promotion of an old keyword-candidate run.
- A second handoff identity/provenance system beyond snapshot identity + dataset byte SHA + existing request fingerprint.
