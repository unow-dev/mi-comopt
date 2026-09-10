# Acceptance checklist

## Build / tests

- [ ] `y2k-ui-lib` が `0.0.3` exactで記録されている
- [ ] `package-lock.json` が生成・commitされている
- [ ] `npm run build` が成功する
- [ ] `npm test` のfailureがbaselineの3件より増えていない
- [ ] candidate-data-adapter関連テストが成功
- [ ] new-badge関連テストが成功
- [ ] smoke testが成功

## Component adoption

- [ ] 上段3-view切替が公式 `Tabs`
- [ ] 推奨度がsingle `ToggleGroup`
- [ ] NEWが `Checkbox + Label`
- [ ] Keyword candidateが `Card`
- [ ] Account candidateが `Card`
- [ ] 詳細/根拠が独立 `Collapsible`
- [ ] 各copy actionが `Button`
- [ ] recommendation/category/NEW/classificationが `Badge`
- [ ] label summaryが `Progress`
- [ ] 0件状態が `Empty`
- [ ] copy通知が `Sonner`

## Theme / visual

- [ ] `src/ui/globals.css` が同梱 `inputs/globals.css` と一致する
- [ ] Y2K色の新規HEXが `globals.css` 外に存在しない
- [ ] 公式componentの2px outlineが維持されている
- [ ] 公式componentのradius/state transitionを不必要に変更していない
- [ ] focus-visibleを消していない
- [ ] gradientを追加していない
- [ ] glassmorphismを追加していない
- [ ] neon glowを追加していない
- [ ] 大きなdrop shadowを追加していない
- [ ] 偽window controlsを追加していない

## Functional regression

- [ ] 3ビューすべて表示できる
- [ ] 推奨度4条件のfilter結果が変更前と一致する
- [ ] NEW only filterが動く
- [ ] Keyword詳細で既存metric/variants/match typeが失われていない
- [ ] Account詳細で根拠件数/日時/commentが失われていない
- [ ] copy成功時に成功toastが出る
- [ ] clipboard API不可時もfallbackが残る
- [ ] label summaryの総件数/count/割合/snapshot refが維持される
- [ ] `candidate-data.js` 以外からgenerated JSONを直接importしない

## Responsive / visual review

以下の3 viewport × 6状態を確認する。

Viewports:

- [ ] 1280px
- [ ] 768px
- [ ] 320px

States:

- [ ] Keyword初期表示
- [ ] Keyword詳細1件展開
- [ ] Keyword推奨度filter + NEW filter
- [ ] Account初期表示 + 根拠1件展開
- [ ] Label summary
- [ ] Copy toast表示

各状態で:

- [ ] document全体のhorizontal overflowなし
- [ ] 320pxで本文/Badge/Buttonが重ならない
- [ ] 長いkeyword/handle/commentがbox外へ突き抜けない
- [ ] Tabs/ToggleGroupの局所horizontal scroll以外に横scrollなし
- [ ] 320pxでdetail metricsが1列
- [ ] keyboard focusが見える

## Scope guard

- [ ] `src/data/*` を変更していない
- [ ] candidate extraction/classificationロジックを変更していない
- [ ] NEW判定仕様を変更していない
- [ ] architecture failureをこのIssueで修正していない
- [ ] unrelated refactorを混ぜていない
