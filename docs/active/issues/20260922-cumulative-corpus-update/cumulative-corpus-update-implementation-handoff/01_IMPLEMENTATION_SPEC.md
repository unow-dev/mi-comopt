# Implementation Specification

## 1. 構成要素

| 境界 | 入力 | 処理要件 | 出力 |
|---|---|---|---|
| Corpus更新 | 現行Corpus v2、追加snapshot refs | 既存ref + 追加refを順序維持で累積。同一snapshot refは先勝ちunique。Corpus v1 headは通常更新禁止 | CorpusVersion v2 |
| Corpus投影 | CorpusVersion v2の順序付きsnapshot refs | corpus順→source_index順。5項目完全一致でfirst-win dedupe | survivor observations |
| Classification | survivors、直前ClassificationVersion | exact observation label→同一comment text label→human decision。未解決だけChatGPT対象 | survivor全件をカバーするClassificationVersion |
| Analysis Source | CorpusVersion、ClassificationVersion | survivor集合とclassification集合を完全一致検証。公開用source_indexを0..N-1へ再採番 | Source Dataset v2 |
| Analysis / Release | Source Dataset v2 | keyword/account/overview/commentsを同一sourceから生成。releaseで依存とSHAをfail-closed検証 | production Release |
| Recovery | 正常base CorpusVersion、broken head | 承認済み範囲を累積復旧。既存classificationを可能な限り復旧。真に未解決だけ再分類 | corrected Corpus v2 + Classification + Release |

---

## 2. Corpus state v2

### 2.1 Shape

```json
{
  "schema_version": 2,
  "snapshot_refs": [
    {
      "payloadSha256": "<64-hex>",
      "snapshotIndex": 0
    }
  ]
}
```

`evidence_ids`はcorpus semantic stateに含めない。Evidenceとの対応はcontrol planeに残す。

### 2.2 snapshot ref identity

```text
(payloadSha256, snapshotIndex)
```

### 2.3 Normal update

```text
nextRefs = uniqueFirst([
  ...prior.snapshot_refs,
  ...incoming.snapshot_refs
])
```

- priorは必ず先。
- incomingは後。
- 同一snapshot ref再投入は増えない。
- semantic stateが同一なら新CorpusVersionを作らない。
- headがschema v1なら`CORPUS_BOOTSTRAP_REQUIRED`で拒否する。
- headなしの場合はincomingからv2 genesisを作成可能。

### 2.4 typedCorpusHandler

`String(snapshotRef)`は禁止。object refは`[object Object]`になるため、`corpus_state_snapshots.snapshot_ref`へcanonical serializationを保存する。

例:

```text
canonicalJson({ payloadSha256, snapshotIndex })
```

authorityは`corpus_states.state_json`。`corpus_state_snapshots`はindex扱い。

---

## 3. Cumulative corpus projection

legacy `projectRawSnapshots()` の意味を変更しない。v3 cumulative path用に別関数を追加する。

推奨API:

```js
readSelectedSnapshotsInReferenceOrder(db, snapshotRefs)
projectCumulativeCorpus(snapshotBundles)
```

### 3.1 Ordering

1. `snapshot_refs`の保存順を維持する。
2. 各snapshot内は`source_index ASC`。
3. cumulative projectionではSHA sortを行わない。

### 3.2 Observation identity exposure

ordered readerが返すobservationには内部用に少なくとも以下を含める。

```js
{
  observationId,
  sourceIndex,
  username,
  handle,
  commentText,
  postedAt,
  postedDate
}
```

### 3.3 Dedupe

```text
key = exact tuple(
  username,
  handle,
  commentText,
  postedAt,
  postedDate
)
```

collision-freeなtuple encodingを用いること。separator文字列連結は使用しない。

```text
seen = Set()
survivors = []

for bundle in snapshotBundles in input order:
  for observation in source_index ASC:
    key = exactTuple(...5 fields...)
    if key in seen:
      skip
    else:
      seen.add(key)
      survivors.push(observation)
```

---

## 4. Classification

### 4.1 Authority

v3 cumulative pathのclassification authorityは以下のみ。

```text
classification_state_labels(version_id, observation_id, label)
```

以下をv3のauthorityにしない。

- `snapshot_comment_three_class_labels`
- `three_class_worksets`
- `three_class_workset_snapshots`
- DB全履歴を読む`readExistingCommentLabels()`

legacy CLI / legacy pathは削除しない。

### 4.2 Classification plan

prepareとassessが同一のpure plannerを使用する。

推奨新規module:

```text
src/three-class/cumulative-classification-plan.js
```

入力:

```text
cumulative survivors
prior pinned ClassificationVersion
optional human response
```

解決優先順位:

```text
1. 同一observationIdのprior label
2. prior classification内の同一comment text label
   - conflictは既存worseThreeClassLabel()ルール
3. 今回のhuman decision
4. unresolved
```

通常更新では**直前にpinされたClassificationVersionだけ**をprior authorityにする。

### 4.3 Complete state

新ClassificationVersionは新規分だけではなく、cumulative survivor全件を含む。

必須不変条件:

```text
set(classification.observationIds)
==
set(cumulativeProjection.observationIds)
```

missing / extraのどちらもエラー。

### 4.4 ChatGPT対象

ChatGPT対象は、既存classificationから解決できないcommentのみ。

同一comment textのunresolvedはcomment text単位で一意化し、cumulative projectionでの初出順にitem化する。

### 4.5 ChatGPT handoff safety assertion

