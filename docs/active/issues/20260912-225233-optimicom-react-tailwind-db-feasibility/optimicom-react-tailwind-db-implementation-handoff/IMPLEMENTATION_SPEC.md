# Implementation Specification

## 1. Purpose

`docs/active/temp/optimicom-react-tailwind` を、sample/static business valuesに依存するUIから、Comment DBをauthoritative sourceとするproduction read-only UIへ移行する。

Phase 1は既存DBで完全に裏付けられる3分類と既存candidate policyだけを対象にする。

### In scope

- Home
- 分析概要（Overview）
- コメント一覧
- フィルターキーワード候補
- ブロックアカウント候補
- DB → deterministic UI publication
- UI用release verification
- browser-local action state
- target UI tests

### Out of scope

- 6分類
- new labeling model / relabeling
- Optimicom Score / GOOD / health score
- AI-generated summary or recommendations
- account high/mid risk model
- TikTok API連携または外部適用状態の確認
- server/API backend導入
- browserからSQLiteを直接読むこと
- deep-link router導入
- 既存 `data-release.json` schema v1のmigration/replacement

---

## 2. Source-of-truth and release boundaries

### 2.1 DB authority

Comment DBがauthoritative sourceである。

「DB正本」は、browserがDBを直接読むことを意味しない。UIはDBから決定的に生成されたread modelを読む。

### 2.2 UI runtime release root

対象UI専用のruntime anchorとして次を新設する。

```text
optimicom-ui-release.json
```

このファイルは対象UIにとって唯一のrelease rootである。

既存の次の契約はそのまま維持する。

```text
data-release.json (schema_version = 1)
publish:joint-data
verify:release
verify:deployed-release
```

同一consumerに複数release rootを持たせない。一方、別consumerの既存release契約を今回のUIへ無理に統合しない。

### 2.3 Single source snapshot

Phase 1 UI全画面のsource snapshotは、DB-current `keyword_candidate_publications` rowの `snapshot_id` が指す**単一snapshot**とする。

Overview / Comments / Accountsはこのsnapshotだけから導出する。Keywordsは同じcurrent publicationの `filter_keyword_candidates_json` を使う。

DB全体の「より新しい別snapshot」を画面ごとに混ぜてはいけない。

---

## 3. DB schema and database opening

### 3.1 Required schema

UI publication生成には `PRAGMA user_version = 8` を必須とする。

現行application constantは `APPLICATION_SCHEMA_VERSION = 8`。migration 008は `three_class_workset_excluded_comments` を追加する。

### 3.2 Explicit migration step

既存 `openCommentDatabase()` は古いDBを自動migrationするため、UI exportから使用してはいけない。

実装に、migrationだけを明示的に実行できるentrypointを追加する。推奨CLI契約:

```text
npm run comment-db -- migrate [--db path.sqlite3]
```

このcommandは既存 `openCommentDatabase()` を用いてpending migrationsを適用し、schema version 8を確認してcloseする。既存の他commandのauto-migration behaviorはこのissueで壊さない。

### 3.3 Read-only database helper

UI exporter用にread-only専用open pathを追加する。名称は変更可能だが意味は固定する。

Required behavior:

```text
DatabaseSync(path, { readOnly: true })
PRAGMA user_version == 8, otherwise fail
PRAGMA foreign_keys = ON / verification as appropriate
no mkdir
no migration
no INSERT/UPDATE/DELETE/DDL
```

export開始後の読み取りは1つのSQLite read transaction内で行う。

```text
BEGIN
  read schema/current publication/snapshot/observations/labels
COMMIT
```

transaction外から同一releaseのDB dataを継ぎ足してはいけない。

---

## 4. Current publication and snapshot verification

read transaction内で `readCurrentKeywordCandidatePublication(db)` 相当を使う。

Failure conditions:

- current publicationが0件
- current publicationが複数件（DB constraint/状態異常）
- publication.snapshot_idが存在しない
- snapshot raw input integrityが壊れている
- snapshot `loaded_count` とobservation countが不一致
- source indicesが0..N-1で連続していない
- 3-class label countがobservation countと不一致
- labelが `direct_nuisance | reactive | normal` 以外

