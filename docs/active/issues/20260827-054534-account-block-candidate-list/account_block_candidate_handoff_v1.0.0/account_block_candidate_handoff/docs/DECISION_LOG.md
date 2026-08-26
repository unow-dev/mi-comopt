# Final Decision Log

この文書は「なぜその仕様になったか」を実装者・reviewerが確認するための要約である。実装契約そのものは `ACCOUNT_BLOCK_CANDIDATE_CONTRACT.md` を参照する。

| Topic | Adopted | Rejected / reason |
|---|---|---|
| Candidate role | 根拠付きmanual-review候補 | 危険度score: 教師信号・policy根拠がない |
| Source | published 3-Class final | Stage13 nuisance: targetが広すぎる / keyword artifact: 情報欠落 |
| Candidate label | direct_nuisanceのみ | reactive: アンチへの反撃等を含む |
| Account identity | exact handle | username / 推測統合 / normalization |
| Repetition threshold | 2 distinct behavior events | 1: 反復ではない / 3,5: 既存Stage13境界より恣意的に厳しい |
| Behavior event | handle+comment+postedAt+postedDate | raw row: 重複水増し / 5-field distinct: username変更で別event化 |
| Same event duplicate | same labelならcollapse | raw row count / username込みdistinct |
| Same event label conflict | fail-closed | 自動でどちらかを採択 |
| Time window | なし | 30/90日: 新しい失効policyになる |
| Subtype | MVPではなし | keyword/auditから逆推定: coverageが不均一 |
| Evidence | deterministic 2 events | 全件: data minimizationに反する / latest 2: 日時contract不足 |
| Candidate ID | なし、handleをidentityとして使用 | hash(handle): 状態管理もhandle-changeも解決しない |
| State | stateless full recompute | reviewed/blocked/localStorage: issue scope外 |
| Upstream P2 | final_publishedを尊重 | P2=0を下流で強制: upstream publication contractを上書き |
| Workflow ownership | account専用downstream generator | UI build集約 / labeling pipelineへpolicy混入 |
| Provenance | account専用manifest + meta | keyword manifestへ相乗り / metaだけ |
| Release binding | keyword/account dataset SHA一致 | run_id一致 / 特定SHA hard-code |
| Build | committed artifactsをverify/build | build時再生成 / browser source fetch |
| UI integration | 同一Appのview切替 | 別アプリ / keyword cardsへ混在 |
| Migration | KeywordCard温存 + AccountCard追加 | 大規模共通component refactor |
| Feature delivery | 1 PR / 2 logical commits | 2PR順次merge: mainへ半完成が残る |

## Important superseded intermediate ideas

以下は会話途中で提案されたが**最終仕様ではない**。

- `candidate_id = SHA256(handle)`
- `reactive_count / normal_count / total_count` のpublic candidate掲載
- 全direct evidenceの公開
- 「最新3件」のevidence
- 5-field exact duplicateを無条件errorにする案
- 5-field distinct recordを反復件数にする案
- account候補初回releaseを特定の既存SHAへ固定する案
- generatorとpublisherを別CLIにする案
- generator単独PRを先行mergeする案

実装にこれらを復活させないこと。
