# Issue: UIに「Y2K UI」を適用する

## 目的

既存UIの情報設計・機能挙動を維持したまま、UI全体へ一貫したY2Kレトロフューチャー表現を適用する。

採用する方向性は、2000年前後の明るいAqua / desktop系UIを基調とする。装飾性は可読性・意味識別・操作性を上回らないこと。

## Scope

変更対象は以下に限定する。

- `src/ui/styles.css`
- `src/ui/App.jsx`
  - visual styling用のsemantic class追加のみ許可する
  - DOM構造、文言、状態管理、イベント処理その他のロジックは変更しない

データ、adapter、JSON、既存の機能仕様は変更しない。

## Design Direction

Y2K表現の中心要素を以下に固定する。

- ice blue〜pale lavender〜near-whiteの明るい背景
- 白〜半透明白のsurface
- 青みを持つ境界線
- 上辺の明るいinner highlight
- 下方向の淡いblue shadow
- Aqua的な丸みと軽い立体感
- electric blue / cyanを主要accent
- violetを補助accentとして限定利用

装飾強度には階層を付ける。

1. **Strong**
   - Hero
   - view switcher
   - outer `card-frame`
2. **Medium**
   - filter controls
   - buttons
   - detail surfaces
   - metrics
   - toast
3. **Weak**
   - keyword/account等の反復row
   - 大量データを読む領域

ファーストビューではY2K性を明確にする一方、一覧内部では情報密度と判読性を優先する。

## Base Color Tokens

以下を固定値として使用する。

```css
--color-ink: #15213a;
--color-muted: #596984;

--color-page-blue: #eafbff;
--color-page-lavender: #f1ecff;
--color-page-base: #f7fbff;

--color-surface: #fcfeff;
--color-surface-soft: #eef7ff;

--color-line: #b7cbea;
--color-line-strong: #7ba7dd;

--color-accent: #125bc7;
--color-cyan: #00a6cf;
--color-violet: #7057d9;

--color-focus: #125bc7;
```

実装者判断によるpaletteの変更は行わない。変更が必要な場合はIssue側の仕様変更として扱う。

## Semantic Colors

既存の意味カテゴリは維持しつつ、以下のY2K paletteへ変更する。

| 意味 | 背景 / surface | foreground / bar |
|---|---|---|
| 高推奨 | `#D9FFF4` | `#075B4C` |
| 中推奨 | `#FFF3B0` | `#6B4C00` |
| optional / 任意 | `#ECEEFF` | `#4B4865` |
| category | `#E7E8FF` | `#3D3698` |
| NEW | `#FFE0F4` | `#8E1457` |
| direct | — | `#E8278A` |
| reactive | — | `#E89B00` |
| normal | — | `#008FD1` |

同じ意味を表すUI要素は同じsemantic color familyを使用する。

- 高推奨badgeと高推奨filter
- 中推奨badgeと中推奨filter
- 任意badgeと任意filter
- NEW badgeとNEW filter
- direct / reactive / normalの各表示

意味カテゴリを持たないview切替、copy、detail toggle、focus等はgeneric electric-blue系を使用する。

### Filter用semantic class

`App.jsx` のフィルターボタンには以下のstyling hookを付与する。

- 「すべて」: `recommendation-tab--all`
- 「高推奨」: `recommendation-tab--high`
- 「中推奨」: `recommendation-tab--medium`
- 「任意」: `recommendation-tab--optional`
- 「NEW」: `recommendation-tab--new`

既存の `recommendation-tab--active` は選択状態modifierとして併用する。

DOM順に依存する `:nth-child()` 等でsemantic colorを決定してはならない。

## Shape

radiusの基準を以下とする。

- outer frame: `18px`
- view switcher / major controls: `12px`
- row / detail surface: `10–12px`
- badge / pill: `999px`

単純に丸みを増やすのではなく、surface・border・highlight・shadowの組み合わせでAqua的な立体感を作る。

## Typography

現行のsystem font stackを維持する。

新規Web fontやpixel fontは導入しない。

monospaceは、現在技術情報として扱われているcode等の用途に限定する。

## Interaction

button類では少なくとも以下を視覚的に区別できること。

- default
- hover
- active / selected
- `:focus-visible`

`active / selected` はhoverより明確に強い状態表現とする。

全buttonにkeyboard操作で視認できる `:focus-visible` を設ける。focusはgeneric accent blueを使用し、hover状態だけで代替しない。

## Motion

