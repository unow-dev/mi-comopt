# Stable Failure Codes

- `UNSUPPORTED_SCHEMA_VERSION` (input): 対応していないschema version
- `ARTIFACT_HASH_MISMATCH` (input): artifact/content hash不一致
- `INVALID_DATASET_LABEL` (input): 3値以外のlabel
- `DATASET_COUNT_MISMATCH` (input): manifest件数と実データ件数の不一致
- `INVALID_DATASET_TOTALS` (input): D_total<=0またはN_total<=0等
- `REQUEST_ID_MISMATCH` (request): request/proposal request_id不一致
- `INPUT_FINGERPRINT_MISMATCH` (request): input fingerprint不一致
- `PROPOSAL_SCHEMA_INVALID` (proposal): proposal JSON Schema違反
- `UNKNOWN_CANDIDATE_ID` (proposal): update/retire/reactivateのIDが存在しない
- `INVALID_LIFECYCLE_TRANSITION` (proposal): active/retired状態に対してaction不正
- `NO_OP_UPDATE` (proposal): update後stateが現stateと同一
- `UNKNOWN_CATEGORY_ID` (proposal): taxonomy外category
- `EMPTY_VARIANTS` (candidate): variantsが空
- `EMPTY_NORMALIZED_STRING` (candidate): rawは非空でもnormalize後空
- `KEYWORD_NOT_IN_VARIANTS` (candidate): keywordのraw exact値がvariantsにない
- `DUPLICATE_NORMALIZED_VARIANT` (candidate): 同candidate内normalized variant重複
- `CROSS_CANDIDATE_VARIANT_CONFLICT` (candidate): base stateに存在しなかったactive candidates間normalized variant完全衝突
- `CANDIDATE_VIEW_MISMATCH` (request): candidate viewがbase registryから導出できない
- `PRE_EVALUATION_CANDIDATE_SET_MISMATCH` (request): pre-evaluation IDs != active candidate IDs
- `BOOTSTRAP_SOURCE_MISMATCH` (bootstrap): legacy source/index/contentがbootstrap mapと不一致
- `METRIC_INVARIANT_FAILED` (evaluation): D/R/Nからmetricを再計算して不一致
- `RECOMMENDATION_INVARIANT_FAILED` (evaluation): policyのtier判定と不一致
- `PUBLICATION_STATUS_INVARIANT_FAILED` (evaluation): D>=1 publish ruleと不一致
- `STALE_PARENT` (publication): base current/hashがpublication時currentと不一致
- `REGISTRY_RECONSTRUCTION_MISMATCH` (publication): base+change setからregistry afterを再現できない
- `PUBLISHED_SET_MISMATCH` (publication): active & D>=1集合とpublished JSONが不一致
- `DERIVED_ARTIFACT_MISMATCH` (publication): 再生成artifactとcommit済みartifactが不一致
- `PUBLICATION_TRANSACTION_FAILED` (publication): atomic publication transaction失敗

warning code体系はnormative contractに固定しない。warningはcandidate stateを自動変更してはならない。
