# Comment DB 中心データ更新・状態管理 設計仕様書

**文書バージョン:** 1.0.0  
**ステータス:** 採択済み設計  
**作成日:** 2026-09-14  
**対象:** コメントデータ更新、分類、キーワード候補、アカウント候補、Release、Deployment、およびそれらを調整する Workflow  

---

## 1. 目的

本仕様書は、コメントデータ更新に関する一連の処理を、個別スクリプトや filesystem 上の `current` に依存した手順ではなく、**Comment DB を system of record とする状態管理システム**として再定義する。

本設計が解消する中心問題は次のとおりである。

- 同一概念について filesystem と DB の双方に `current` が存在しうる。
- 「新しい情報を得た」「計算した」「判断した」「公開した」が同じ種類の「更新」として扱われ、authoritative boundary が曖昧である。
- 更新途中に `current` を読み直すことで、一つの処理に異なる世代のデータが混入しうる。
- 評価結果、承認、確定状態、公開成果物、実デプロイ状態の責務が混在している。
- 再実行、競合、途中停止、外部公開失敗を一貫したモデルで説明しにくい。

本仕様は、これらを **immutable version、明示 dependency、Proposal / Decision / Commit、Release / Promotion / Deployment の分離**によって解消する。

## 2. 適用範囲と非目標

### 2.1 適用範囲

本仕様が定義するものは以下である。

- メンタルモデルと用語
- authoritative state の境界
- State Stream / State Version / Head / Dependency の意味
- Proposal / Decision / Commit の状態遷移モデル
- Corpus / Policy / Classification / Keyword Selection / Promotion / Deployment の扱い
- Account Candidate 等の derived view の扱い
- Release Bundle と Projection Definition の扱い
- State Control Plane の論理・物理構造
- API / Repository の責務境界
- Workflow Runtime と再開モデル
- no-op / skip / concurrency / deployment failure の意味
- 現行構造からの段階移行方針

### 2.2 非目標

以下は本仕様単体では固定しない。

- 各分類ポリシーの具体的な判定基準
- UI 表示仕様
- 個々の CLI コマンド名
- 物理ファイル配置規則の細部
- retry 回数や backoff 秒数などの運用パラメータ
- 多人数承認の quorum など、現時点で不要な高度な承認モデル

これらは本仕様の不変条件を破らない範囲で、個別仕様として定義する。

---

## 3. 最上位メンタルモデル

本システムは「データ加工パイプライン」ではなく、**観測された事実と判断をもとに authoritative state を履歴付きで更新し、その状態から用途別 projection を生成するシステム**である。

基本概念は次のとおりである。

```text
External World
      |
      v
   Evidence
      |
      v
  Assessment
      |
      v
   Proposal
      |
      v
   Decision
      |
      v
 Atomic Commit
      |
      v
Authoritative State
      |
      +------> Derived View
      |
      +------> Release Bundle
                     |
                     v
                 Promotion
                     |
                     v
                 Projection
                     |
                     v
                 Deployment
```

### 3.1 Knowledge / Commitment / Exposure

システム状態は意味論上、次の三種類を区別する。

- **Knowledge:** システムが観測・受領済みとして知っていること。
- **Commitment:** そのうち、システムが authoritative として採用している判断。
- **Exposure:** 外部世界で実際に提供・提示されている状態。

これらは同期して進む必要がない。

```text
Knowledge     = 新しい
Commitment    = 以前のまま
Exposure      = 以前のまま
```

という状態も正常である。

### 3.2 State を変更するのは「処理」ではなく「採用」

計算、AI 推論、ルール適用、集計、レビューは、それだけでは authoritative state を変更しない。それらは変更案を作る行為である。

```text
Current State
    |
    +--> observe / derive / assess
                    |
                    v
                 Proposal
                    |
                 Decision
                    |
                  Commit
                    |
                    v
                Next State
```

State が変わるのは、採用された Proposal が Commit に成功した時だけである。

---

## 4. 規範的な設計原則

本仕様における SHALL レベルの原則を以下に定める。