snapshotのidentityはDB内部 `snapshot_id` をruntime public identityにせず、次で表現する。

```json
{
  "payload_sha256": "<64 lowercase hex>",
  "snapshot_index": 0
}
```

---

## 5. Deterministic source dataset

既存keyword-candidate handoff契約と**同一shape・key order・serialization**を使う。

```json
{
  "schema_version": 1,
  "labeling_status": "published",
  "snapshot_ref": {
    "payload_sha256": "<64 lowercase hex>",
    "snapshot_index": 0
  },
  "records": [
    {
      "source_index": 0,
      "username": "...",
      "handle": "...",
      "comment": "...",
      "postedAt": "...",
      "postedDate": "...",
      "label": "direct_nuisance"
    }
  ]
}
```

Rules:

- `records`は `source_index ASC`。
- observation fieldsは `readSelectedSnapshots()` の既存shapeを利用する。
- labelは `readSnapshotThreeClassLabels()` から結合する。
- `observation_id`, `comment_pk`, synthetic id, `workset_id`を追加しない。
- serializerは既存 `prettyJson()`。
- exact UTF-8 bytesをsource dataset artifact bytesとする。

SHA:

```text
source_dataset_artifact_sha256 = "sha256:" + SHA256(exact bytes)
```

この値はcurrent publication rowの `source_dataset_artifact_sha256` と完全一致しなければならない。不一致ならpublicationをfail closedする。

`source_dataset`のexact bytesをComments artifactとしてそのまま公開する。UI専用comments business schemaへ再変換しない。

---

## 6. Keyword artifact

### 6.1 Source

DB-current publicationの次を使う。

- `filter_keyword_candidates_json`
- `current_meta_json`
- `run_manifest_json`（必要なcross-check用）
- publication row `run_id`, `published_at`, `applied_at`

### 6.2 No re-ranking / no business transformation

`filter_keyword_candidates_json` をparseして既存keyword artifact invariantsを確認するが、候補のbusiness dataを別schemaへ再生成しない。

公開artifactのcandidate orderはDB-current publicationの配列順を維持する。

candidate fieldsとして少なくとも既存contractの次をUIが利用できる。

```text
candidate_id
keyword
variants
category_id
category
recommendation
match_type
direct_nuisance_hits
reactive_hits
normal_hits
precision_excluding_reactive
direct_recall_contribution
normal_hit_rate
utility_score
introduced_at
```

### 6.3 Two kinds of hash

混同禁止。

1. Existing semantic content hash:

```text
current_meta.candidates_content_sha256
```

これは既存 `contentSha256(parsedCandidates)` と照合する。

2. Deployment artifact byte hash:

```text
artifact_sha256 = "sha256:" + SHA256(exact published file bytes)
```

`optimicom-ui-release.json` の `artifact_sha256` は後者を意味する。

### 6.4 Keyword recommendation UI

表示filter:

```text
すべて / 高推奨 / 中推奨 / 任意
```

`risk`へ変換しない。

詳細は自然言語AI理由を生成せず、既存の構造化根拠を表示する。

```text
category
D hit = direct_nuisance_hits
R hit = reactive_hits
N hit = normal_hits
precision_excluding_reactive
variants
```

### 6.5 NEW

UI presentation rule:

```text
isNew = introduced_at != null
        and 0 <= nowUTC - introduced_at < 14 * 24h
```

- `introduced_at = null` はNEWではない。
- browser clockを直接business functionへ埋め込まず、test可能なclock引数を持たせる。

---

## 7. Account candidate artifact

### 7.1 Reuse existing policy and pure function

新しいaccount risk/candidate algorithmを書かない。

Canonical policy:

```text
contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json
```

Existing semantics:

```text
candidate_label = direct_nuisance
minimum_behavior_events = 2
evidence_sample_size = 2
```

既存 `buildAccountCandidates()` と `validateCandidateArtifact()` を再利用する。

