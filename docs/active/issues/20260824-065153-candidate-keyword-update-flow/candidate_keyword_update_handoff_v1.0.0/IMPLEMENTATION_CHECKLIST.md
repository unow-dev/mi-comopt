# Implementation Checklist

## Phase 1: Deterministic foundation

- [ ] schemas/common + evaluation + taxonomy
- [ ] evaluation policy/taxonomy versioned immutable files
- [ ] normalization/matching implementation
- [ ] rational threshold comparison
- [ ] deterministic sorting/serialization/JCS hash
- [ ] dataset consumer validator
- [ ] unit/golden tests

## Phase 2: Bootstrap / publication / UI

- [ ] candidate registry
- [ ] bootstrap ID map validation
- [ ] legacy variant structural canonicalization
- [ ] v1.4 bootstrap regression
- [ ] current meta / run manifest
- [ ] publication transaction + stale parent
- [ ] published JSON vNext
- [ ] App candidate_id + NEW
- [ ] legacy generator write path disabled
- [ ] semantic updates frozen until Phase 3

## Phase 3: External LLM boundary

- [ ] candidate view
- [ ] pre-evaluation
- [ ] generation request + fingerprint
- [ ] prompt contract v1
- [ ] proposal schema/lifecycle validation
- [ ] canonical change set
- [ ] full_update
- [ ] legacy generator production code/assets removed

## Before merge/cutover

- [ ] every generated artifact validates against schema
- [ ] content hashes verify
- [ ] derived artifacts reproduce byte-for-byte through formatter
- [ ] no direct manual edit can pass CI without matching run lineage
- [ ] no candidate semantic update path remains outside proposal/change-set
