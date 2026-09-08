# Acceptance Checklist

## CLI / selection

- [ ] `generate-three-class-workset` commandが追加されている。
- [ ] `--reference`と`--workspace`が必須。
- [ ] `--snapshot-ref`または`--snapshot-sha`を1件以上要求する。
- [ ] ref/SHAの混在を拒否する。
- [ ] duplicate selectorを拒否する。
- [ ] unknown SHAはfail-closed。
- [ ] multiple snapshotsに対応するSHAは`SNAPSHOT_SELECTION_AMBIGUOUS`相当でfail-closed。
- [ ] 一意なSHA selectorと等価なsnapshot-refで同じresolved selectionになる。
- [ ] selector指定順の違いがlogical worksetを変えない。
- [ ] unrelated snapshotをDBへ追加しても、明示resolved selectionが同じならworksetを変えない。

## Projection / provenance

- [ ] 既存`readSelectedSnapshots()` / `buildAnalysisArtifacts()` semanticsを再利用する。
- [ ] snapshot間はpayload SHA→snapshot index canonical order。
- [ ] snapshot内source orderを維持する。
- [ ] duplicate recordsを維持する。
- [ ] `export-analysis-input` outputと`provenance/analysis_input.json`がbyte-identical。
- [ ] `export-analysis-input` manifestと`provenance/analysis_input.manifest.json`がbyte-identical。
- [ ] provenance inputとpipeline`snapshot/input.json`がbyte-identical。
- [ ] projection manifest output SHAとrequest binding input SHAが一致する。

## Existing pipeline boundary

- [ ] Stage13 task generationを再実装していない。
- [ ] Three-Class task generationを再実装していない。
- [ ] `request_id`計算を変更していない。
- [ ] existing request package構造を変更していない。
- [ ] existing snapshot bindingsを変更していない。
- [ ] existing `classification_handoff_<request_id>.zip`を削除していない。
- [ ] existing `prepare_receipt.json`をwrapper都合で書換えていない。

## Workset ZIP

- [ ] ZIP名が`three_class_workset_<workset_id>.zip`。
- [ ] `README_FIRST.md`を含む。
- [ ] `workset_manifest.json`を含む。
- [ ] `provenance/analysis_input.json`を含む。
- [ ] `provenance/analysis_input.manifest.json`を含む。
- [ ] existing `request/**`の全regular filesを含む。
- [ ] `snapshot/**`を含まない。
- [ ] reference/registry/config/implementation snapshotsを含まない。
- [ ] `prepare_receipt.json`を含まない。
- [ ] inner `classification_handoff_*.zip`を含まない。
- [ ] finalization artifactsを含まない。
- [ ] symlink / path traversal / duplicate archive memberを拒否する。

## Workset manifest / identity

- [ ] `request_id`を既存request manifestから拘束する。
- [ ] manifest自身以外のtransport regular memberを全列挙する。
- [ ] 各memberにrelative POSIX path / SHA-256 / byte lengthがある。
- [ ] member orderがlexicalで決定的。
- [ ] `workset_id`がschema/protocol/request_id/member listのcanonical preimage SHA-256。
- [ ] ZIP container SHAをworkset identityにしていない。
- [ ] selector表記・temporary pathをidentityに含めていない。
- [ ] 同一5-field inputでもprovenanceが異なる場合、`request_id`同一・`workset_id`不一致のケースを検証している。

## Zero-handoff

- [ ] human decision 0件でもouter workset ZIPを生成する。
- [ ] existing `FINALIZED_NO_HANDOFF` behaviorを変更しない。
- [ ] zero-handoff worksetはclassification response不要とREADMEで明示する。
- [ ] S/T directory存在自体ではなくtask file数0で判定する。

## Atomicity

- [ ] final workspaceが既存なら上書き拒否。
- [ ] pipeline failureでfinal workspaceを残さない。
- [ ] integrity mismatchでfinal workspaceを残さない。
- [ ] packaging failureでfinal workspaceを残さない。
- [ ] final commit前に全integrity checksが完了する。
- [ ] success outputにstaging/temp pathを漏らさない。

## Compatibility / regression

- [ ] generated workspaceが既存`finalize-single-roundtrip`で変更なしに利用できる。
- [ ] `package`の既存Comment DB/export testsが通る。
- [ ] v1.5.0 existing single-roundtrip testsが通る。
- [ ] comment-batch E2Eを実pipelineで検証する。
- [ ] rich snapshot（またはmixed selection）でwrapperが既存projectionを不当に狭めていないことを最低1ケース確認する。

## Review gate

- [ ] 実装のためにv1.5 pipelineの意味変更をしていない。
- [ ] 実装のためにanalysis projectionの意味変更をしていない。
- [ ] canonical issueと異なる成果物境界を導入していない。
- [ ] 設計へ戻る条件に該当する問題が未解決のままmergeしない。
