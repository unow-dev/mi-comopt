# Recommended change sequence

この順序で進める。途中でAppを全面書換えしてから依存/configを直す進め方は避ける。

1. **Baselineを保存**
   - `npm test` 結果を保存
   - source snapshotとの差分を確認

2. **Dependency/config**
   - `y2k-ui-lib` を `0.0.3` exactへ変更
   - `components.json` を配置
   - `jsconfig.json` を配置
   - Vite `@` aliasを追加
   - `npm install` でlockfile生成

3. **公式component取得**
   - handoffで指定した12 componentだけ追加
   - `src/components/ui` 配置を確認

4. **公式componentのtheme token化**
   - 固定HEXを `y2k-*` / semantic tokenへ置換
   - DOM/API/state/spacingは維持
   - `src/lib/utils.js` を `clsx + twMerge` 化

5. **App置換 — 外側から内側**
   - 3-view Tabs
   - Hero Card
   - Keyword filter: ToggleGroup + Checkbox
   - Keyword Card + Badge + Button + Collapsible
   - Account Card + Button + Collapsible
   - Label Card + Badge + Progress
   - Empty
   - Sonner

6. **旧CSS/state削除**
   - component visualの旧classを削除
   - 自作toast state/timer削除
   - layoutに必要なCSSだけ残す

7. **Functional regression確認**
   - filter/copy/detail/summaryを確認
   - adapter/data/new logicに差分がないことを確認

8. **Acceptance**
   - test
   - build
   - 1280/768/320 × 6状態のvisual review
   - scope guard確認
