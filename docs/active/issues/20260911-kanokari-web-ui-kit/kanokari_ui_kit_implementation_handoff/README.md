# 「彼女、お借りします。 inspired Web UI Kit」実装 handoff

このZIPは、issue「UIに『彼女、お借りします。 inspired Web UI Kit』を適用する」を実装担当者へ引き渡すための確定仕様です。この会話を参照しなくても実装・レビュー・完了判定ができることを目的とします。

## 最初に読む順序

1. `IMPLEMENTATION_SPEC.md` — 実装仕様の正本
2. `ACCEPTANCE_CHECKLIST.md` — Done判定
3. `FILE_CHANGE_MAP.md` — 変更対象と依存整理
4. `DECISION_LOG.md` — 主要判断と不採択案
5. `BASELINE_NOTES.md` — 添付スナップショット固有の制約
6. `ISSUE_BODY_FINAL.md` — issue本文へ転記可能な確定版
7. `reference/discussion_set/` — 元の議論セット一式

## 正本の優先順位

矛盾がある場合は、次の順に優先します。

1. このhandoffの `IMPLEMENTATION_SPEC.md` に明示された決定
2. 現行機能の意味を維持するための既存Reactロジック・表示データ
3. 3つの `*_ui_kit_applied.html` の外観・レイアウト・interaction style
4. `kanokari_web_ui_kit_expanded.html` の近縁pattern（適用例に未定義の状態を補う場合のみ）
5. 現行Y2K UIの見た目（原則として新UIへ持ち込まない）

基本原則は **機能的意味の保持を最優先し、それと衝突しない範囲では適用済みHTMLとの外観完全一致を目指す** です。

## 実装時の判断規則

未知のedge caseが出た場合は、以下の順で判断してください。

1. 変更によりユーザーが現在得られる情報・操作能力を失うか確認する。
2. 失う場合は機能を保持し、UI Kit内の既存patternで表現する。
3. 失わない場合は適用済みHTML側へ合わせる。
4. 適用済みHTMLにpatternがなければexpanded UI kitの最も近いpatternを使う。
5. 新規の独自visual patternは最後の手段とする。

このhandoff作成時点で、実装者に残すべき裁量は関数名・ファイル内の分割・CSSの記述順など、最終UI/挙動に影響しない内部設計のみです。