1. **Comment DB SHALL be the system of record.** authoritative state、遷移履歴、公開意図、実デプロイ状態の正本は Comment DB に置く。
2. **filesystem artifact SHALL NOT be authoritative state.** filesystem は入力、監査用 artifact、projection、互換出力として扱う。
3. **Authoritative state SHALL be immutable by version.** 成立済み State Version は更新しない。
4. **Current SHALL be represented by a Head pointer.** `current` を payload 側に重複保持しない。
5. **State transition SHALL pass Proposal -> Decision -> Commit.** 自動処理でもこの意味論を省略しない。
6. **Commit SHALL be atomic.** Version 作成、Domain payload、Dependency、Transition、Head 更新は同一 DB transaction で成立する。
7. **Derived values SHALL NOT become independent authority unless an independent decision exists.** 再計算可能な Account Candidate 等は derived view とする。
8. **Downstream processing SHALL use explicit versions.** 処理途中で暗黙に `current` を読み直さない。
9. **Release SHALL reference exact versions.** 「実行時点の最新」を Release の内部で解決してはならない。
10. **Promotion and Deployment SHALL be separated.** 公開したい状態と、実際に外部で提供されている状態を分ける。
11. **Workflow SHALL NOT own domain truth.** Workflow は実行状態のみを持ち、Domain State は State Control Plane が所有する。
12. **Committed history SHALL be linear per State Stream.** 競合・分岐は Proposal 側で発生し、authoritative committed history 自体は一本道とする。
13. **Rollback SHALL create a new version.** Head を過去へ巻き戻さない。
14. **Migration SHALL preserve single authority.** 新旧への dual-write を authoritative 書込みとして採用しない。
15. **Unverifiable historical transitions SHALL NOT be fabricated.** 移行前履歴を推測で再構成せず、移行時点を Genesis とする。

---

## 5. システムコンポーネント

### 5.1 コンポーネント一覧

| コンポーネント | 主責務 | 保持してはいけない責務 |
|---|---|---|
| Observation / Boundary Adapter | 外部情報を Evidence として取り込む | 分類や採否の authoritative 決定 |
| Comment DB | Evidence、authoritative state、履歴、workflow/deployment 状態の永続化 | 暗黙のビジネス判断 |
| Assessment Component | 明示 version と policy から評価・変更案を生成 | Head 更新、authoritative commit |
| Proposal Service | immutable Proposal を登録 | Proposal の採否判断 |
| Decision Service | Proposal に対する authoritative adjudication を登録 | State Version の直接生成 |
| Commit Service | guard を検証し、atomic transition を成立させる | Domain 内容の意味判断 |
| Domain Transition Handler | Domain payload の妥当性、semantic identity、materialization | Transaction ownership |
| State Query Service | Head 解決と明示 version 読み取り | State 書込み |
| Release Builder | exact versions から immutable Release Bundle を構成 | 最新状態の独自解決、Promotion |
| Projection Engine | exact state / release から外部表現を生成 | authority の変更 |
| Deployment Adapter | 外部環境へ Release を反映 | 成功したとみなす判断 |
| Deployment Verifier | 外部で実際に提供中の Release を検証 | desired release の変更 |
| Workflow Coordinator / Runtime | 手順、待機、再試行、再開、依存伝播を調整 | Domain truth の所有 |

### 5.2 3つの責務層

```text
Decision Layer
  Assessment / Proposal / Decision / Commit

State Layer
  Comment DB / State Streams / Versions / Dependencies

Boundary Layer
  Observation / Projection / Deployment / Verification
```

Coordinator はこれらを呼び出すが、独自の hidden authoritative state を持たない。

---

## 6. State Stream モデル

### 6.1 State Stream

**State Stream** は、直線的な authoritative version 履歴を持つ最小単位である。

```text
V1 -> V2 -> V3 -> V4
                  ^
                 Head
```

Domain は Stream の種類であり、一つの Domain に複数 Stream が存在してよい。

例:

| Domain | Stream key の例 |
|---|---|
| corpus | `comments` |
| policy | `classification` |
| policy | `keyword-selection` |
| policy | `account-candidate` |
| classification | `comments` |
| keyword-selection | `filter-keywords` |
| projection-definition | `optimicom-ui` |
| promotion | `production` |
| deployment | `production` |

### 6.2 Domain / Aggregate の分類

#### Authoritative versioned state

- Corpus
- Policy
- Classification
- Keyword Selection
- Projection Definition
- Promotion
- Deployment

#### Immutable aggregate

- Release Bundle

#### Derived view

- Account Candidate
- その他、authoritative inputs から決定的に再生成でき、独立した採否判断を持たないもの

#### Operational state

- Workflow Run
- Step Attempt
- Deployment Attempt

### 6.3 State Version の意味

State Version は差分そのものではなく、**その version 時点の完全な論理状態**を意味する。

物理保存は差分でもよいが、利用側からは `K7` だけで K7 時点の Classification 全体を再構成できなければならない。

### 6.4 Version identity と semantic identity

`version_id` と `semantic identity` は別概念とする。

```text
V1 = semantic A
V2 = semantic B
V3 = semantic A
```

は正当である。V3 は V1 と同内容でも、「B から A に戻した」という新しい transition だからである。

semantic identity は原則として以下から計算する。

```text
semantic identity
= authoritative payload
+ semantic dependency identities
```

同じ Head に対し semantic identity が変わらない変更は通常 no-op とする。

### 6.5 Head

