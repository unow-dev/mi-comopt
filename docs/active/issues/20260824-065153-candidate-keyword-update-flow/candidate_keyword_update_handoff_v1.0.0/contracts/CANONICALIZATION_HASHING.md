# Canonicalization and Hashing

## Hash種類

- 外部3-class dataset: `artifact_sha256`。上流publication artifactの正式なartifact bytes/hashを参照。
- repo内構造化JSON: `content_sha256`。RFC 8785 JSON Canonicalization Scheme (JCS) のUTF-8 bytesにSHA-256を適用。
- prefixは常に `sha256:<64 lowercase hex>`。

保存場所 (`artifact_ref`) はcontent identityではないため、`input_fingerprint` の対象に含めない。

## input_fingerprint

次の意味オブジェクトをJCS化してSHA-256を計算する。

- prompt_contract_version
- output_schema_version
- base_run_id
- base_registry_content_sha256
- source_dataset_artifact_sha256
- candidate_view_content_sha256
- pre_evaluation_content_sha256
- evaluation_policy_version / content_sha256
- taxonomy_version / content_sha256

## Repository JSON formatting

hash用canonical bytesとGit上pretty JSONを分離する。Git上の生成JSONは共通formatterで、少なくともUTF-8、LF、2-space indent、末尾newline、NaN/Infinity禁止を満たす。

CIでは derived artifactについて (1) content hash一致、(2) formatterで再生成したbytes完全一致、の両方を確認する。
