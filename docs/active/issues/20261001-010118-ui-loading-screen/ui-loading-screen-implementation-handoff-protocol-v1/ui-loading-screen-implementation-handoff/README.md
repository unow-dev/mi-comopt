# UI Loading Screen — Implementation Handoff

この handoff は、Issue「UIにデザイン正本準拠のローディング画面を実装する」を、`design_ai_protocol_v1` の区分に沿って実装前設計へ整理したものです。

## Start here

1. `IMPLEMENTATION_HANDOFF.md` — 実装AIへ渡す唯一の最終設計
2. `ACCEPTANCE_CHECKLIST.md` — 完了条件を検証用チェックへ展開したもの
3. `REVIEW_CHECKLIST.md` — PRレビュー時の境界
4. `DESIGN_CLASSIFICATION.md` — 入力分類と、確定設計 / 実装仮説への再分類メタ情報
5. `CURRENT_CODE_OBSERVATIONS.md` — 設計判断に必要な discussion-set snapshot の決定的事実
6. `reference/` — Issue本文、デザイン正本、現行コード参照スナップショット

## 設計の読み方

`IMPLEMENTATION_HANDOFF.md` では拘束力を次のように分けています。

- **不変仕様**: 成果物として必ず成立させる外部条件。
- **完了条件**: 不変仕様が成立したことを確認する事実。
- **確定設計**: 実装AIへ再判断させない責務境界・共有契約。
- **実装仮説**: 有力な探索開始点。確定設計を守れるなら実コードに応じて変更可能。

component 名、hook の完成コード、`key={screen}`、props の有無、ファイル配置などは、原則として実装仮説です。それらへの一致だけを理由に implementation を reject しません。

## Source of truth

- 成果物としての要求: `reference/ISSUE_BODY.md`
- loading design の外部結果: `reference/design-master/`
- 実装時の責務境界・契約: `IMPLEMENTATION_HANDOFF.md`
- 実コードの最新事実: 実リポジトリ

参照スナップショットと実リポジトリが異なる場合、最新コード事実を優先します。ただし確定設計と衝突する場合は、実装側だけで設計を変更せず差し戻します。

## 同梱時点の正本検証

`reference/design-master/` について以下を確認するための検証情報を同梱しています。

- `npm run check`
- `CHECKSUMS.sha256`
- `assets/emblem.webp` SHA-256:
  `4f4a9c22eb2022cfa1423eb240ed050263ad890201f92de9061e909fffc320e9`

## 注意

`reference/current-code/` は discussion set に含まれていた参照スナップショットであり、完全な実アプリ checkout ではありません。

そのため、この archive 単体でアプリ側の `npm test` / `npm run build` の成否を完了判定にしません。最終検証は実リポジトリで行います。