### 7.2 Required projection

source dataset objectを `buildAccountCandidates()` へ直接渡してはいけない。同functionはtop-level array + exact record keysを要求する。

source dataset recordsを `source_index ASC` と確認した後、**`source_index`だけを除去**する。

Input record:

```json
{
  "source_index": 0,
  "username": "...",
  "handle": "...",
  "comment": "...",
  "postedAt": "...",
  "postedDate": "...",
  "label": "..."
}
```

Projected record:

```json
{
  "username": "...",
  "handle": "...",
  "comment": "...",
  "postedAt": "...",
  "postedDate": "...",
  "label": "..."
}
```

その配列を既存policyへ渡す。dedup, behavior-event fingerprint, blank direct handle validation, threshold, evidence selection, candidate orderingは既存実装に任せる。UI exporterで再実装しない。

候補artifact fields:

```text
handle
direct_nuisance_count
evidence_sample[{ comment, postedAt, postedDate }]
```

候補件数を60へ固定しない。

### 7.3 UI semantics

- Search: handle部分一致。
- risk filterなし。
- pseudo avatarなし。汎用user iconのみ。
- 「投稿履歴」と呼ばない。
- modal title: **候補判定の根拠**。
- `evidence_sample` は完全履歴でも時系列履歴でもない。

---

## 8. Overview artifact

Overviewは同じsource datasetからのみ生成する。

### 8.1 Period anchor

基準日はsource datasetの `MAX(postedDate)`。

UI period:

```text
1日 / 7日 / 30日
```

「今日」「現在時刻」基準ではない。

各windowは基準日を含むcalendar-day window。

### 8.2 Missing vs zero

DBには「その日に本当に0件だった」ことを証明するcoverage contractがない。

したがって:

- その日付にobservationが1件以上存在し、あるlabel countが0 → 正しい `0`
- 日付自体にobservationがない → `unknown`, **0ではない**

### 8.3 Overview artifact schema

```json
{
  "schema_version": 1,
  "data_start_date": "YYYY-MM-DD",
  "data_end_date": "YYYY-MM-DD",
  "periods": {
    "1d": {
      "days": 1,
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "coverage": "complete",
      "observation_count": 123,
      "counts": {
        "normal": 100,
        "reactive": 20,
        "direct_nuisance": 3
      }
    },
    "7d": {},
    "30d": {}
  },
  "daily": [
    {
      "date": "YYYY-MM-DD",
      "observation_count": 12,
      "counts": {
        "normal": 10,
        "reactive": 1,
        "direct_nuisance": 1
      }
    },
    {
      "date": "YYYY-MM-DD",
      "observation_count": null,
      "counts": null
    }
  ]
}
```

Rules:

- `daily` は `data_end_date - 29 days` から `data_end_date` までexact 30 entries。
- observationなしの日は `observation_count=null`, `counts=null`。
- period `coverage` はwindow内すべての日にobservationがある場合だけ `complete`、1日でもunknownなら `partial`。
- period `observation_count` と `counts` は観測済み日の実レコードを集計する。partialでも数値は表示可能。
- `counts.normal + counts.reactive + counts.direct_nuisance == observation_count`。
- percentをartifactに保存しない。UIで `count / observation_count` から算出し小数1桁表示。
- `observation_count == 0` または数値を意味付けできない場合に架空割合を出さない。

### 8.4 UI copy

「総コメント数」は使わない。**対象観測数**と表示する。

`coverage=partial` なら **部分観測** を併記する。

---

## 9. UI release manifest

### 9.1 File name and schema

```text
optimicom-ui-release.json
schema_version = 1
```