Head は State Version ではなく、Stream の現在位置を示す可変参照である。

- 成立済み State Version は immutable。
- Head のみが `Vn -> Vn+1` に変わる。
- Head 更新は Version / Dependency / Transition の作成と同一 transaction で行う。

### 6.6 Rollback

Head を V4 から V2 に直接戻してはならない。

```text
V1 -> V2 -> V3 -> V4 -> V5
                       rollback meaning: V2相当
```

Rollback も新しい Decision と Transition であるため、新Versionを作る。

---

## 7. Dependency モデル

### 7.1 明示 dependency

State Version は、その意味を成立させる exact upstream versions を明示参照する。

```text
Corpus C8 -----------+
                     +--> Classification K7
Policy CP4 ----------+
```

例:

```text
Classification K7
  dependency role: corpus                 -> C8
  dependency role: classification-policy  -> CP4
```

### 7.2 predecessor と dependency の違い

- **Transition predecessor:** 同じ Stream の履歴上の前状態。
- **Dependency:** 現状態の意味を成立させる他 Stream / Version。

両者を同じフィールドに統合してはならない。

### 7.3 Dependency DAG

Dependency は成立済み Version のみを指す。Commit Service は循環を許可しない。

新Versionが未来のVersionを参照できないため、通常のCommit経路では dependency graph は DAG になる。

---

## 8. Proposal / Decision / Commit

### 8.1 Proposal

Proposal は、ある Head を前提にした immutable な変更要求である。

概念的に以下を含む。

```text
Proposal
  target stream
  expected head
  proposed authoritative content
  dependency versions
  assessment / evidence references
  semantic fingerprint
```

Proposal は Commit 競合後に書き換えて再利用しない。

### 8.2 Decision

Decision は「この Proposal を authoritative state に採用してよいか」という最終 adjudication である。

Proposal と Decision は原則 1 : 0..1 とする。

- `accepted`
- `rejected`

`pending` は Decision row ではなく、Decision がまだ存在しない状態である。

レビューが複数必要になった場合は、複数 Review から一つの最終 Decision を導出する。

### 8.3 自動判断と人間判断

Human path と automatic path を別モデルにしない。

```text
Proposal
   |
Decision
   authority = human | rule | system
   |
Commit
```

自動更新とは「Decision が存在しない処理」ではなく、Transition Policy によって system/rule authority が許可された Decision である。

### 8.4 Transition Policy

人間承認が必要か、自動承認が許可されるかは Domain 単位ではなく Transition Policy が決める。

Transition Policy は少なくとも次を規定する。

- 許可 authority
- 必須 Decision 条件
- guard
- 必要な evidence / dependency 条件

### 8.5 Commit

Commit は意味判断をしない。形式的・整合性的 guard のみを検証する。

```text
verify expected head
verify accepted decision
verify proposal immutability
verify dependencies
verify transition policy
validate domain payload via handler
compute semantic identity
atomic write
```

Head が Proposal の expected head と一致しなければ conflict とする。

### 8.6 古い Proposal の扱い

```text
Proposal P12 expects V7
Decision D31 accepts P12
Current Head = V8
```

の場合、P12 を V8 向けに rebase してはならない。

- P12 / D31 は履歴として保持。
- V8 を基礎に新 Assessment / Proposal / Decision を作る。

---

## 9. Corpus / Policy / Classification / Keyword Selection

### 9.1 Evidence と Corpus

Evidence は「観測・受領した情報」であり、それ自体は authoritative corpus ではない。

既存の raw input / raw snapshot / observation 群は Evidence Plane として扱う。

```text
Evidence
   |
Proposal / Decision / Commit
   |
Corpus Version
```

同一 Evidence の再取込は、semantic change がなければ新 Corpus Version を生まない。

### 9.2 Policy

判断規則は versioned state とする。

同じ Corpus でも Policy が変われば Assessment の意味が変わるため、Classification 等は使用した Policy Version を dependency として固定する。

### 9.3 Classification

Classification Version は特定 Corpus / Policy に対する確定解釈である。

```text
Classification K7
  depends on Corpus C8
  depends on Classification Policy CP4
```

現行のような observation -> current label の直接可変関係ではなく、Version 配下にラベル集合を保持する。

### 9.4 Keyword Selection

Keyword Candidate は独立した人間判断・継続状態を持つため derived view ではなく authoritative state とする。

```text
Classification K7
Keyword Policy KP3
Previous Keyword Selection S5
        |
   Assessment
        |
    Proposal
        |
    Decision
        |
     Commit
        |
Keyword Selection S6
```

filesystem publication は S6 の projection / artifact であり、正本ではない。

### 9.5 Account Candidate

Account Candidate は独立した採否判断が存在せず、確定済み State / Policy から決定的に生成できる限り、Derived View とする。

