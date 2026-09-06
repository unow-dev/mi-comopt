# Worker checklist

## Before coding

- [ ] Read issue freeze requirements.
- [ ] Verify actual repository v1.4 integrity; resolve whether supplied snapshot mismatch is snapshot-only.
- [ ] Capture actual v1.4 tree hash baseline without modifying it.
- [ ] Confirm current operational Stage13 reference and golden/P2 state paths.
- [ ] Confirm existing v1.4 tests pass in actual repository environment.

## PR1

- [ ] sibling v1.5 created
- [ ] v1.4 unchanged
- [ ] pipeline version 1.5.0
- [ ] three-class policy version remains 1.4.0
- [ ] v1.5 manifest correct
- [ ] semantic parity tests pass

## PR2

- [ ] prepare command only reads operational state
- [ ] atomic workspace
- [ ] snapshots/bindings
- [ ] exact Stage13 dedupe only
- [ ] normal/nuisance branch precomputation
- [ ] exact record_key T tasks
- [ ] P2 excluded from mandatory work
- [ ] request_id/manifest
- [ ] one ZIP transport
- [ ] zero-human auto-final path

## PR3

- [ ] strict response parser
- [ ] exact coverage
- [ ] active/inactive T validation
- [ ] notes required
- [ ] reason mapping reused
- [ ] full preflight before acceptance
- [ ] accepted response immutable
- [ ] conflict-aware golden merge
- [ ] atomic commit/final
- [ ] retry without re-review
- [ ] v1.4 compat export

## PR4

- [x] explicit `{1.4.0,1.5.0}` downstream whitelist
- [x] mixed versions reject
- [x] shadow parity
- [x] fallback parity with 0 re-review
- [x] account/release tests

## PR5

- [x] all PR1-PR4 gates pass before cutover
- [ ] only Stage13→strict Three-Class recurring block replaced
- [x] v1.4 retained
