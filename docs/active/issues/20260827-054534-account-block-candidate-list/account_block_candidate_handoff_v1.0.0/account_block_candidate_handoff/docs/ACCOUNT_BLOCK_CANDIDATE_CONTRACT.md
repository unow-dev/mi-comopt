# Account Block Candidate Contract

## 1. Purpose and authority

この文書はaccount block candidate workflowの**技術契約の正本**である。

- Product scope / acceptance: `../UPDATED_ISSUE_BODY.md`
- Current configurable values: `../config/accountBlockCandidatePolicy.json`
- Semantics / invariants / artifact contract: 本文書

これらに矛盾がある場合、実装者が優先順位を推測して進めてはならない。仕様不整合として修正してからmergeする。

## 2. Required inputs

Workflowの入力は次の4点とする。

1. published `three_class_labeled.json`
2. 対応する `summary.json`
3. `accountBlockCandidatePolicy.json`
4. 現在publish対象となるkeyword側 `filterKeywordCandidates.meta.json`

Account workflowは次を入力として使用してはならない。

- Stage13 raw / Stage13 labeled dataset
- `three_class_candidate.json`
- `audit_three_class.json`
- review queue / manual override files
- keyword taxonomy / registry / evaluator artifacts

### 2.1 Three-Class dataset schema

DatasetはJSON arrayで、各recordは次の6 fieldを持つ。

```text
username
handle
comment
postedAt
postedDate
label
```

5 source fieldはstringとして扱う。値はtrim、case conversion、日時parse、`@`除去等でnormalizationしてはならない。

`label` の許可値:

```text
direct_nuisance
reactive
normal
```

未知labelまたは必須field欠落はfail-closedとする。

### 2.2 Upstream summary gate

最低限、以下を検証する。

- `summary.final_published === true`
- `summary.final_output_sha256` が64桁hex SHA-256である
- dataset fileの実SHA-256が `summary.final_output_sha256` と一致する
- `summary.three_class_policy_version` がnon-empty stringである
- `summary.unresolved_optional_p2_reviews` が0以上の整数である

`unresolved_optional_p2_reviews > 0` はpublication blockerにしない。上流が `final_published=true` としたfinalを正式入力として受け入れる。

Upstream `summary.final_output_sha256` はbare hexを想定する。Account manifest/metaへ記録する際は `sha256:<hex>` 形式へ揃える。

## 3. Identity contract

### 3.1 Account identity

本dataset内では**exact `handle`**をaccount identityとする。

- `username` はidentityに使わない
- case-foldしない
- trimしない
- `@`を追加・削除しない
- 類似handleを統合しない

これはplatform上の永久不変account IDを保証するものではない。

`direct_nuisance` recordの `handle` が空文字または空白だけの場合はfail-closedとする。候補にすべき行為を黙ってdropしてはならない。

## 4. Behavior event contract

### 4.1 Definition

Account候補における1回の観測行為（behavior event）は、次のexact値で識別する。

```text
handle
comment
postedAt
postedDate
```

`username` はbehavior event identityに含めない。

### 4.2 Canonical event fingerprint

内部event fingerprintは次で計算する。

```js
sha256Hex(
  Buffer.from(
    JSON.stringify([handle, comment, postedAt, postedDate]),
    "utf8"
  )
)
```

Fingerprintは内部処理用であり、public candidate JSONへ出力しない。

### 4.3 Collapse and conflict

同じbehavior event fingerprintへ複数source rowが対応する場合:

- distinct labelが1種類のみ: 1 behavior eventへcollapseする
- distinct labelが2種類以上: 入力不整合としてfail-closedする

したがって、usernameだけが異なる同一event・同一labelは1 eventとして扱う。

`collapsed_source_rows` は次で定義する。

```text
source_record_count - distinct_behavior_event_count
```

## 5. Candidate policy

Current policy値は `accountBlockCandidatePolicy.json` を参照する。

Policy fileは最低限次を満たすこと。

- `schema_version === 1`
- `policy_version` がnon-empty string
- `candidate_label === "direct_nuisance"`
- `minimum_behavior_events` が1以上の整数
- `evidence_sample_size` が1以上の整数
- `evidence_sample_size <= minimum_behavior_events`

Candidate判定:

```text
for each exact handle:
  direct_events = distinct behavior events whose label == direct_nuisance
  candidate iff direct_events.length >= minimum_behavior_events
```