```text
Corpus
+ Classification
+ Account Policy
      |
      v
Account Candidate View
```

結果を直接編集してはならない。修正が必要な場合は原因となる Classification または Policy を変更する。

---

## 10. Release / Promotion / Deployment

### 10.1 Release Bundle

Release Bundle は authoritative state そのものではなく、**exact state versions と Projection Definition を束ねた immutable aggregate** である。

例:

```text
Release R12
  corpus                  = C8
  classification          = K7
  keyword-selection       = S6
  classification-policy   = CP4
  keyword-policy          = KP3
  account-policy          = AP2
  projection-definition   = PD3
```

Release Builder は Head を読まない。呼出側から exact versions を受け取る。

同じ exact state 集合と Projection Definition からは同じ bundle identity を得る。既存 bundle と同一なら再利用する。

### 10.2 Projection Definition

同じ State でも mapping / schema / aggregation semantics が変われば公開内容が変わるため、Projection Definition は versioned specification とする。

- semantic mapping rule / schema: versioned dependency
- generator implementation SHA / runtime / build tool: provenance

意味論が変わる実装修正は Projection Definition のversion更新を伴う。

### 10.3 Promotion

Promotion は「どの Release を外部へ出すべきか」という desired state である。

```text
Promotion stream: production
P7 -> P8
      payload = R12
```

すでに desired release が R12 の場合、再度 R12 を promote しても no-op とする。

### 10.4 Deployment

Deployment は「対象環境で実際に提供されている Release」という actual state である。

```text
desired production release = R12
actual production release  = R11
```

は正常な状態である。

Deployment Attempt の失敗は Deployment State を変更しない。外部反映を Verification で確認して初めて Deployment Transition をCommitする。

### 10.5 Release と Deployment Attempt の分離

同じ Release を10回 deploy しても Release は1つである。

```text
Release identity != Deployment Attempt identity
```

attempt は Operational Plane に残す。

---

## 11. Comment DB の3 Plane

Comment DB 内では、意味論を3つに分離する。

```text
Evidence Plane
  what we observed

Authoritative State Plane
  what we accept as truth / commitment

Operational Plane
  how work is progressing / external effects were attempted
```

### 11.1 Evidence Plane

既存の raw 系テーブルを基本的に維持する。

- raw inputs
- raw snapshots
- comment / video observations
- その他の観測 provenance

### 11.2 Authoritative State Plane

- State Streams / Versions / Heads
- Dependencies
- Proposals / Decisions / Transitions
- typed domain states
- Release Bundles
- Promotion / Deployment state

### 11.3 Operational Plane

- Workflow Runs
- Step Attempts
- Deployment Attempts
- retry / external effect history

Operational Plane は domain truth を所有しない。

---

## 12. State Control Plane 物理モデル

### 12.1 Hybrid を採用

全てを opaque JSON とする汎用状態DBは採用しない。一方、Domainごとに Proposal / Decision / Transition / Head を重複実装する方式も採用しない。

**薄い汎用 State Control Plane + typed Domain Data Plane** を採用する。

### 12.2 Core tables

State Control Plane の中核は次の7テーブルとする。

```text
state_streams
state_versions
state_stream_heads
state_version_dependencies
state_proposals
state_decisions
state_transitions
```

#### state_streams

```text
stream_id
 domain
 stream_key
 created_at

UNIQUE(domain, stream_key)
```

#### state_versions

```text
version_id
stream_id
version_no
semantic_sha256
origin_kind
created_at

UNIQUE(stream_id, version_no)
```

`semantic_sha256` は過去 version と重複可能である。

`origin_kind` は少なくとも次を区別する。

- `genesis_migration`
- `commit`

#### state_stream_heads

```text
stream_id        PRIMARY KEY
head_version_id
updated_at
```

Head が同一 Stream の Version のみを参照する制約を持たせる。

#### state_version_dependencies

```text
version_id
dependency_role
dependency_version_id

PRIMARY KEY(version_id, dependency_role, dependency_version_id)
```

#### state_proposals

```text
proposal_id
stream_id
expected_head_version_id
proposed_semantic_sha256
proposal_payload_json
proposal_sha256
created_at
```

Proposal の dependency version IDs、schema version、assessment references は immutable envelope 内に固定する。Commit 後は正規化された `state_version_dependencies` と一致しなければならない。

#### state_decisions

```text
decision_id
proposal_id        UNIQUE
outcome
authority_kind
authority_ref
transition_policy_version_id
rationale
decided_at
```

#### state_transitions

```text
transition_id
stream_id
from_version_id
to_version_id       UNIQUE
decision_id         UNIQUE
committed_at
```

Genesis Version は incoming transition を持たない。

### 12.3 Typed Domain State

