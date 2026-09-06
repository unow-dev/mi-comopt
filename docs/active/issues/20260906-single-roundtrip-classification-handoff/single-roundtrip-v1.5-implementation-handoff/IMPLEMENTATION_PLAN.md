# Implementation plan — PR boundaries

## PR1 — v1.5 parity scaffold

目的: 新protocolをまだ入れず、v1.4意味論をv1.5 siblingへ固定する。

作業:

- 実repositoryのv1.4 baseline integrityを確認。
- v1.4 treeをsibling `Integrated_Labeling_Handoff_v1.5.0/`等へcopy。
- v1.4 originalには変更を入れない。
- `VERSION=1.5.0`。
- `config/integrated_policy.json.pipeline_version=1.5.0`。
- `three_class_policy.policy_version=1.4.0`維持。
- v1.5 root manifestを実ファイルに対して正しく再生成。
- `--state-dir`解決をsingle-roundtrip用に実装可能なinternal abstractionとして準備。既存commandsの意味は変えない。
- v1.4/v1.5 semantic parity testを作る。

Gate:

- supplied snapshotのmanifest mismatchをv1.4改変で「修正」しない。実repo baselineを確認する。
- v1.4 tree bytes/hashがPR前後で不変。
- intended metadata差以外のStage13/Three-Class semanticsが一致。

## PR2 — prepare / handoff

実装:

- `prepare-single-roundtrip`
- atomic workspace creation
- snapshot + bindings
- Stage13 exact reuse/pending
- exact 5-field pending decision dedupe
- pendingのnormal/nuisance両branch Three-Class precompute
- exact reuse Stage13 recordのThree-Class precompute
- existing golden/P2 application
- unresolved mandatory exact `record_key` T-task generation
- P2 mandatory handoff除外
- request manifest/request_id
- copied prompts + orchestration instructions
- per-request response schema/template
- handoff ZIP transport
- human decisions=0 path

禁止:

- operational registry write
- new classification rules
- UI/reviewer helper

## PR3 — response / finalize / commit

実装:

- `finalize-single-roundtrip`
- strict duplicate-key JSON parsing
- structural + semantic validator
- Stage13 final assembly
- active/inactive T-task resolution
- exact `record_key` audit grouping
- reason_code -> label/rationale
- prospective golden
- strict Three-Class via internal helper（stdout抑制）
- integrated validate
- accepted response/receipt
- live golden conflict-aware merge
- atomic golden commit
- final artifact promotion
- single_roundtrip audit sidecar
- v1.4 compat exports
- retry/idempotency state transitions

## PR4 — downstream compatibility + shadow validation

実装:

- keyword candidate pipeline version explicit whitelist `{1.4.0,1.5.0}`
- summary/validation version equalityを独立検証
- downstream tests
- v1.4 accepted run -> v1.5 response reconstruction -> v1.5 finalize shadow replay
- Stage13/Three-Class semantic parity
- account/release end-to-end
- v1.4 fallback from accepted response

このPR時点ではproduction recurring runbookをv1.5 defaultへ変更しない。

## PR5 — cutover only

前4PRの全gate通過後のみ:

- v1.5側通常runbookの現行Stage13 prepare〜Three-Class strict final工程を
  `prepare-single-roundtrip -> one human handoff/response -> finalize-single-roundtrip`
  へ置換。
- candidate handoff以降は既存flowを維持。
- v1.4は削除しない。

## Review rejection criteria

テストが通っていても以下はreject:

- Stage13 keyword等による新自動確定
- Three-Classへのhandle/history/date意味入力
- unresolved P2のmandatory化
- goldenの別record_keyへのsemantic reuse
- exact 5-fieldを超えたStage13 dedupe
- v1.4 source変更
- accepted response後のmachine failureでhuman再review要求
- unknown pipeline 1.xのrange許可
- bootstrap/UI/refactorのscope追加