MVPでは `reactive` / `normal` はcandidate集合へ影響させない。

## 6. Evidence sampling

Public artifactへ全direct本文を複製しない。

各candidateについて、全direct behavior eventをevent fingerprintの昇順でsortし、先頭 `evidence_sample_size` 件だけを公開する。

このsampleは決定的であるが、次の意味を持たない。

- latest
- representative
- worst / severe

UIでは「根拠例」と表現する。

Public evidence field:

```text
comment
postedAt
postedDate
```

`username` は公開しない。`handle` はcandidate親要素にのみ保持する。

## 7. Candidate ordering

候補配列は次の順でcanonicalizeする。

1. `direct_nuisance_count` DESC
2. handle fingerprint ASC

Handle fingerprint:

```js
sha256Hex(Buffer.from(JSON.stringify([handle]), "utf8"))
```

Locale-dependent string collationをtie-breakに使わない。

## 8. Public candidate artifact

Filename:

```text
accountBlockCandidates.json
```

Schema:

```json
[
  {
    "handle": "example_handle",
    "direct_nuisance_count": 4,
    "evidence_sample": [
      {
        "comment": "...",
        "postedAt": "...",
        "postedDate": "..."
      },
      {
        "comment": "...",
        "postedAt": "...",
        "postedDate": "..."
      }
    ]
  }
]
```

Invariants:

- `handle` はnon-empty exact source handle
- `direct_nuisance_count >= minimum_behavior_events`
- `evidence_sample.length === evidence_sample_size`
- evidenceはすべて同じhandleの `direct_nuisance` behavior event由来
- `username`、`reactive_count`、`normal_count`、score、recommendation、subtypeは含めない

Candidate 0件は正常であり、正式workflowの結果として `[]` をpublishできる。

`[]` を「未生成」placeholderとして使用してはならない。

## 9. Serialization and content hashes

Account workflowが生成するJSONは次のbyte contractとする。

```js
JSON.stringify(value, null, 2) + "\n"
```

- UTF-8
- 2-space indent
- trailing newline exactly one

`accountBlockCandidates.json` は同じdataset bytes + policy bytes + generator semanticsに対して決定的でなければならない。run timestamp / run IDを含めない。

Account側manifest/meta内のhash文字列は原則として:

```text
sha256:<64 lowercase hex>
```

形式を使用する。

## 10. Run manifest

Filename:

```text
accountBlockCandidateRunManifest.json
```

Required shape:

```json
{
  "schema_version": 1,
  "run_id": "run_<uuid>",
  "run_type": "full_snapshot",
  "started_at": "<UTC ISO-8601>",
  "completed_at": "<UTC ISO-8601>",
  "published_at": "<UTC ISO-8601>",
  "outcome": "published",
  "source_dataset": {
    "artifact_ref": "upstream://integrated-labeling/three-class",
    "artifact_sha256": "sha256:<hex>"
  },
  "source_summary": {
    "artifact_ref": "upstream://integrated-labeling/three-class/summary",
    "content_sha256": "sha256:<hex>",
    "final_published": true,
    "three_class_policy_version": "<version>",
    "unresolved_optional_p2_reviews": 0
  },
  "candidate_policy": {
    "version": "1.0.0",
    "content_sha256": "sha256:<hex>"
  },
  "generator": {
    "version": "1.0.0",
    "content_sha256": "sha256:<hex>"
  },
  "statistics": {
    "source_record_count": 0,
    "distinct_behavior_event_count": 0,
    "collapsed_source_rows": 0,
    "direct_nuisance_event_count": 0,
    "candidate_count": 0
  },
  "artifacts": {
    "candidate_view": {
      "artifact_ref": "accountBlockCandidates.json",
      "content_sha256": "sha256:<hex>"
    }
  }
}
```

Notes:

- `run_id`: `run_` + UUID（`crypto.randomUUID()` 等）
- timestamps: UTC ISO-8601
- `generator.content_sha256`: 実行したaccount workflow generator script bytesのSHA-256
- `direct_nuisance_event_count`: collapse/conflict処理後のdistinct direct event総数
- `candidate_count`: public candidate array length

## 11. Public meta

Filename:

```text
accountBlockCandidates.meta.json
```

Required shape:

```json
{
  "schema_version": 1,
  "run_id": "run_<uuid>",
  "run_manifest_content_sha256": "sha256:<hex>",
  "published_at": "<UTC ISO-8601>",
  "candidates_content_sha256": "sha256:<hex>",
  "dataset_artifact_sha256": "sha256:<hex>",
  "three_class_policy_version": "<version>",
  "unresolved_optional_p2_reviews": 0,
  "candidate_policy_version": "1.0.0",
  "candidate_policy_content_sha256": "sha256:<hex>"
}
```

Bindings:

- `meta.run_id == manifest.run_id`
- `meta.published_at == manifest.published_at`
- `meta.candidates_content_sha256 == SHA256(accountBlockCandidates.json)`
- `meta.run_manifest_content_sha256 == SHA256(accountBlockCandidateRunManifest.json)`
- `meta.dataset_artifact_sha256 == manifest.source_dataset.artifact_sha256`
- `meta.candidate_policy_version == manifest.candidate_policy.version`
- `meta.candidate_policy_content_sha256 == manifest.candidate_policy.content_sha256`

## 12. Cross-view release invariant

同一UI release内で必ず:

```text
filterKeywordCandidates.meta.json.dataset_artifact_sha256
==
accountBlockCandidates.meta.json.dataset_artifact_sha256
```

とする。

特定の過去SHA値そのものをcontractへhard-codeしない。

現在のkeyword snapshotと同じsourceが取得できない場合は、account側だけ別snapshotへ進めてはならない。取得可能なpublished snapshotからkeyword/account双方を揃えて再生成する。

## 13. Workflow / publication transaction

Account workflowは単一の明示実行commandとして実装する。

推奨CLI形:

```bash
npm run account-candidate-workflow -- \
  --dataset /path/to/three_class_labeled.json \
  --summary /path/to/summary.json \
  --policy config/accountBlockCandidatePolicy.json \
  --keyword-meta src/data/filterKeywordCandidates.meta.json \
  --publish-dir src/data
```

処理順:

1. input files load
2. summary publication/hash validation
3. dataset schema/label validation
4. behavior event grouping
5. label conflict validation
6. direct blank-handle validation
7. candidate aggregation
8. deterministic evidence sampling / sorting
9. staging領域へcandidate/manifest/meta生成
10. internal hash binding validation
11. keyword/account dataset SHA一致確認
12. 成功した3 artifactだけをpublish-dirへ置換

途中失敗時に既存published account artifactsを変更してはならない。

Generator/build/browserがupstreamを自動fetchする必要はない。source fileは明示入力とする。

## 14. Fail-closed conditions

少なくとも次はnon-zero exitとし、publishしない。

- malformed input JSON
- datasetがarrayでない
- required field不足 / schema不正
- unknown 3-Class label
- upstream `final_published !== true`
- upstream final SHA mismatch
- invalid/missing required summary fields
- same behavior eventに複数distinct label
- `direct_nuisance` eventのblank/whitespace-only handle
- invalid policy
- candidate/meta/manifest内部hash不一致
- keyword/account dataset SHA mismatch

Candidate 0件はfailureではない。

## 15. UI contract

既存KeywordCard・recommendation UIは原則温存する。

最上位にview stateを追加する。

```text
keywords (default)
accounts
```

Account view:

- Eyebrow: `ACCOUNT BLOCK CANDIDATES`
- Heading: `アカウントブロック候補リスト`
- handle
- `direct_nuisance N件`
- `コピー`
- `根拠を確認`
- details: `根拠例 2件 / 計N件`
- evidence raw `postedDate` / `postedAt` / comment

Account viewではkeyword用recommendation tabsを表示しない。

Account candidateを「高推奨」「危険」「悪質度」等と表現しない。

空状態:

```text
該当するアカウント候補はありません
現在のデータでは、候補条件を満たすアカウントはありません。
```

Footer等もview別にし、account viewでkeyword candidate IDの説明を表示しない。

## 16. CI contract

通常CI:

```bash
npm test
npm run verify:data
npm run build
```

通常`build`は候補を再生成しない。upstreamをfetchしない。

`verify:data` は少なくとも次を確認する。

- committed account candidate/meta/manifestがparse可能
- candidate public schema/invariants
- candidate content SHA binding
- manifest content SHA binding
- manifest/meta run ID・policy・dataset binding
- manifest `statistics.candidate_count == candidate array length`
- keyword/account `dataset_artifact_sha256` 一致
- committed policy hash/versionとの整合

Candidate生成は明示的data-update作業でのみ行い、生成済みartifactをrepositoryへcommitする。
