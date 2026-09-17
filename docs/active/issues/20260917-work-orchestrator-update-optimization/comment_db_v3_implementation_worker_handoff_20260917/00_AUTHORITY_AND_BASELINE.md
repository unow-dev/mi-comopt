# 00 — Authority and Baseline

## Authority

The normative authority is `normative/comment_db_implementation_handoff_v3_closed2_20260917.zip` with SHA-256 `0f7ff879a7233dda01da2016a315dc5e35e1a0d0535eee6a5cdc5e023ceabfcb`. The extracted copy under `normative/extracted/` is convenience-only and must be byte-equivalent to that ZIP contents. This implementation handoff is sequencing and code-placement guidance; it cannot weaken a normative requirement or mandatory acceptance test.

## Consumer repository baseline

Implementation gap analysis was performed against `unow-dev/mi-comopt@398a904069af3e5e1386e412811f9a8275af1d7a` (`feat: add state control plane migration runner`). `repo-baseline.json` records critical blob SHAs. If main has advanced, do not blindly reset it. Compare the drift against the surfaces in `03_FILE_FUNCTION_CHANGE_MAP.md`; update evidence with the actual starting commit and re-run affected v2 hash/regression tests before implementation.

## Provider baseline gate

The consumer declares `work-orchestrator` as `file:../../work-orchestrator/package`. The connected GitHub account did not expose a uniquely identifiable provider repository. Therefore PR1-A has a hard precondition: record the actual provider checkout path/repository and commit SHA in `implementation-evidence-v3.json`, then run provider compatibility tests from that baseline. Provider code must remain generic; Comment DB business semantics stay in the consumer.

## Frozen compatibility baseline

`comment-data-update@2` hash: `77c9696d045666987a39717462c49632c2551aca284f85191428cbb0f5e3c8b1`.  
`deploy-promoted-release@2` hash: `aff658401996e2682d444c2d0da645b4bc0e8a3b8d778c8efcdfb8b2ab27485c`.

Any change that alters these registered canonical Definitions is a stop-the-line regression.