Authoritative payload は Domain 別 typed structure で持つ。

例:

```text
classification_states
  version_id PK/FK

classification_state_labels
  version_id
  observation_id
  label
  PRIMARY KEY(version_id, observation_id)
```

```text
corpus_states
  version_id PK/FK

corpus_state_snapshots
  version_id
  snapshot_id
```

```text
keyword_selection_states
  version_id PK/FK

keyword_selection_entries
  version_id
  keyword
  selection_state
  ...
```

同様に policy / promotion / deployment / projection-definition の payload を typed に保持する。

### 12.4 Release tables

```text
release_bundles
  release_id
  bundle_sha256 UNIQUE
  projection_definition_version_id
  created_at
```

```text
release_bundle_members
  release_id
  role
  version_id
  PRIMARY KEY(release_id, role)
```

### 12.5 Transaction boundary

Commit Service は SQLite writer transaction 内で以下を原子的に行う。

```text
BEGIN IMMEDIATE

1. current head取得
2. proposal.expected_headと比較
3. accepted Decision検証
4. dependency existence / policy guard検証
5. domain handlerでpayload検証・semantic identity計算
6. no-op判定
7. next version_no確定
8. state_versions作成
9. typed domain payload作成
10. dependencies作成
11. transition作成
12. head更新

COMMIT
```

いずれかが失敗した場合は `ROLLBACK` とする。

`MAX(version_no)+1` 等の採番を transaction 外で行わない。

---

## 13. API / Repository 境界

### 13.1 公開する Application Services

中核APIは次の4系統に限定する。

- `StateQueryService`
- `ProposalService`
- `DecisionService`
- `CommitService`

Assessment は Domain Component の責務とする。

### 13.2 Read と Write の非対称性

Read は比較的開くが、Write は強く閉じる。

```text
Consumers -> StateQueryService -> DB

Domain process
   -> ProposalService
   -> DecisionService
   -> CommitService
   -> Repositories
   -> DB
```

Repository を状態遷移APIとして直接公開しない。

### 13.3 Head 書込み権限

`state_stream_heads` を更新できる論理コンポーネントは Commit Service のみとする。

`state_versions`、`state_version_dependencies`、`state_transitions` の authoritative 成立も Commit Service のみが行う。

### 13.4 Domain Transition Handler

Commit Service に Domain knowledge を集中させない。

```text
CommitService
   +--> Corpus Handler
   +--> Classification Handler
   +--> Keyword Handler
   +--> Promotion Handler
   +--> Deployment Handler
```

Handler は以下を担当する。

- Domain payload validation
- semantic identity 計算
- typed payload materialization
- Domain固有 dependency validation

Transaction ownership は Commit Service に残す。

### 13.5 Explicit version read

暗黙 current API を原則禁止する。

不採用:

```text
getClassification()
exportCurrentKeywords()
buildLatestRelease()
deployCurrent()
```

採用:

```text
resolveHead(stream)
readState(versionId)
getClassificationVersion(versionId)
projectKeywordSelection(versionId)
buildRelease(exactVersionSet)
deployRelease(releaseId, target)
```

Head 解決と Version 読み取りを別操作とする。

---

## 14. Workflow 設計

### 14.1 型付き Workflow Definition + 汎用 Runtime

巨大な専用FSMも、完全汎用DAGも採用しない。

- **Workflow Definition:** 業務上の手順・依存・postconditionを定義。
- **Workflow Runtime:** 実行、待機、attempt、retry、resumeを共通管理。
- **Workflow Run:** Definition の一回の実行。

### 14.2 Domain Machine と Workflow Machine の違い

```text
Domain Machine
  what is authoritative

Workflow Machine
  how far the work has progressed
```

この二つを混ぜない。

### 14.3 更新 Workflow の標準形

```text
Start
  |
Pin Inputs
  |
Accept Evidence / Commit Corpus
  |
Classification Assessment
  |
Classification Decision
  |
Classification Commit
  |
Keyword Assessment
  |
Keyword Decision
  |
Keyword Commit
  |
Build / Resolve Release Bundle
  |
Promotion Decision
  |
Promotion Commit
  |
Deploy
  |
Verify Deployment
  |
Commit Deployment State
  |
Check Postconditions
  |
Complete
```

Account Candidate は独立 state-update step にしない。必要な時点で derive する。

### 14.4 Input pinning

Workflow は必要な境界で Head を一度解決し、その後は explicit version ID を引き回す。

Run 開始時または該当フェーズ開始時に、Policy / Projection Definition 等を pin する。

処理途中に別 Run が新 Head を作っても、既存 Run の入力を暗黙変更しない。

### 14.5 Step contract

各 Step は次を持つ。

```text
explicit inputs
operation
output
completion condition
```

