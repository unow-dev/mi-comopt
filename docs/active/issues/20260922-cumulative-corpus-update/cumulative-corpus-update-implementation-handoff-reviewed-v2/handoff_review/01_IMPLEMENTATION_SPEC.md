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
seen = Map()
survivors = []
dedupeGroups = []

for bundle in snapshotBundles in input order:
  for observation in source_index ASC:
    key = exactTuple(...5 fields...)
    if key in seen:
      dedupeGroups[seen.get(key)].observations.push(observation)
    else:
      groupIndex = dedupeGroups.length
      seen.set(key, groupIndex)
      survivors.push(observation)
      dedupeGroups.push({ key, survivor: observation, observations: [observation] })
```

通常の分析入力は`survivors`を使用する。Recoveryだけは、既存分類の再利用判定のため`dedupeGroups`も使用してよい。`dedupeGroups`は内部projection metadataであり、公開Source Datasetへ出さない。

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

必須validation:

- base / broken headは同一corpus stream。
- baseはbroken headのcommitted ancestry上に存在する。
- broken headはplan/start時点のcurrent corpus head。
- rangeはcommit transitionを連続して辿れること。

各versionのsnapshot refs:

- schema v1: 旧挙動を再現して`payloadSha256 ASC, snapshotIndex ASC`
- schema v2: state保存順

versionは`version_no ASC`で累積し、snapshot ref自体をfirst-win uniqueする。

Recovery planの件数は曖昧な`incomingCount`ではなく、次をauthorityとする。

```text
baseLogicalRecordCount
  = base refsだけをcumulative projectionしたsurvivor count

appendedRawObservationCount
  = baseより後に初出したsnapshot refsに含まれるraw observation count

duplicateObservationCount
  = appended observationsのうちfirst-win projectionでsurviveしない件数

expectedLogicalRecordCount
  = baseLogicalRecordCount
  + appendedRawObservationCount
  - duplicateObservationCount
