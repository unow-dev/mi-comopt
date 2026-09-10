# Work Task Sequence: Y2K UI implementation

## Purpose

既存UIの情報設計と機能挙動を維持したまま、明るいAqua / desktop系の一貫したY2K visual systemを適用し、操作性・意味識別・アクセシビリティ・responsive表示を満たした状態にする。

## Task Sequence

- [ ] 1. 実装開始前の確認範囲で、AIエージェントが、正本仕様、変更対象、現行UIの構造、受入条件、および対象外事項を確認する。
- [ ] 2. semantic styling hookの変更範囲で、AIエージェントが、フィルターボタンへ意味に対応したスタイル用classを追加する。
- [ ] 3. 基本visual systemの実装範囲で、AIエージェントが、固定color token、surface階層、shape、typography、および主要状態の表現を適用する。
- [ ] 4. 意味表現の実装範囲で、AIエージェントが、badge・filter・label barを指定されたsemantic color familyへ統一する。
- [ ] 5. 操作性とresponsive表示の実装範囲で、AIエージェントが、focus-visible、motion設定、既存breakpointでの表示強度、および320px幅での表示を受入条件に適合させる。
- [ ] 6. 変更境界とvisual QAの検証範囲で、AIエージェントが、機能回帰・Scope逸脱・各viewと代表状態・semantic color・contrast・viewport表示を確認する。
- [ ] 7. 自動検証の範囲で、AIエージェントまたはCIが、実リポジトリ上のtestとbuildを実行して結果を確認する。
- [ ] 8. 作業結果の範囲で、AIエージェントが、実施内容、Visual QA結果、test/build結果、およびPR用証跡を記録する。

## Work Notes

- 実装仕様の唯一の正本は `ISSUE_BODY.md` とする。`IMPLEMENTATION_HANDOFF.md` は変更境界、`VERIFICATION_CHECKLIST.md` は完了時の確認項目として参照する。
- 変更を許可するのは `src/ui/styles.css` と `src/ui/App.jsx` のみである。`App.jsx` はフィルターボタンのsemantic styling class追加に限り、DOM構造、文言、state、handler、データ参照、filter条件、ARIA、機能仕様を変更しない。
- semantic filter colorはDOM順に依存させず、既存のactive modifierと意味別classを併用する。badge、対応filter、label barには指定されたsemantic paletteを一貫して使用する。
- 装飾強度はHero・view switcher・card frameをStrong、controls・buttons・detail・metrics・toastをMedium、反復rowをWeakとする。指定外のfont、asset、DOM装飾、常時animation、scanline、noise、rainbow chrome等は追加しない。
- 可読性・意味識別、操作状態の明確さ、既存レイアウト維持、Y2K装飾の強さの順で判断する。palette、DOM構造、機能仕様、Acceptance Criteriaの変更が必要になった場合は、実装で判断せず人間へ差し戻す。
- `reference/current-ui-snapshot/` は現行構造を確認するための参照資料であり、完全なrepository checkoutではない。最終的なvisual QA、`npm test`、`npm run build` は実リポジトリで判定する。
- PR証跡にはdesktop・920px・600px・320px、3 view、detail open、selected filter、toast、keyboard focus、Visual QA、test/buildの結果を含める。