原則として同一 input に対する再実行は idempotent である。

### 14.6 Run status

Workflow Run status は process lifecycle のみを表す。

```text
Created
Running
Waiting
Blocked
Completed
Cancelled
```

一時的な technical failure を安易に terminal `Failed` にしない。

### 14.7 Step result

```text
Changed
Unchanged
Skipped
Blocked
```

- **Changed:** authoritative transition成立。
- **Unchanged:** 評価した結果、transition不要。
- **Skipped:** 入力identityから評価不要と証明済み。
- **Blocked:** 人間判断、競合解消等が必要。

`Unchanged` と `Skipped` を区別する。

### 14.8 Dependency-aware execution

毎回全工程を再実行しない。

下流 Step は、**そのStepが依存する semantic input identity が変わった場合にのみ dirty** とする。

安全に semantic equivalence を証明できない場合は、version change を dirty として扱う。

```text
Corpus Changed
    |
Classification Unchanged
    |
Keyword Skipped
    |
Release Skipped
```

という実行を許す。

### 14.9 no-op

current semantic state と proposed semantic state が同一なら、新 State Version を作らない。

no-op は failure ではなく正常結果である。

### 14.10 Human wait

人間入力待ちの間も Domain State をロックしない。

待機中に Head が進んだ場合、既存 Decision が accepted でも Commit で conflict となり、新しい Proposal / Decision が必要になる。

### 14.11 Resume

Resume を「前回止まった Step 番号から続行」と定義しない。

```text
Start  --+
         +--> Plan from durable state
Resume --+
```

Resume 時は以下を照合して必要作業を再計画する。

- pinned inputs
- completed outputs
- current heads
- existing Proposals / Decisions
- release / promotion state
- actual deployment state

既存成果がまだvalidなら再利用する。古くなった Proposal / Decision は書き換えず、新規作成する。

### 14.12 Completion

Workflow は「全Stepを一度通った」ことではなく、定義された final postconditions が成立した時に Completed となる。

典型的な postconditions:

1. 対象 Evidence に対する Corpus 判断が成立済み。
2. 必要な Classification 評価が成立済み。
3. 必要な Keyword 判断が成立済み。
4. Release Bundle が一意に決定済み。
5. Promotion target が意図した Release を指す。
6. Deployment target が当該 Release を実際に serve している。

`CompletedWithNoChanges` を別 status にせず、`status=Completed` と outcome を分離する。

---

## 15. Concurrency / Failure / Retry の意味

### 15.1 Optimistic concurrency

各 Proposal は `expected_head_version_id` を持つ。

```text
proposal expected = V7
actual head       = V8
=> conflict
```

Global version / global lock は使用しない。Stream 単位の optimistic concurrency と SQLite writer serialization を組み合わせる。

### 15.2 Conflict

Conflict 時に Proposal を自動 rebase しない。

Workflow は再計画し、必要なら新 Assessment -> Proposal -> Decision を作る。

### 15.3 Assessment failure

Assessment failure は authoritative state を変更しない。必要に応じて Step Attempt として再試行する。

### 15.4 Rejected Decision

Proposal が reject された場合、State は不変。Decision は immutable history として残す。

### 15.5 Commit failure

Commit が guard / conflict で失敗した場合、Decision が accepted であっても State は不変。

### 15.6 Projection failure

Projection failure は既存 State / Release を変更しない。Projection は再生成可能である。

### 15.7 Deployment failure

Deployment failure は Promotion と Deployment State を変更しない。

```text
desired = R12
actual  = R11
```

のまま同一 Release を retry する。

### 15.8 derive と commit

- derive / assessment / projection: 再実行可能。
- authoritative commit: 一意なtransitionとして成立。
- external effect attempt: operational historyとして複数回存在しうる。

---

## 16. Migration 設計

### 16.1 Strangler migration を採用

Big Bang 置換は採用しない。Domain / responsibility ごとに新 authority へ切り替える。

### 16.2 Dual-write を採用しない

移行中でも、一つの意味について authoritative writer は常に一つとする。

不採用:

```text
command
  +--> legacy authority
  +--> new authority
```

採用:

```text
command
   |
new authoritative state
   |
compatibility projection
   |
legacy reader / format
```

### 16.3 Genesis migration

過去に存在しなかった Proposal / Decision / Transition をログから推測して作らない。

```text
Legacy authoritative state
        |
        v
Genesis Version V1
origin_kind = genesis_migration
```

既存履歴、artifact、timestamp は provenance / evidence として保持する。

### 16.4 Migration lifecycle

各Domain/Streamは次の段階を通る。

```text
Legacy
  |
Backfilled
  |
Verified
  |
Cutover
  |
Legacy Read Compatibility
  |
Retired
```

意味:

