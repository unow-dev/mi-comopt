# Single-roundtrip classification v1.5 — implementation handoff

## 目的

`ISSUE_BODY.md` の「分類handoffの単一往復化」を実装するための、実装作業者向けhandoffです。
このpackageは会話ログの代替であり、**ここに記載した最終採択仕様だけ**を実装対象とします。途中で検討後に撤回された案は含めていません。

## 到達状態

設計は「実装作業者がproduct/policy上の追加判断をせず着手できる」状態まで閉じています。
分類意味論はv1.4を変更せず、人間との通信だけを最大1往復へ統合します。

## 最初に読む順序

1. `source/ISSUE_BODY.md` — フリーズ要件。最上位。
2. `NORMATIVE_IMPLEMENTATION_SPEC.md` — v1.5 MVPの実装契約。
3. `IMPLEMENTATION_PLAN.md` — PR1〜PR5の順序とmerge gate。
4. `ACCEPTANCE_TEST_MATRIX.md` — 完了条件。
5. `BASELINE_INTEGRITY_FINDINGS.md` — supplied snapshotの重要な整合性注意。
6. `CODE_TOUCHPOINTS.md` — 既存コード上の変更位置。
7. `DECISION_LOG_FINAL.md` — 採択/却下の最終一覧。

## 優先順位

競合時は以下の順で優先します。

1. `source/ISSUE_BODY.md` のフリーズ要件
2. `NORMATIVE_IMPLEMENTATION_SPEC.md`
3. v1.5で更新する `docs/PIPELINE_CONTRACT.md`
4. versioned response/request contractとacceptance tests
5. 実装
6. README / runbook / comments

v1.4のStage13/3-classラベル意味論については、同梱したv1.4 spec/prompt/policyを参照し、v1.5側で再定義しません。

## 絶対条件

- v1.4の二段階運用はcutover gate通過まで変更しない。
- v1.5はv1.4のsibling implementationとして追加する。
- Stage13 → Three-Class の意味上の順序を維持する。
- 人間との分類通信は最大1送付 + 1回答。
- P0/P1 goldenとP2のreuse境界はexact `record_key`のまま。
- 未解決P2をsingle-roundtripのmandatory human taskへ追加しない。
- candidate/account/releaseへ渡す既存clean artifact schemaを変えない。
- bootstrap・新分類rule・UI・大規模refactorはこのMVPへ入れない。

## supplied sourceについて

`source/` は実装根拠を確認しやすくするための抜粋snapshotです。実際のrepositoryが存在する場合、実装はrepository上で行ってください。
特に supplied snapshotのv1.4 manifestには2ファイルのhash/size不一致があります。`BASELINE_INTEGRITY_FINDINGS.md`を必ず先に確認してください。