許可するmotionは、hover、状態変更、detail、toast等の短時間transitionのみとする。

目安は `160–200ms`。

常時animationは追加しない。

`prefers-reduced-motion: reduce` では、新規・既存を含む装飾的transition / animationを実質停止できる状態にする。

## Responsive

既存breakpointを維持する。

- `920px`
- `600px`

新規breakpointは追加しない。

mobileでもY2K visual system自体は維持する。ただし、小さいviewportでは以下を弱めてよい。

- outer shadow
- decoration gradientの主張
- spacing

semantic colors、surfaceの基本表現、interaction stateはdesktop/mobileで共通とする。

320px幅でページ全体に意図しないhorizontal scrollを発生させない。

## Out of Scope

以下は導入しない。

- pixel font
- 本文全体へのmonospace適用
- scanline
- noise overlay
- blinking
- marquee
- 独自cursor
- 常時glow
- rainbow chrome
- loop animation
- 新規画像asset
- 新規Web font
- `backdrop-filter` を前提としたglassmorphism
- 情報構造の変更
- 文言変更
- データ変更
- filterロジック変更
- view切替仕様変更
- copy仕様変更
- detail開閉仕様変更
- toastの機能仕様変更

## Acceptance Criteria

- [ ] UI全体が明るいAqua / desktop系Y2K visual systemへ変更されている
- [ ] page、major surface、controls、rows、detail surface、badge、toastに一貫したvisual systemが適用されている
- [ ] 指定したbase color tokensを使用している
- [ ] 高推奨・中推奨・任意・category・NEW・direct・reactive・normalが指定semantic paletteになっている
- [ ] 同じ意味を示すbadge/filter等で同じcolor familyを共有している
- [ ] semantic colorをDOM順へ依存して割り当てていない
- [ ] Hero / view switcher / card frame、controls/detail、反復rowの順で装飾強度が下がっている
- [ ] 既存の情報・文言・表示データ・機能挙動が変更されていない
- [ ] `App.jsx` の変更がstyling用semantic classの追加だけに限定されている
- [ ] 全buttonに明確な `:focus-visible` がある
- [ ] 通常サイズの重要テキストおよびbadge文字がWCAG AA相当の4.5:1以上を満たす
- [ ] `prefers-reduced-motion` に対応している
- [ ] 既存の920px / 600px breakpointを維持している
- [ ] 320px幅で意図しないページ全体のhorizontal scrollがない
- [ ] Out of Scopeに列挙した装飾・機能変更を追加していない
- [ ] `npm test` が実リポジトリ上で成功する
- [ ] `npm run build` が実リポジトリ上で成功する

## Visual QA

以下を確認する。

### Viewport

- 320px
- 600px
- 920px
- desktop幅

### Views

- `keywords`
- `accounts`
- `labels`

### Representative states

- 通常row
- hover
- detail open
- copy操作
- 各recommendation filter selected
- NEW filter off / on
- keyboard `:focus-visible`
- empty state
- toast visible
- reduced-motion有効時

全データ・全rowのスクリーンショット提出は不要とし、代表状態で検証する。

## PR Evidence

PRには以下を含める。

- desktop / 920px / 600px / 320pxの代表スクリーンショット
- `keywords` / `accounts` / `labels` の3 viewを確認できる証跡
- detail、selected filter、toast、keyboard focusの代表状態
- `npm test` 成功結果
- `npm run build` 成功結果
- Visual QA実施結果

pixel-perfectなスクリーンショット一致は要求しない。

## Review Policy

blockingとするのは以下。

- Acceptance Criteria違反
- 機能regression
- 可読性の問題
- semantic colorの識別性低下
- keyboard操作性の問題
- responsive破綻
- Scope違反

Acceptance Criteriaに存在しない美的嗜好のみを理由とした変更要求はblockingにしない。必要であれば別Issueとして扱う。

## Decision Priority

未記載のCSS実装詳細で判断が必要になった場合は、以下の順で優先する。

**可読性・意味識別 > 操作状態の明確さ > 既存レイアウト維持 > Y2K装飾の強さ**

この優先順位を理由として、指定palette、DOM構造、機能仕様、Acceptance Criteriaを独自に変更してはならない。

## Source of Truth

本Issue本文を実装仕様の唯一の正本とする。

議論ログや参考画像はnon-normativeとし、本Issue本文と矛盾する場合は本Issue本文を優先する。

仕様変更が必要な場合は、実装側で先行して逸脱せず、Issue側の仕様変更として扱う。
