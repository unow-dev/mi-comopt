# Implementation Checklist

## Phase 1: Deterministic foundation

- [x] schemas/common + evaluation + taxonomy
- [x] evaluation policy/taxonomy versioned immutable files
- [x] normalization/matching implementation
- [x] rational threshold comparison
- [x] deterministic sorting/serialization/JCS hash
- [x] dataset consumer validator
- [x] unit/golden tests

## Phase 2: Bootstrap / publication / UI

- [x] candidate registry
- [x] bootstrap ID map validation
- [x] legacy variant structural canonicalization
- [x] v1.4 bootstrap regression
- [x] current meta / run manifest
- [x] publication transaction + stale parent
- [x] published JSON vNext
- [x] App candidate_id + NEW
- [x] legacy generator write path disabled
- [x] semantic updates frozen until Phase 3

## Phase 3: External LLM boundary

- [x] candidate view
- [x] pre-evaluation
- [x] generation request + fingerprint
- [x] prompt contract v1
- [x] proposal schema/lifecycle validation
- [x] canonical change set
- [x] full_update
- [x] legacy generator production code/assets removed

## Before merge/cutover

- [x] every generated artifact validates against the implemented contract validator
- [x] content hashes verify
- [x] derived artifacts reproduce byte-for-byte through formatter
- [ ] no direct manual edit can pass CI without matching run lineage
- [x] no candidate semantic update path remains outside proposal/change-set
