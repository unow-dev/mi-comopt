# Y2K UI 実装 handoff

このhandoffは、Issue「UIに『Y2K UI』を適用する」を実装作業者へ引き渡すための確定仕様です。

## 最初に読む順序

1. `IMPLEMENTATION_HANDOFF.md` — 実装契約本体
2. `implementation/components.json` — shadcn/Y2K registry設定
3. `implementation/jsconfig.json` — `@/* -> src/*` alias設定
4. `implementation/semantic-color-map.md` — 意味色の固定対応
5. `validation/ACCEPTANCE_CHECKLIST.md` — 完了判定
6. `references/UPSTREAM_REFERENCE.md` — 公式Y2K UIの固定参照点

## 同梱入力

- `inputs/globals.css` — ユーザー指定theme。色・radius・semantic tokenの唯一のsource of truth。
- `inputs/ISSUE_BODY.md` — 元Issue本文。
- `inputs/source_snapshot.zip` — 議論時に提供されたソーススナップショット。
- `validation/baseline-npm-test.txt` — スナップショットで確認したテストbaseline。

## 優先順位

衝突時は以下の順で優先します。

1. `inputs/globals.css`
2. `references/UPSTREAM_REFERENCE.md` に記載した固定commitの公式component visual/API
3. 既存UIの機能・データ境界
4. `IMPLEMENTATION_HANDOFF.md` の実装規約

不明点を独自解釈で補わず、このhandoffから外れる変更は別Issueとして扱ってください。
