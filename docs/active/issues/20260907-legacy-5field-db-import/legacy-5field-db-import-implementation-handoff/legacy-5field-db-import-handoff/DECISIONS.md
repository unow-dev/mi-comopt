# Decision Record

このファイルは主要な分岐の勝敗だけを残す。実装仕様は`HANDOFF.md`を正とする。

| Question | Adopted | Rejected | Reason |
|---|---|---|---|
| missing rich values | SQL NULL | `""`, `0`, import time, guessed IDs | unknownとobserved empty/zeroを混同しない |
| model | strict discriminated union | one giant nullable rich DTO | rich contractを弱めない |
| discriminator | `materializationKind` | infer from inputFormat/video existence | generic semanticsを明示 |
| kinds | `rich-snapshot`, `comment-batch` | `legacy-*` names | `legacy`の意味衝突と時間依存命名を避ける |
| input format | `tiktokCommentBatch-1.0.0` | `tiktokLegacy...`, `tiktok5Field...` | format versionのschemaが5-fieldを定義する |
| top-level API | keep `snapshots` | rename to `materializations` | issue外breaking renameを避ける |
| Database dispatch | materialization kind | inputFormat | Collector形式をDBへ漏らさない |
| batch platform DB constraint | generic non-empty platform | `platform='tiktok'` SQL CHECK | TikTok固定はCollector責務 |
| mixed kinds in one raw input | allow | all-same-kind constraint | discriminatorはelement-local contract |
| batch unit | one raw file = one materialization | inferred multiple snapshots | sourceに境界情報がない |
| order | `source_index = array index` | content sort / dedupe | source orderをidentityとして保持 |
| duplicates | preserve | dedupe | observation semantics |
| video for batch | no row | dummy/nullable video row | videoを観測していない |
| masters for batch | no new master rows | synthetic identities | provenance捏造防止 |
| DB enforcement | row-local SQL + importer/verify | triggers or app-only | current architectureと複雑度のバランス |
| kind storage | parent `raw_snapshots` only | duplicate in child tables | state duplicationを避ける |
| public read model | no kind | expose kind to Processing | internal storage strategyをProcessingへ漏らさない |
| manifest kind | omit | add `materialization_kind` | `input_format`でprovenanceは十分 |
| manifest version | 3 | keep 2 | public provenance values gain `null` |
| projection version | keep 1.0.0 | bump | record shape/semantics are unchanged |
| sourceIndex in canonical comparison | include | rely only on ORDER BY | gap/corruption detection |
| videoObservationCount canonical field | do not add | add count | `snapshot_id` PK makes >1 impossible |
| existing legacy symbol renames | do not rename | cleanup rename | issue外差分を抑える |
| CLI | `import-comment-batch` | `import-legacy-comments`, aliases | stable concept name / smaller public surface |