```

今回の24,622 / 11,768 / 36,090は、この定義に実データが一致した場合のincident-specific evidenceであり、generic implementationへ固定値を埋め込まない。

### 9.2 Recovery classification

Recoveryでは「同一コメント」の採択済み定義である5-field exact dedupe groupも既存分類再利用のidentityとして扱う。

1. recovery corpusをprojectionし、survivorとdedupe groupを確定。
2. **recovery corpus内の各dedupe groupに属するobservation IDsだけ**についてclassification historyを検索。
3. group内にhistorical exact labelsがあれば、最も新しい`classification version_no`に存在するlabelをgroupのidentity labelとして採用する。同一latest version内で複数labelが衝突する場合のみ`worseThreeClassLabel()`で決定する。
4. group identity labelをfirst-win survivorへbindingする。これにより、dedupe loser側にしか過去labelがない場合でも同一コメントをChatGPTへ再投入しない。
5. identity labelで解決できないsurvivorについてのみ、**current recovery survivorsに復旧済みのidentity labels**から`commentText -> label` mapを構築し、既存`worseThreeClassLabel()`ルールで継承する。
6. identity labelもsurvivor-derived same-comment labelもないものだけChatGPTへ送る。
7. 新ClassificationVersionはsurvivor全件を含む。

DB-global historical comment labelは使用しない。historical scanはRecovery専用で、通常更新へ持ち込まない。

---

## 10. Production cutover / failure behavior

production semantics変更はatomicにcutoverする。

ただし単一DB transactionではなく、**外部可視性atomic・内部はfreeze下で再開可能**とする。

planned recoveryは既存`v3_frozen`を流用せず、cutover stateへ`recovery_frozen`を追加する。DB列はTEXTのためtable shape migrationは不要。

```text
smoke_verified --recovery_freeze--> recovery_frozen
recovery_frozen --recovery_cancelled--> smoke_verified   # mutating recovery stage開始前のみ
recovery_frozen --recovery_completed--> smoke_verified  # successful verify後のみ
```

- `recovery_frozen`ではnormal v3 startsを禁止する。
- `fix_forward_v3`は`recovery_frozen`から使用不可。
- データ変更開始後は`recovery_completed`だけがplanned recoveryを解除できる。
- `recovery_cancelled`はmutating recovery stage開始前だけ許可する。
- `recovery_completed`にはmatching successful verification receiptを必須とする。

処理順:

- freeze
- drain
- plan/head再検証
- bootstrap / cumulative state construction
- classification
- source dataset / analyses
- corrected release
- deploy
- verify
- starts再開

途中失敗時に欠落した旧releaseを正しい状態としてrollbackしない。`recovery_frozen`のままfix-forward/retryする。

さらに通常`start`にもpreflight guardを追加し、既存corpus headがschema v1ならsessionを作成する前に`CORPUS_BOOTSTRAP_REQUIRED`で拒否する。`CorpusApplicationServiceV3.update()`側の同じguardも残し、defense in depthとする。

---

## 11. Recovery classification authority clarification

RecoveryでDB全classification履歴をcomment text単位に直接集約してはならない。

採択する順序:

```text
1. cumulative projectionでcurrent recovery survivor + exact-dedupe groupsを確定
2. recovery corpus内のgroup member observation IDsだけhistorical labelsを検索
3. 各groupで最新classification version_noのlabelをidentity labelとして復旧
4. same latest version内でlabel conflict時のみworseThreeClassLabel()
5. identity labelをfirst-win survivorへbinding
6. recovered survivor identity labelsだけからcommentText -> label mapを構築
7. comment conflictは既存worseThreeClassLabel()
8. identity labelもsurvivor-derived comment labelもないものだけunresolved
```

これにより、(a) recovery対象corpus外の古いlabelの再流入を防ぎ、かつ(b) dedupe loser側にしか既存labelがない同一コメントの不要な再分類も防ぐ。

ChatGPT handoff safety assertionも同じauthorityを用い、`priorIdentityLabel == none AND priorCommentLabel == none`を要求する。DB-global `readExistingCommentLabels()`相当をRecoveryで使用しない。

---

## 12. Mandatory recovery CLI / production completion

`comment-data-update:v3`へtop-level `recovery` commandを追加する。

最低限のsubcommand contract:

```text
plan
start
status
resume
classification open|complete|review
keyword open|complete|review
verify
complete
```

`recovery verify`はstatus表示ではなく、corrected releaseが実際にdeployされた後に、DB state・generated artifacts・served deployment identityを再読込して不変条件をfail-closed検証するcommandとする。公開Source Dataset v2には`observationId`を出さないため、verifyではrecovered corpus + ClassificationVersionからSource Dataset v2 bytesを決定的に再生成し、そのSHA/bytesをmaterialized commentsおよび**実際に配信中のcomments artifactをread-backしたbytes**と比較する。さらにserved release manifestとcomments / keywords / accounts / overviewの全公開artifactをproviderから取得してcontract/SHAを検証する。Overview / Accountは同じ再生成sourceから決定的に再構築してmaterialized/deployed成果物一致を確認し、Keywordは同一source dataset SHAへのpublication bindingとdeployed artifact identityを確認する。

`recovery complete`は、同一recoveryId / corrected releaseに対する成功済みverification receiptが存在しない限り拒否する。

Recovery stage / verificationの永続authorityには既存`application_operation_receipts`を使う。新しいrecovery progress tableは追加しない。`recovery status`はdeterministic stage operation IDsのreceiptとimmutable stateから再構成する。`recovery-verification.json`はissue添付用mirrorであり、freeze解除のauthorityはDB receiptとする。

本issueは、productionで実際にRecoveryを実行し、`recovery verify`が成功するまで完了扱いにしない。

詳細なCLI契約と証跡項目は`11_RECOVERY_CLI_AND_DOD.md`を参照。
