# Work Task Sequence: UI Loading Screen Implementation

## Purpose

release root と各 artifact のデータ待機中に、デザイン正本に準拠した loading experience が表示され、既存の取得・cache・retry・navigation・toast の意味を保ったまま、定められた完了条件を満たす。

## Task Sequence

- [x] 1. 要求・設計条件の範囲で、AIエージェントが、不変仕様・確定設計・完了条件と実装仮説を整理する。
- [x] 2. 現行コード確認の範囲で、AIエージェントが、loading 表示・artifact 取得・cache・in-flight request・retry・navigation・toast の現状を調査する。
- [x] 3. 設計差分の範囲で、AIエージェントが、現行コードの事実と handoff の確定設計との衝突および実装に必要な条件を特定する。
- [x] 4. 必要な設計判断の範囲で、人間が、確定設計との衝突が見つかった場合に対応方針を決定する。
- [x] 5. loading experience の範囲で、AIエージェントが、デザイン正本と確定設計に沿って必要最小限の変更を行う。
- [x] 6. 完了条件の範囲で、AIエージェントが、release root・artifact の cold load/cache hit・failure/retry・in-flight navigation・toast の動作を検証する。
- [x] 7. デザイン・アクセシビリティの範囲で、AIエージェントが、正本との視覚・responsive・reduced-motion・読み上げ上の整合を確認する。
- [x] 8. 検証範囲で、AIエージェントまたはCIが、design master の検証、既存 test suite、production build を実リポジトリで実行する。
- [x] 9. 作業結果の範囲で、AIエージェントが、変更内容・検証結果・未解決事項を記録して報告する。

## Work Notes

- 実装要件と責務境界は `IMPLEMENTATION_HANDOFF.md` を正とする。要求の原文は `reference/ISSUE_BODY.md`、確認項目は `ACCEPTANCE_CHECKLIST.md` を参照する。
- 実装時は参照スナップショットではなく実リポジトリの最新コードを確認する。確定設計と衝突する場合は、実装側だけで設計を変更しない。
- デザイン正本の検証は `reference/design-master/` で `npm run check` と `sha256sum -c CHECKSUMS.sha256` を実行する。アプリの test suite と production build は実リポジトリで確認する。
- 完了条件には cache hit 時に不要な loader flash や追加 request がないこと、request dedupe と既存 error/retry flow を保つこと、loading 中も toast を利用できることが含まれる。
- 現行実装では4つの常設hookからartifactごとの `ArtifactRoute` に変更し、route unmountでUI stateを破棄する。data clientのcacheとin-flight requestはroute lifecycleから独立している。
- 人間判断: artifact失敗後に別画面へ移動して戻る操作では、新しいloadとしてfull-screen loadingを表示し再取得する。同じartifactを選択中に同じnavigation項目を再選択する操作はretryにしない。
- browser fixtureでrelease rootのpending/success/failure、artifact failure/retry/revisit/cache hit、toast、1440x900/390x844、reduced-motionを確認。loading中に通常navigationがなく、toastが表示され、狭幅の横overflowがなく、reduced-motionでemblem/wave animationが停止することを確認。
- release-clientのcache同期参照・cache hit・in-flight共有テスト2件が成功。実リポジトリの全test suiteは195件成功、production build成功。design masterの `npm run check` と `sha256sum -c CHECKSUMS.sha256` も成功。
