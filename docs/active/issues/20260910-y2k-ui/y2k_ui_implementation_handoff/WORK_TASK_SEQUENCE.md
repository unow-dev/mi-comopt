# Work Task Sequence: Y2K UI実装

## Purpose

既存UIの情報設計・データ・判定ロジックと操作挙動を維持したまま、`y2k-ui-lib` の公式component visualに基づくY2K UIを適用し、機能回帰・アクセシビリティ・レスポンシブ表示を含む受入条件を満たした状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、確定仕様、変更対象、優先順位、受入条件、および対象外事項を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、現行UIの構造、既存componentの状態、依存設定、テストbaseline、および実装後に比較すべき機能境界を確認する。
- [x] 3. 仕様逸脱判断の範囲で、人間が、既存機能・データ境界・判定ロジック・公式visual/APIの維持が困難な事項、またはhandoff外の変更が必要な事項について、実装継続または別Issue化を判断する。
- [x] 4. 依存と構成の実装範囲で、AIエージェントが、固定バージョンのUIライブラリ、Vite/JavaScript向け設定、パス解決、およびlockfileを整備する。
- [x] 5. 公式component導入の範囲で、AIエージェントが、確定したcomponent群を公式参照commitのvisual・API・state表現に沿って利用可能な状態へ整備する。
- [x] 6. Themeと共通ユーティリティの実装範囲で、AIエージェントが、指定theme token、semantic color map、`cn()` の結合規則、および公式componentの許可差分を適用する。
- [x] 7. 画面構成の実装範囲で、AIエージェントが、3ビュー切替、Hero、keyword候補、account候補、label summary、空状態、およびcopy通知を確定したcomponent compositionへ統合する。
- [x] 8. 機能回帰と表示責務の実装範囲で、AIエージェントが、既存filter・NEW判定・copy fallback・detail情報・summary情報を維持し、旧component visualと不要なtoast/state/CSSを整理する。
- [x] 9. 自動検証の範囲で、AIエージェントまたはCIが、依存導入後のtest・build・smoke test・candidate data adapter・NEW badge関連検証を実行し、baselineとの差分を確認する。
- [x] 10. レスポンシブとVisual QAの範囲で、AIエージェントまたはCIが、1280px・768px・320pxの6状態について、overflow、重なり、長文、detail metrics、keyboard focus、および禁止された装飾の有無を確認する。
- [x] 11. 受入と作業結果の範囲で、AIエージェントが、acceptance checklist、scope guard、実施内容、検証結果、未解決事項、および運用上の注意点を記録する。

## Work Notes

- handoffの優先順位は、`inputs/globals.css`、`references/UPSTREAM_REFERENCE.md` の固定commit、既存UIの機能・データ境界、`IMPLEMENTATION_HANDOFF.md` の実装規約の順とする。
- 対象範囲はUI、公式component、共通ユーティリティ、Vite/package設定、および新規lock/configファイルに限定する。`src/data/*`、候補抽出・分類・NEW判定ロジック、既存architecture testの欠損ディレクトリ問題は変更しない。
- 公式componentはbutton、badge、card、tabs、checkbox、label、collapsible、progress、sonner、empty、toggle、toggle-groupを対象とする。3ビューはTabs、推奨度はsingle ToggleGroup、NEWはCheckbox + Label、候補はCard、詳細はCollapsible、通知はSonnerで表現する。
- 公式visualの2px outline、flat pastel surface、compact radius、hover/focus/active state、既定のDOM/API/spacingを維持する。gradient、glassmorphism、neon glow、大きなdrop shadow、偽window controls、独自animationは追加しない。
- semantic colorは `implementation/semantic-color-map.md` に従い、Y2K色のHEXをFeature側へ追加しない。domainのpinkとシステムエラーの`destructive`を混同しない。
- copy処理はclipboard APIと既存document fallbackを維持し、成功時は指定文言のSonner、両方式失敗時のみ`destructive`のerror toastを表示する。
- 受入時の3 viewportは、Keyword初期表示、Keyword詳細1件展開、Keyword推奨度filter + NEW filter、Account初期表示 + 根拠1件展開、Label summary、Copy toast表示の6状態で確認する。
- baselineの既知failureは3件であり、実装後のfailureをbaselineより増やさない。`npm run build`は依存導入とlockfile生成後の必須確認とする。
- 2026-09-10に作業開始前の状態をコミット（`31da239 chore: baseline before Y2K UI implementation`）してから実装した。
- 固定参照commit `d64a99e451cf67aa249d98dcc333cf1bf972cfcf` に基づく12 componentをJS/Vite構成へ適合し、`y2k-ui-lib` は`0.0.3`へexact pinした。`components.json`、`jsconfig.json`、Vite `@` alias、Tailwind Vite設定、`package-lock.json`を整備した。
- `Tabs`、`Card`、`ToggleGroup`、`Checkbox`、`Label`、`Collapsible`、`Progress`、`Empty`、`Button`、`Badge`、`Sonner`を画面へ統合し、既存data adapter・NEW判定・candidate dataは変更していない。
- copyはClipboard APIからdocument fallbackへ継続し、成功時は指定success Sonner、両方式失敗時だけ`destructive` error Sonnerを表示する。旧toast state/timer/CSSは削除した。
- 実リポジトリbaselineは実装前後とも124 tests / 107 pass / 17 fail。17件は既存のartifact再構成・hash不一致に関するfailureで、UI実装による増加はない。`npm run build`成功、`npm ci --ignore-scripts --dry-run`成功、`git diff --check`成功。
- Chrome実入力でkeyword初期/detail/filter+NEW、account初期/detail、label summary、copy success toastを確認し、1280px・768px・320pxでdocument overflow 0を確認した。320pxのTabsListだけは仕様どおり局所horizontal scrollを許可した。
- `src/lib/utils.js`導入に伴い、欠損ディレクトリ検証は変更せず、shim存在確認のarchitecture testをUI utility併存に更新した。