- **Legacy:** 旧モデルが authority。
- **Backfilled:** 新モデルに Genesis 作成済み。authority は旧。
- **Verified:** 旧状態と Genesis の意味一致を確認済み。
- **Cutover:** 新モデルへ authoritative write を一度だけ切替。
- **Legacy Read Compatibility:** 旧形式を新Stateから生成。
- **Retired:** 旧 authority / current marker / direct write path を撤去。

### 16.5 Migration order

依存関係に沿って以下の順序を基本とする。

```text
0. State Control Plane
1. Corpus semantics
2. Policy registration
3. Classification
4. Keyword Selection
5. Release Bundle / Projection Definition
6. Promotion
7. Deployment
8. legacy authority removal
```

Account Candidate は authority 移行対象ではなく、derived view として新 input に接続する。

---

## 17. 現行資産への対応

### 17.1 raw 系

`raw_inputs`、`raw_snapshots`、各 observation は Evidence Plane として活用する。全面的に作り直さない。

### 17.2 three-class labels

現行の current label 構造は Classification Genesis の移行元とする。

Cutover 後は Classification Stream Head が唯一の authoritative current となり、旧直接更新経路を閉じる。

### 17.3 keyword candidate publication

現行の keyword publication に混在している以下の責務を分解する。

- candidate state -> Keyword Selection Version
- proposal / handoff -> Assessment / Proposal provenance
- current marker -> State Stream Head
- filesystem publication -> Projection / Artifact
- run metadata -> Workflow / provenance

Cutover 後、`keyword_candidate_publications.is_current` および filesystem `current` は authority ではない。

### 17.4 account candidate

確定 Corpus / Classification / Account Policy から derived view として生成する。

公開JSONの手編集によって authority を持たせない。

### 17.5 release / UI export

UI export は Head を独自に読むのではなく、Release Bundle の exact members と Projection Definition を入力にする。

「DBの最新状態をexportする」のではなく「Release Rn をprojectする」APIへ移行する。

---

## 18. 監査・再現性要件

任意の authoritative State Version について、最低限以下を追跡可能でなければならない。

- どの State Stream に属するか
- version number
- semantic identity
- 直前の Transition
- その Transition を成立させた Decision
- Decision の対象 Proposal
- Proposal の expected head
- dependency versions
- authority / rationale
- domain payload
- provenance

任意の Release Bundle について以下を再現可能でなければならない。

- exact member versions
- Projection Definition version
- derived views の再計算条件
- generator provenance
- artifact hash

任意の Production 状態について以下を区別できなければならない。

- desired Release (Promotion Head)
- actual Release (Deployment Head)
- deployment attempts
- verification result

---

## 19. 主要不変条件

実装・テストは少なくとも以下を保証する。

1. 一つの State Stream に Head は高々1つ。
2. Head が指す Version は必ず同じ Stream に属する。
3. Committed history は Stream ごとに一本道。
4. 一つの committed Version に incoming Transition は高々1つ。Genesis は0。
5. Proposal / Decision / State Version / Transition / Release Bundle は成立後 immutable。
6. Proposal と Decision は 1 : 0..1。
7. Decision が `accepted` でなければ Transition は成立しない。
8. Transition の `from_version` は Commit 時の Head と一致する。
9. Version の dependency は存在する committed Version のみを参照する。
10. Proposal が宣言した semantic dependencies と committed Version の dependencies は一致する。
11. Version / typed payload / dependencies / transition / head update は同一transactionで成立する。
12. current を表す Domain固有 `is_current` を新規導入しない。
13. Release Bundle は Head ではなく exact Version を参照する。
14. Promotion と Deployment は独立State。
15. Deployment failure は Promotion / Deployment Head を書き換えない。
16. Workflow Run は Domain State を直接更新しない。
17. Resume は durable facts から再計画する。
18. 古い Proposal を rebase / rewrite しない。
19. Derived View の結果を直接authoritative編集しない。
20. 移行中の authoritative writer は任意時点で一つだけ。

---

## 20. テスト方針

### 20.1 State Control Plane

- Genesis stream creation
- atomic commit success
- expected-head conflict
- rejected decision cannot commit
- same semantic state no-op
- rollback-as-new-version
- Head / Version cross-stream reference rejection
- dependency existence validation

### 20.2 Domain State

- Classification Version から完全状態を再構成できる
- 同じpayload・異なるsemantic dependencyで必要な新versionが成立する
- Keyword Selection の旧 `current` なしでHeadから現状態を解決できる
- Account Candidateが exact state/policy inputs から再生成可能

### 20.3 Release / Deployment

- Release bundle deduplication
- exact version pinning
- Projection Definition変更で bundle identity が変わる
- Promotion desired / Deployment actual の乖離を表現できる
- deployment retryで新Releaseを生成しない

