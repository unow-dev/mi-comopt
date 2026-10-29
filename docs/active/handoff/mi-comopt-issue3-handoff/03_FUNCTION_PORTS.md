# 03 Task下位の関数・インターフェース契約

前段の会話で作成した型の正本候補は `reference/classification-correction-v2.task-types.ts` および `reference/classification-correction-v2.lower-types.ts`。それらは設計草案であり、既存のJavaScriptコードに型宣言を機械的に貼り付けることを要求しない。新規実装はJS+JSDocやTypeScriptなど、リポジトリの規約に従う。

## 共通のApplication Service Task Handler

```ts
type Handler<Input, Result> = (
  context: OperationContext,
  input: Readonly<Input>,
) => Promise<Result> | Result;
```

`OperationContext`はサービス実行者の情報。Session Inputの`requester`を信用せず、Session開始時の認証済みactorと一致させる。Taskの戻り値は既存の`WorkStepResult`形式 `{stateResult,refs,details?}`。routing outcomeはAdapterで導出する。

## Domain: 副作用のない関数

| 関数 | 入力 | 出力 | 不変条件 |
|---|---|---|---|
| `validateRequest` | ValidateBatchInput | `DomainResult<ValidatedBatch>` | 1件以上、ラベル、理由、要求形式、入力fingerprint |
| `resolveGroups` | ValidatedBatch、固定Snapshot、検証済provenance | `DomainResult<NonEmptyArray<ResolvedCorrectionGroup>>` | 本文完全一致、重複グループなし、全対象の期待ラベル一致 |
| `buildChangeSet` | batch、Snapshot、resolved groups | `DomainResult<CorrectionChangeSet>` | 対象外不変、全survivor coverage、変更件数、前後分布 |
| `recomputeChangeSet` | batch、再検証時Snapshot、provenance | `DomainResult<CorrectionChangeSet>` | commit前に保存値と同一結果を算出 |
| `semanticHash` | 完全分類状態 | Sha256 | 不変・順序非依存の正規化ルールを仕様化 |
| `changeSetHash` | 変更集合（hashを除く） | Sha256 | 対象・変更前後ラベル・理由・依存Versionを含む |

`DomainResult<T> = ok(T) | invalid(violations[]) | conflict(conflictAt)`。予期される業務上の不成立を表す。実行時I/O障害はここに混ぜない。

## 固定Snapshotの読込

```ts
interface CorrectionReadPort {
  loadBase(request: BaseReadRequest): ClassificationBaseSnapshot;
}
```

`ClassificationBaseSnapshot`は共通のCorpus Versionに対するsurvivor全件、Classification Versionに対するlabel全件、固定Version、期待Head、依存関係、semantic hashを含む。

- 分類は**固定したClassificationVersionのみ**から読込。legacy global label tableへのfallback禁止。
- 代表IDの正当性、本文、全survivorの集合、同本文グループをSnapshotから決定する。
- 文字列Observation ID (`"001"`と`"1"`) の意味を保存。SQLite検索で型CASTの安易な変更をしない。
- `loadBase`のSnapshot一貫性を保証。commit時の再読込は**同じDBトランザクション内**で行う。
- 44,419件規模でCorpus投影/全ラベル読込を25回繰り返さない。

## ProvenanceとRequester認証

```ts
interface RequesterIdentityPort {
  authenticatedRequester(sessionId: string): ActorRef;
  requirePermission(sessionId: string, claimedRequester: ActorRef, action: "classification:correct"): void;
}
interface ProvenancePort {
  verifyIfSupplied(request: ProvenanceVerificationRequest): VerifiedProvenance | null;
}
```

- `I204`などの番号は識別子ではなく保存済みreceiptに基づく参照。receipt内 `classificationPlan.handoffItems` のID・representative ID・正本hash・worksetとの対応を確認する。
- 正本の提出者やファイル名から自動的に権限を推論しない。
- `OperationContext.actor`はTask実行サービスを指す。業務上の要求者やHuman reviewerとは別。
- provenanceが任意の汎用契約でも、provenanceの一部が与えられたら矛盾・改ざんを拒否する。