handoff artifact確定直前に必ず再検証する。

```text
for every ChatGPT workset item:
  priorExactLabel(observationId) == none
  AND
  priorCommentLabel(commentText) == none
```

違反が1件でもあればhandoff全体をfail closedする。

エラーコード:

```text
CLASSIFICATION_WORKSET_CONTAINS_PREVIOUSLY_RESOLVED_ITEM
```

エラー情報には少なくとも以下を含める。

```text
observationId
resolutionSource = exact_observation | existing_comment_text
```

comment本文を通常ログへ大量出力しない。

### 4.6 Human review

- human decisionが1件以上ある → review_required
- human decisionが0件で、全bindingがprior stateから決定可能、かつpolicyがauto commit許可 → system commit可

request側の自己申告だけでauto commitしてはならない。service自身がplanを比較して判定する。

---

## 5. Source Dataset v2

### 5.1 Shape

```json
{
  "schema_version": 2,
  "labeling_status": "published",
  "source": {
    "corpus_version_id": "<id>",
    "classification_version_id": "<id>",
    "snapshot_refs": [
      {
        "payload_sha256": "<64-hex>",
        "snapshot_index": 0
      }
    ]
  },
  "records": [
    {
      "source_index": 0,
      "username": "...",
      "handle": "...",
      "comment": "...",
      "postedAt": "...",
      "postedDate": "...",
      "label": "normal"
    }
  ]
}
```

### 5.2 Requirements

- `records`はcumulative survivor順。
- `source_index`はraw indexではなくv2 dataset内0-based連番。
- internal `observationId`は公開datasetへ出さない。
- label setとsurvivor observation setは完全一致必須。

```text
projection survivor count
=
classification label count
=
source dataset record count
```

### 5.3 Artifact identity

logical identityは少なくとも以下で決定的に生成する。

```text
corpusVersionId
classificationVersionId
```

byte identityはSHA-256をauthorityとする。

---

## 6. Downstream analyses

Keyword / Account / Overview / Commentsはsnapshotを独自に読み直さず、同じSource Dataset v2をauthorityとする。

```text
Source Dataset v2
  ├─ Keyword analysis/publication
  ├─ Account analysis
  ├─ Overview
  └─ Comments artifact
```

production operatorのsingle `--snapshot-ref`経路と`corpusSnapshotRef()`前提を撤去する。

---

## 7. Release integrity gate

### 7.1 Cross-pin validation

release build時に最低限以下を確認する。

```text
classification.dependencies.corpus
== release.corpusVersionId

keyword.dependencies.corpus
== release.corpusVersionId

keyword.dependencies.classification
== release.classificationVersionId
```

不一致ならreleaseを構築しない。

### 7.2 Source identity validation

materialize前後で以下をfail closedにする。

- Source Dataset v2 SHA == Keyword source dataset SHA
- Comments artifact == Source Dataset v2 bytes
- Overview / Account artifactsが同じsource dataset identityから生成されている
- release pinsから再生成した成果物のみをproduction authorityとする

### 7.3 Caller artifact override

production `ReleaseApplicationServiceV3.materialize()` の `request.artifacts` overrideは撤去する。

test injectionはconstructorの`artifactBuilder`等で行う。

### 7.4 UI release manifest

single `snapshot_ref`をsource authorityにしない。

少なくとも以下をpinする。

```text
corpus_version_id
classification_version_id
keyword_selection_version_id
source_dataset_artifact_sha256
```

raw snapshot provenanceはSource Dataset v2の`snapshot_refs`から追跡する。

---

## 8. Existing v1 compatibility

採択方針:

```text
v2-only writer + legacy v1 verifier
```

- 新production flowはsource dataset v1を生成しない。
- 新production flowはv1をsourceとして受けない。
- 既存公開v1 releaseのverification readerは残してよい。
- v1/v2を同時に正本として出力しない。

---

## 9. Recovery bootstrap

すでにcurrent corpus headから旧24,622件等が脱落している場合、通常update修正だけでは復旧しない。

Recoveryは通常更新と分離する。

必須入力:

```text
baseCorpusVersionId
brokenHeadCorpusVersionId
```

自動で「全履歴union」しない。

### 9.1 Recovery range

```text
baseCorpusVersion
+
baseより後、broken headまでのcommitted corpus versions
```

各versionのsnapshot refs:

- schema v1: 旧挙動を再現して`payloadSha256 ASC, snapshotIndex ASC`
- schema v2: state保存順

versionは`version_no ASC`で累積し、snapshot ref自体をfirst-win uniqueする。

### 9.2 Recovery classification

1. recovery corpusをprojectionしてsurvivor observation IDsを確定。
2. survivor IDだけについてclassification historyを検索。
3. 同一observationIdが複数versionにあれば最新`version_no` labelを採用。
4. observationIdで復旧できなければhistorical同一comment text labelを既存ルールで継承。
5. なお未解決だけChatGPTへ送る。
6. 新ClassificationVersionはsurvivor全件を含む。

historical scanはRecovery専用。通常更新へ持ち込まない。

---

## 10. Production cutover / failure behavior

production semantics変更はatomicにcutoverする。

ただし単一DB transactionではなく、**外部可視性atomic・内部はfreeze下で再開可能**とする。

- freeze
- drain
- bootstrap / cumulative state construction
- classification
- source dataset / analyses
- corrected release
- deploy
- verify
- starts再開

途中失敗時に欠落した旧releaseを正しい状態としてrollbackしない。freezeしたままfix-forward/retryする。
