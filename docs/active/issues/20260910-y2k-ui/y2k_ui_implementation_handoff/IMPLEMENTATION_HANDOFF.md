# Implementation Handoff

## 実装対象

実リポジトリ上で変更してよいのは次の2ファイルのみ。

- `src/ui/styles.css`
- `src/ui/App.jsx`

`App.jsx` は、フィルターボタンの `className` にsemantic styling hookを追加する目的に限る。要素追加・削除・並べ替え、文言、state、handler、filter条件、ARIA、データ参照等は変更しない。

## 現行コードで確認済みの構造

- view state: `keywords` / `accounts` / `labels`
- recommendation state: `""` / `高推奨` / `中推奨` / `任意`
- NEW state: `newOnly`
- filter共通class: `recommendation-tab`
- selected modifier: `recommendation-tab--active`
- view switcher: `view-switcher__button` / `view-switcher__button--active`
- outer frame: `card-frame`
- semantic badges: `badge--high`, `badge--medium`, `badge--optional`, `category-badge`, `new-badge`
- label bars: `label-summary__row--direct`, `--reactive`, `--normal`
- existing breakpoints: `@media (max-width: 920px)` / `@media (max-width: 600px)`

## App.jsxで行う変更

推奨度フィルターとNEWフィルターに以下のclassを**常時**付与し、選択時だけ既存の `recommendation-tab--active` を併用する。

| button | semantic class |
|---|---|
| すべて | `recommendation-tab--all` |
| 高推奨 | `recommendation-tab--high` |
| 中推奨 | `recommendation-tab--medium` |
| 任意 | `recommendation-tab--optional` |
| NEW | `recommendation-tab--new` |

意味色の割当てに `:nth-child()` を使わない。

## styles.cssで行う変更

1. `:root` にIssue指定のbase color tokensを定義し、既存の主要hard-coded colorをtoken/semantic paletteへ置換する。
2. page backgroundをice blue / pale lavender / near-whiteの穏やかなgradient構成にする。
3. Hero、view switcher、`card-frame` をStrong層として最も明確なAqua/Y2K surfaceにする。
4. controls、buttons、detail surfaces、metrics、toastをMedium層にする。
5. keyword/accountの反復rowはWeak層とし、可読性を優先する。
6. badge/filterのsemantic colorをIssue指定値へ統一する。
7. direct/reactive/normal barをIssue指定値へ変更する。
8. 全buttonの `:focus-visible` を追加する。
9. hover / selected / focusを別状態として識別可能にする。
10. transitionは160–200ms程度に限定し、常時animationは作らない。
11. `prefers-reduced-motion: reduce` で装飾的transition/animationを実質停止する。
12. 既存920px/600px breakpoint内でmobile装飾強度を落とし、breakpoint自体は増やさない。
13. 320pxでページ全体のhorizontal overflowを発生させない。

## 実装してはいけないもの

`ISSUE_BODY.md` の Out of Scope を参照。特に、Y2Kらしさを増す目的でもscanline、noise、pixel font、常時glow、rainbow chrome、独自cursor、loop animation、新規asset/Web font、DOM装飾要素は追加しない。

## 判断が必要になった場合

CSSの具体的な書き方だけは実装者裁量。結果については次の順で判断する。

`可読性・意味識別 > 操作状態の明確さ > 既存レイアウト維持 > Y2K装飾の強さ`

palette、DOM構造、機能仕様、Acceptance Criteriaを変更しないと解決できない場合は、勝手に変更せず仕様側へ差し戻す。

## 参照スナップショットについて

`reference/current-ui-snapshot/` は議論時点の関連ファイルだけを抜き出した参照資料であり、完全なrepository checkoutではない。

handoff作成時にこのスナップショットで `npm test` を実行したところ14件中11件がpass、3件が以下の収録外directory不足によるENOENTでfailした。

- `src/lib`
- `src/processing`
- `src/database`

これはUI変更によるfailureではなく、handoffスナップショットが部分収録であることによる。最終Acceptance Criteriaの `npm test` / `npm run build` は**実リポジトリ上**で判定する。
