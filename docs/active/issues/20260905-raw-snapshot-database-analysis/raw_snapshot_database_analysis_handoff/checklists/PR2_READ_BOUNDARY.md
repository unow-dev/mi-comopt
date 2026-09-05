# PR2 checklist — DB read / analysis boundary

## Objective

Deliver:

```text
explicit DB snapshot set -> deterministic exact 5-field JSON + manifest
```

## Checklist

- [ ] repository query accepts explicit snapshot SHA set
- [ ] missing snapshot fails closed
- [ ] pure projection module has no SQLite import
- [ ] record mapping is exact five fields
- [ ] no trimming/normalization/fallback
- [ ] no dedupe/representative selection
- [ ] canonical snapshot order = SHA ASC
- [ ] canonical observation order = source_index ASC
- [ ] fixed JSON key order
- [ ] JSON serialization = 2 spaces + newline
- [ ] manifest v1 fields exactly per contract
- [ ] manifest has no generated timestamp
- [ ] manifest snapshot ranges are 0-based and contiguous
- [ ] output SHA hashes exact JSON bytes
- [ ] add `export-analysis-input` CLI
- [ ] require at least one SHA
- [ ] reject duplicate/invalid SHA CLI args
- [ ] export has no raw-root dependency
- [ ] fail if output or manifest target already exists
- [ ] test CLI SHA option order independence
- [ ] test DB import order independence
- [ ] test raw store missing but DB export succeeds
- [ ] test current Stage13 validator accepts output
- [ ] keep candidate/UI unchanged
- [ ] update integration issue/operation docs only to consume new JSON+manifest, without implementing merge logic here
- [ ] `npm test` green

## Review focus

- exact-five-key compatibility
- deterministic bytes
- no hidden latest/all selection
- no SQLite dependency in projection core
- no scope creep into integration/labeling
