# Decisions and Supersessions

この文書は採択理由を残す。動作仕様は `IMPLEMENTATION_SPEC.md` が優先する。

## D-01 Phase 1 classification

**採択:** 既存3分類 `normal / reactive / direct_nuisance` のみ。

**不採択:** 3分類から6分類への名称置換・推測分解。

理由: DBに可逆な6分類contractがない。

## D-02 DB正本の意味

**採択:** DB authoritative + deterministic static read model。

**不採択:** React browserからSQLiteを直接読む / backend API新設 / checked-in JSONをsemantic source of truthにする。

理由: 既存architectureと静的Vite UIに整合し、provenanceを維持しつつscopeを増やさない。

## D-03 UI source snapshot

**採択:** DB-current keyword publicationが指す単一snapshotをOverview/Comments/Accountsにも使用。

**不採択:** 各screenで「最新」を独立選択。

理由: 全screenで同一母集団を保証する。

## D-04 Aggregation units

用途別に固定。

- Overview/3-class counts: labeled observation
- Comments: observation
- Keyword D/R/N metrics: existing keyword evaluation contract
- Accounts: existing distinct behavior-event semantics

**上書き:** 元issueの「集計単位はすべて観測単位」。account candidate生成には適用しない。

## D-05 Missing period semantics

**採択:** unknown != 0。日付にobservationが存在しなければnull/gap。

**上書き:** 元issueの「欠損期間は0として表示」。

理由: 観測されていない期間を「0件だった」と偽装しない。

## D-06 Time window

**採択:** 1日 / 7日 / 30日、source snapshot `MAX(postedDate)` 基準。

**不採択:** browser current time基準の24時間。

理由: source dataに信頼できるnormalized timestamp coverage contractがない。

## D-07 Score / summary / priority

**採択:** Phase 1から削除。

**上書き:** 元issueの「スコア、総評、推奨を決定的ルールで新設」。

理由: 再現可能な式を作れても意味的妥当性は得られない。3分類からhealth scoreを定義する根拠がない。

## D-08 Keyword semantics

**採択:** existing `recommendation` (`高推奨 / 中推奨 / 任意`) とexisting metricsをそのまま表示。

**不採択:** recommendation → high/mid risk変換、AI自然言語理由生成。

NEW rule: `introduced_at`から14×24時間。

## D-09 Account semantics

**採択:** existing account policy 1.0.0をそのまま再利用。

**不採択:** high/mid risk、投稿頻度等を使ったnew risk model、完全履歴表示。

表示は `handle`, `direct_nuisance_count`, `evidence_sample`。

## D-10 Candidate counts

**採択:** artifact array lengthを表示。

**不採択:** 60 accounts / 86 keywords等をproduct contractとして固定。

現在値はregression referenceに過ぎない。

## D-11 Browser action state

**採択:** copy事実とuser-markを分離。

- keyword copy → `copied_at`
- account copy → `copied_at`
- account manual mark → `blocked_marked_at`

**不採択:** copy success = 追加済み / TikTokブロック済み。

## D-12 DB schema v8

**採択:** schema v8をrequired stateにする。migrationはexplicit phase。

UI exporterはread-onlyで、古いDBを自動migrationしない。

## D-13 Release root

最終採択:

**対象UI専用 `optimicom-ui-release.json` schema v1を新設。**

**維持:** existing `data-release.json` schema v1。

途中案「既存data-release.jsonをv2化」は撤回。既存releaseは別consumerの強いcontractであり、今回のUI導入でmigrationする利益がない。

## D-14 Artifact strategy

- Comments: existing deterministic source dataset bytesをそのまま公開。
- Keywords: DB-current publication JSONをbusiness再加工せず公開。
- Accounts: source recordsから`source_index`だけ除去しexisting pure functionへ渡す。
- Overview: source datasetからのみ決定的集計。
- content-addressed artifacts + release-root-last publication。

## D-15 Read concurrency

**採択:** single SQLite read transaction。

理由: export中にcurrent publicationが切り替わってもrelease内部を混成させない。

## D-16 Runtime loading

**採択:** release rootをpage lifetimeで固定しscreen artifactをlazy load。

**不採択:** boot時に24k+ commentsを含む全artifact fetch、screenごとに別manifest fetch。

## D-17 Error behavior

- release root failure: fatal/fail closed
- screen artifact failure: screen-local error
- sample fallback: prohibited

## D-18 UI naming

- `normal` → 通常
- `reactive` → 二次反応
- `direct_nuisance` → 一次迷惑
- Overview → 分析概要
- total → 対象観測数
- account evidence modal → 候補判定の根拠

「コメント欄のいま」「総コメント数」「履歴」など、coverage/identityを過大主張する語を避ける。

## D-19 Production rollback

**採択:** deployment単位でrollback。

**不採択:** sample UIとのruntime feature flag coexistence。

理由: production codeにsample business sourceを温存すると再流入経路になる。

## D-20 Handoff authority

`IMPLEMENTATION_SPEC.md` が唯一のimplementation truth。

元 `ISSUE_BODY.md`, `FEASIBILITY_REPORT.md`, `IMPLEMENTATION_POLICY_WORKSET.md` はdiscussion historyとして同梱するが、矛盾時は本handoffが優先する。