Recommended exact shape:

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-13T00:00:00Z",
  "source": {
    "db_schema_version": 8,
    "snapshot_ref": {
      "payload_sha256": "<64 lowercase hex>",
      "snapshot_index": 0
    },
    "source_dataset_artifact_sha256": "sha256:<64 lowercase hex>",
    "keyword_publication": {
      "run_id": "run_...",
      "published_at": "...Z",
      "applied_at": "...Z",
      "candidates_content_sha256": "sha256:<...>"
    }
  },
  "policies": {
    "keyword": {
      "version": "1.0.0",
      "content_sha256": "sha256:<...>"
    },
    "account": {
      "version": "1.0.0",
      "content_sha256": "sha256:<...>"
    }
  },
  "artifacts": {
    "comments": {
      "path": "artifacts/source-dataset.<hex>.json",
      "artifact_sha256": "sha256:<hex>",
      "record_count": 0
    },
    "overview": {
      "path": "artifacts/overview.<hex>.json",
      "artifact_sha256": "sha256:<hex>",
      "record_count": 30
    },
    "keywords": {
      "path": "artifacts/filter-keyword-candidates.<hex>.json",
      "artifact_sha256": "sha256:<hex>",
      "record_count": 0
    },
    "accounts": {
      "path": "artifacts/account-block-candidates.<hex>.json",
      "artifact_sha256": "sha256:<hex>",
      "record_count": 0
    }
  }
}
```

Notes:

- `artifact_sha256` はexact file bytes SHA-256。
- pathはmanifestからのrelative same-origin path。absolute URL, `..`, query stringを許可しない。
- pathの `<hex>` はそのartifact exact byte SHAのplain 64-hex部分。
- `comments.record_count` = source dataset records length。
- `overview.record_count` = daily length = 30。
- `keywords.record_count` = candidate array length。
- `accounts.record_count` = candidate array length。
- 3-class labeling policy versionをDBが記録していないため、現在のrepository policy fileを過去labelのprovenanceとして**捏造してmanifestへ入れない**。exact source dataset SHAがUI release上の3-class provenance boundaryである。

### 9.2 Account policy hash

account `content_sha256` はcanonical policy fileのexact bytesをSHA-256し `sha256:` prefixを付ける。生成時にparse+`validatePolicy()`も通す。

keyword version/hashはDB current publicationのverified `current_meta_json` / existing contractから一致を確認して記録する。

---

## 10. Publication algorithm

Required logical algorithm:

1. Explicit migration stepが完了しschema v8であることを前提とする。
2. read-only DB open。
3. single read transaction開始。
4. current keyword publicationを読む。
5. publication.snapshot_idからraw snapshot refを解決。
6. existing snapshot integrity checksを利用してobservationsを読む。
7. 3-class labelsを読む。
8. deterministic source datasetを再構築。
9. source dataset exact byte SHA == publication source SHAを検証。
10. keyword DB JSON + current meta semantic hashを検証。
11. account projectionを作りexisting account policyで候補生成・validate。
12. Overviewを生成。
13. transaction終了。
14. exact bytes SHAを計算しcontent-addressed artifact namesを決定。
15. private temp directoryへ全artifact + candidate release manifestを作る。
16. temp内でmanifest/artifactsを再読込しvalidation。
17. targetのcontent-addressed artifactsを先にpublish。
18. 同名artifactが既に存在する場合、bytesが同一なら再利用、異なるならhash collision/integrity errorとしてfail。
19. `optimicom-ui-release.json` を最後にatomic replaceする。

partial publish後にmanifestが切り替わらなければ旧releaseは継続利用可能でなければならない。

同じDB state/policiesから生成した**4 data artifact bytesはdeterministic**であること。`generated_at` はrelease manifestだけに置き、data artifactへ混ぜない。

---

## 11. Required package commands

実装後、`package/package.json` に次の能力を提供する。script名は以下を推奨し、テスト/READMEも同じ名称に揃える。

```text
npm run export:optimicom-ui -- --db <path> --output-root <dir>
npm run verify:optimicom-ui-release -- --release <path/optimicom-ui-release.json>
npm run verify:deployed-optimicom-ui-release -- --url <deployment-base> --expected <local-release>
```

### Local release verifier

最低限:

- release exact schema validation
- source/policy field validation
- artifact path safety
- artifact file existence
- exact byte SHA match
- JSON parse/shape validation
- record_count一致
- comments source SHA == release source SHA
- overview invariants
- keyword semantic hash == release source keyword content hash
- account candidate artifact validation

### Deployed release verifier

最低限:

1. deployed `optimicom-ui-release.json` を取得。
2. expected local release bytesと一致確認（または明示的にexpected semantic identityを確認）。
3. manifest記載の全4 artifactを取得。
4. exact bytes SHAを計算。
5. manifest `artifact_sha256` と比較。
6. JSON parse/record_count/最低限shapeを確認。
7. 全件成功時のみdeployment verification success。

browserへ全artifact SHA再計算を要求しない。

---

## 12. UI runtime loading

### 12.1 Session pinning

app boot時に `optimicom-ui-release.json` を `cache: "no-store"` 相当で1回取得する。

そのrelease objectをbrowser session（page lifetime）のdata versionとして固定する。reloadするまで新releaseへ自動切替しない。

### 12.2 Lazy screen loading

Homeはrelease以外を必要としない。

各screen初回表示時に対応artifactをlazy loadし、以後memory cacheする。

```text
Overview → overview
Comments → comments/source dataset
Keywords → keyword candidates
Accounts → account candidates
```

一度正常取得したartifactを同page lifetime中に再取得しない。

### 12.3 Failure isolation

- release root取得/validation失敗: app data view全体をfail closed。sample fallback禁止。
- individual artifact失敗: 当該screenだけerror state。他screenは利用可能。
- error screenはretryを提供してよい。retryで成功後memory cacheする。
- loading中はscreen-local skeleton/loading。
- empty resultはerrorではなくempty state。

clientはschema/shape validationを行う。exact SHAのdeployment保証はpublication verifier/deployed verifierが担当する。

---

## 13. UI screen contract

### 13.1 Common labels

DB → Japanese UI:

```text
normal          → 通常
reactive        → 二次反応
direct_nuisance → 一次迷惑
```

### 13.2 Header/common shell

- notification bellを削除（契約なし）。
- `UI concept demo`, `sample data` 等のproduction不適切なfooter表記を削除。
- browser current timeを「最終集計日時」として表示しない。
- header primary data timestamp:

```text
データ基準日: YYYY-MM-DD
```

source = `overview.data_end_date` / source dataset max postedDate。

- Overview screen titleは「コメント欄のいま」のようなreal-time claimを避け、**分析概要**とする。

### 13.3 Home

Home copyはPhase 1の事実だけを説明する。

Required meaning:

> 通常・二次反応・一次迷惑の3分類によるコメント分析と、フィルター候補・アカウント候補を確認する。

6分類、AI recommendation生成、real-time監視を主張しない。

### 13.4 Overview

Remove completely:

- Optimicom Score
- `82 / 100`
- GOOD
- progress bar tied to score
- AI総評
- 前週比（契約未定義）
- Priority A/B/C recommendations
- 6-class chart/legend

Display:

- 1日 / 7日 / 30日 selector
- 対象観測数
- coverage status（partialなら「部分観測」）
- 通常 count + 1-decimal percentage
- 二次反応 count + percentage
- 一次迷惑 count + percentage
- 3-class composition chart
- 30-day daily trend with gaps for null days

null dayを0へplotしない。line chartはgapとして扱う。

### 13.5 Comments

Default filter: `すべて`。

Filters:

```text
すべて / 通常 / 二次反応 / 一次迷惑
```

Search target:

```text
comment + username + handle
```

Case-insensitive substringでよい。searchは全loaded datasetに対してfilter後paginationする。

Order:

```text
postedDate DESC
then source_index ASC
```

UI文言は「新しい順」ではなく **投稿日順（日単位）**。同一日内の正確な時刻順を主張しない。

Pagination: **50 records/page**。

Display fields:

```text
username
handle
comment
postedDate
postedAt
label
```

stable external comment IDを仮定しない。React key等のUI-local identityには `snapshot_ref + source_index` を使える。

pseudo avatarは使わずgeneric icon。

### 13.6 Keywords

- candidate count = artifact length（固定12/86ではない）。
- filters = recommendation tiers。
- search = keyword / variants / category。
- NEW-only filterを提供。
- artifact orderを維持。UI独自business sortをしない。
- 「リスク」「候補理由AI文」は表示しない。
- copy success stateは **コピー済み**。
- 「追加済み」という語は禁止。
- copyという過去事実にundo UIを設けない。再copy成功時はcopied_atを更新可能。

### 13.7 Accounts

- candidate count = artifact length（固定8/60ではない）。
- search = handle部分一致。
- risk filter削除。
- display = handle, direct_nuisance_count, evidence。
- modal = **候補判定の根拠**。
- 完全履歴・投稿履歴を主張しない。
- copyとbrowser-local blocked markを別button/actionにする。
- generic icon、pseudo avatarなし。

常時見える説明:

> ブロック済みマークはこのブラウザ内の記録であり、TikTok上の状態を確認したものではありません。

---

## 14. Browser local state

Storage key:

```text
optimicom.actionState.v1
```

Schema:

```json
{
  "schema_version": 1,
  "keywords": {
    "<candidate_id>": {
      "copied_at": "UTC ISO-8601",
      "keyword_publication_run_id": "run_..."
    }
  },
  "accounts": {
    "<exact handle>": {
      "copied_at": "UTC ISO-8601 or null",
      "blocked_marked_at": "UTC ISO-8601 or null",
      "source_dataset_artifact_sha256": "sha256:..."
    }
  }
}
```

Semantics:

### Keyword

Clipboard API/fallbackが**実際に成功した後だけ** `copied_at` を保存する。

表示は「コピー済み」。外部filterへ追加済みとは扱わない。

### Account

Copy success → `copied_at`。

Userが別action「ブロック済みとしてマーク」を押した場合だけ `blocked_marked_at`。

blocked markはtoggle可能。解除時は `blocked_marked_at`だけ削除/null化し、`copied_at`は保持する。

### Persistence failures

- missing key → empty state。
- malformed JSON → emptyとして起動、一度nonfatal warning。次回成功saveでv1へ置換可。
- valid JSON but `schema_version !== 1` → read/writeを停止しlocal persistence disabled。未知versionを破壊しない。
- `SecurityError`, quota, access failure → persistenceだけdisabled。DB-derived screenは動作継続。
- candidateが次releaseで消えてもlocal stateを自動削除しない。再登場時にidentityが一致すれば復元可能。

localStorage内容がDB由来のcount/label/candidate inclusionを変えてはいけない。

---

## 15. Target UI testing

`optimicom-react-tailwind` にVitest + jsdomを追加する。

Required test classes:

- release client / session pinning
- screen lazy loading/cache
- manifest fatal failure
- artifact isolated failure
- Overview null-vs-zero / coverage
- Comments filters/search/pagination/order
- Keywords recommendation/NEW/copy semantics
- Accounts evidence/copy/blocked mark semantics
- localStorage malformed/unknown schema/access failure
- no sample fallback

Playwright E2EはPhase 1必須ではない。

---

## 16. Compatibility and non-regression

今回の実装は次を壊してはいけない。

- existing keyword candidate workflow
- Comment DB keyword publication apply/export
- account candidate workflow
- `data-release.json` schema v1
- `publish:joint-data`
- `verify:release`
- existing repository test suite

production target UI codeからsample business data dependencyは削除する。rollbackはprevious deploymentへ戻すことで行い、runtime feature flagで旧sample UIを温存しない。

---

## 17. Implementation rule for unspecified choices

このspecにない**business meaning**を実装者が追加してはいけない。

未定義の意味論が必要になった場合は仕様欠陥として止める。

次は通常の実装裁量:

- React component boundaries
- function/file names（明記されたpublic/CLI contractを除く）
- CSS spacing
- icon component details
- internal test helpers
- accessible markup improvements that do not alter business semantics

仕様変更が必要な場合は、先に本specとAcceptance Testsを同じ変更で更新し、その後codeを変更する。
