# Current Baseline Facts

このファイルはhandoff生成時に同梱snapshotから確認した事実です。

## Integrated Labeling

`tests/run_all_tests.py`を実行し:

`ALL OK: 22 test groups`

log:
`evidence/integrated_labeling_tests.log`

## Current keyword publication

run ID:
`run_bf8163da-cc49-4549-a42a-f02636d4b97c`

published:
`2026-08-26T14:51:16Z`

dataset:
`sha256:b15bf5a4f431e56fb1d5b9e1490b94fbca3950ad596f4db142877c45bb0d95b3`

`run_manifest.parent_manifest_content_sha256`:
`null`

このnullをproduction full-updateで実parent SHAへ接続するのがPR2の対象です。

## Current account publication

run ID:
`run_3d717ec7-9fe7-4239-9f12-a79dac3279cb`

published:
`2026-08-27T00:21:19Z`

dataset:
`sha256:b15bf5a4f431e56fb1d5b9e1490b94fbca3950ad596f4db142877c45bb0d95b3`

keyword/accountは同じdataset SHAを指しています。

## Current account statistics

current manifest:
- source_record_count: 24,622
- distinct_behavior_event_count: 24,285
- collapsed_source_rows: 337
- direct_nuisance_event_count: 691
- candidate_count: 54

## Existing recurring-run notes

2026-08-26実績として既存文書に:
- raw: 24,622
- Stage 13 human adjudication: 3,190
- 3-Class mandatory review: 14
- published keyword candidates: 194

とあります。

ただしこの議論セットには当該runのraw/Stage13/three-class作業成果物そのものは含まれていません。bootstrap時に「それらしいファイル」を推測利用してはいけません。