## 保存: 変更集合、Assessment、Proposal

```ts
interface CorrectionChangeSetStore {
  putImmutable(changeSet: CorrectionChangeSet): ChangeSetRef;
  read(changeSetId: ChangeSetId): CorrectionChangeSet | null;
}
interface AssessmentAndProposalFunctions {
  assess(changeSet: CorrectionChangeSet): CorrectionAssessment;
  propose(changeSet: CorrectionChangeSet, assessment: CorrectionAssessment, heads: ExpectedHeads): ClassificationProposal;
}
interface ProposalWritePort {
  saveBundle(operationId: OperationId, bundle: ProposeBundle): StoredProposalRefs;
  readProposal(proposalId: ProposalId): ClassificationProposal | null;
  readAssessment(assessmentId: AssessmentId): CorrectionAssessment | null;
}
```

`Assessment`と`Proposal`は1 CorrectionBatchにつきそれぞれ1件。Proposalが指す変更集合とAssessmentを同時に不変保存する。中途失敗時に「AssessmentだけありProposalがない」状態をどう復元するかを定義し、重複Proposalを作らない。

既存の`StateControlPlane.recordAssessment/createProposal`は各々独立のtransactionを持つ。新しい`saveBundle`契約を実現する方法は既存の入れ子トランザクションを呼び出すことではない。原子保存の実装方法を選ぶか、永続レシートと回復手順で同等の論理保証を証明する。

## Reviewの認可

```ts
interface ReviewAuthorizationPort {
  authorize(input: BoundHumanReview, proposal: ClassificationProposal): ApprovedReview;
}
```

- Human Taskが実際に提出されたProposalと、`finalize`引数の`proposalId`が一致すること。
- ReviewerのHuman actor、Policyの許可条件、TaskのExecution IDを検証。
- `reject`時はDecisionのみ記録してHeadは変更しない。
- 承認後にProposalやChangeSetが差し替えられないことをhashで検証。

## Commit: 原子的な状態変更

```ts
interface CorrectionCommitUnitOfWork {
  transaction<T>(work: (tx: ClassificationCommitTransaction) => T): T;
}
```

**同じトランザクションに属する処理**:

1. `correctionOperationId`に対応した既存確定結果を参照し、同一fingerprintならreused、異なればIDEMPOTENCY_CONFLICT。
2. Proposal・Assessment・ChangeSet・認可されたDecisionの整合性とhashを検証。
3. 固定Versionと現在のClassification/Corpus Head（要求された依存Headを含む）を検証。
4. 固定Corpus/Classificationの全データを使い変更集合を再計算。保存されたChangeSetと比較。
5. coverage・対象外不変・label distribution・提案semantic hashを検証。
6. 承認済みの場合のみ、1つのVersionと全ラベル状態を永続化。
7. 期待Headから新Versionへ競合検出付きで更新。
8. `correctionOperationId`に対してFinalizationRecordを記録。

途中例外・CAS不一致はすべてROLLBACK。**別トランザクションで先にcommitし、その後で業務操作receiptを書く設計は障害時に重複判定が難しくなる**。既存`StateControlPlane.commitProposal()`の`runIdempotent`・transaction・`domainHandler.validate`を利用できるが、原子性と業務操作IDの一意性が満たされることを確かめる。

`ClassificationVersion`の新旧判定は状態のsemantic hash**のみ**ではない。依存Versionも比較する。単純な`samePayload`で同一操作の結果を推定しない。

## Taskへ返す値

- `validate`: succeeded / blocked(invalid) / conflict(superseded)
- `resolve`: succeeded / blocked(invalid) / conflict(superseded)
- `propose`: review_required / blocked(invalid) / conflict(superseded)
- `finalize`: committed / reused / rejected / conflict

これらはTaskごとのルーティング規則に明記する。`result-rules.js`はstepごとの`stateResult`と**exact ref-key set**を検証するため、戻り値の`refs`は許可されたフィールドだけを含む必要がある。