### 20.4 Workflow

- no-op run
- downstream skip
- human wait -> resume
- wait中のHead変更 -> conflict -> refresh
- process crash -> durable-state replan
- deploy failure -> retry -> verify -> deployment commit
- Completed statusとbusiness outcomeの分離

### 20.5 Migration

- legacy -> Genesis semantic equivalence
- cutover前はlegacyのみがauthority
- cutover後はnew stateのみがauthority
- compatibility outputがnew stateから生成される
- old current markerを参照するconsumerが0になる

---

## 21. 移行完了条件

各対象 Stream / Domain について以下を満たした時点で移行完了とする。

1. Legacy State と Genesis State の意味一致が検証済み。
2. 新しい Commit 経路だけが authoritative state を変更できる。
3. Legacy direct-write path が存在しない。
4. 必要な legacy-shaped output は new state から再生成できる。
5. Legacy `current` marker を authoritative に読む consumer が存在しない。
6. Release / Projection が exact versions を入力にしている。
7. Promotion / Deployment の desired / actual が分離されている。
8. Workflow が explicit version と durable state から再開可能である。
9. Failure / conflict が State の部分更新を残さない。
10. DB・filesystem間に二重の authoritative current が存在しない。

---

## 22. 採択判断一覧

| 論点 | 不採用 | 採択 |
|---|---|---|
| システム理解 | ETL/一本道パイプライン | versioned authoritative state system |
| State 構造 | 巨大な単一State | State Streamごとのversion履歴 |
| committed history | 分岐DAG | Streamごとの一本道 |
| current | payload内の複数current | Head pointer |
| rollback | Headを過去へ移動 | 新VersionをCommit |
| State change | 処理成功で直接更新 | Proposal -> Decision -> Commit |
| 自動更新 | Decision省略 | system/rule authorityのDecision |
| 承認条件 | Domain固定 | Transition Policy |
| 競合 | 自動rebase | 新Assessment/Proposal/Decision |
| Account Candidate | 独立State | Derived View |
| Keyword Candidate | Derivedのみ | Keyword Selection State |
| filesystem publication | authoritative current | Projection / Artifact |
| Release | 公開意図と実反映を混在 | Release Bundle / Promotion / Deployment 分離 |
| Release入力 | currentを内部解決 | exact versions |
| Projection semantics | 実装だけに埋込 | versioned Projection Definition |
| State storage | 全JSON汎用 | Control Plane + typed Domain payload |
| Repository | 外部公開Write API | Application Service配下の永続化手段 |
| Head write | 各Domainから更新 | Commit Serviceのみ |
| Transaction | Repositoryごと | Commit Service所有 |
| Workflow | 巨大FSM | typed definition + generic runtime |
| Resume | Step番号から続行 | durable stateから再計画 |
| no-op | failure / 常に新Version | 正常結果、Version不要 |
| execution | 毎回全工程 | dependency-aware execution |
| migration | Big Bang | Strangler |
| migration writes | authoritative dual-write | single-authority cutover |
| 過去履歴 | 推測して復元 | Genesis migration |

---

## 23. 最終アーキテクチャ

```text
                         External World
                              |
                              v
                         Evidence Plane
                              |
                              v
                     Assessment Components
                              |
                              v
                         Proposal Service
                              |
                              v
                         Decision Service
                              |
                              v
                         Commit Service
                              |
             +----------------+----------------+
             |                                 |
             v                                 v
       State Control Plane              Typed Domain State
             |                                 |
             +---------------+-----------------+
                             |
                             v
                    Authoritative Versions
                             |
              +--------------+--------------+
              |                             |
              v                             v
        Derived Views                 Release Builder
     (Account Candidate)                   |
                                           v
                                      Release Bundle
                                           |
                                           v
                                     Promotion Stream
                                      desired release
                                           |
                                           v
                                      Projection
                                           |
                                           v
                                  Deployment Adapter
                                           |
                                           v
                                    External Target
                                           |
                                           v
                                  Deployment Verifier
                                           |
                                           v
                                    Deployment Stream
                                      actual release

Workflow Runtime orchestrates all steps but owns no domain truth.
```

## 24. 設計完了宣言

本仕様で、以下の設計層を確定した。

- メンタルモデル
- authoritative state の定義
- Domain / Stream / Version / Dependency モデル
- Proposal / Decision / Commit モデル
- Release / Promotion / Deployment モデル
- Comment DB の論理・物理責務
- API / Repository 境界
- Workflow / resume / no-op / concurrency モデル
- migration 方針
- 主要不変条件とテスト観点

以降は、本仕様を変更しない前提での **実装計画、migration SQL、Application Service API、既存コード差分設計、段階的cutover** の作業フェーズとする。
