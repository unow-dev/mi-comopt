# Verification Checklist

## Scope

- [ ] diff対象が `src/ui/styles.css` と `src/ui/App.jsx` のみ
- [ ] `App.jsx` のdiffがsemantic styling class追加だけ
- [ ] DOM構造・文言・state・handler・データ参照に変更なし
- [ ] semantic filter colorに `:nth-child()` 等のDOM順依存なし

## Visual System

- [ ] fixed base tokensを指定HEXで使用
- [ ] 明るいAqua / desktop系Y2K表現になっている
- [ ] Strong: Hero / view switcher / card-frame
- [ ] Medium: controls / buttons / details / metrics / toast
- [ ] Weak: repeated keyword/account rows
- [ ] 新規font・画像asset・scanline・noise・常時glow等を追加していない

## Semantic Colors

- [ ] 高推奨 `#D9FFF4` / `#075B4C`
- [ ] 中推奨 `#FFF3B0` / `#6B4C00`
- [ ] 任意 `#ECEEFF` / `#4B4865`
- [ ] category `#E7E8FF` / `#3D3698`
- [ ] NEW `#FFE0F4` / `#8E1457`
- [ ] direct `#E8278A`
- [ ] reactive `#E89B00`
- [ ] normal `#008FD1`
- [ ] badgeと対応filterが同じsemantic color family

## Interaction / Accessibility

- [ ] button default状態
- [ ] button hover状態
- [ ] button active/selected状態
- [ ] keyboard `:focus-visible` 状態
- [ ] focusをhoverだけで代替していない
- [ ] 重要な通常文字・badge文字のcontrastが4.5:1以上
- [ ] reduced-motion時に装飾的motionを実質停止

## Views / States

- [ ] `keywords`
- [ ] `accounts`
- [ ] `labels`
- [ ] keyword detail open
- [ ] account detail/evidence open
- [ ] copy + toast
- [ ] 「すべて」selected
- [ ] 「高推奨」selected
- [ ] 「中推奨」selected
- [ ] 「任意」selected
- [ ] NEW off/on
- [ ] empty state

## Responsive

- [ ] desktop幅
- [ ] 920px
- [ ] 600px
- [ ] 320px
- [ ] 既存breakpoint以外を追加していない
- [ ] 320pxで意図しないページ全体horizontal scrollなし
- [ ] mobileでもsemantic colorsと基本Y2K surfaceを維持

## Automated Verification — 実リポジトリで実行

```sh
npm test
npm run build
```

- [ ] `npm test` pass
- [ ] `npm run build` pass

## PR Evidence

- [ ] desktop / 920 / 600 / 320 の代表スクリーンショット
- [ ] 3 viewsの証跡
- [ ] detail openの証跡
- [ ] selected semantic filterの証跡
- [ ] toastの証跡
- [ ] keyboard focusの証跡
- [ ] test/build成功結果
- [ ] 本チェックリスト相当のVisual QA結果
