# Upstream reference freeze

## Repository

`MuhamadZafarSyah/y2k-ui`

## Authoritative commit

`d64a99e451cf67aa249d98dcc333cf1bf972cfcf`

このcommitを「公式コンポーネントのビジュアルに可能な限り寄せる」の比較基準とする。

実装中にregistry/master/packageが更新されても追従しない。

## Reference paths

- `components/ui/button.tsx`
- `components/ui/badge.tsx`
- `components/ui/card.tsx`
- `components/ui/tabs.tsx`
- `components/ui/checkbox.tsx`
- `components/ui/label.tsx`
- `components/ui/collapsible.tsx`
- `components/ui/progress.tsx`
- `components/ui/sonner.tsx`
- `components/ui/empty.tsx`
- `components/ui/toggle.tsx`
- `components/ui/toggle-group.tsx`
- `lib/utils.ts`
- `packages/y2kui/cli.js`

GitHub上では以下のbaseで確認できる:

`https://github.com/MuhamadZafarSyah/y2k-ui/blob/d64a99e451cf67aa249d98dcc333cf1bf972cfcf/`

## 公式visualから維持するもの

- 2px dark outline
- flat pastel surfaces
- compact rounded corners
- explicit hover/focus/active states
- Tabsの接続されたtab形状
- CardHeaderのpastel header
- Collapsibleのchevron/open state
- Checkboxのoutline/checked state
- Badgeのpastel variants
- Sonnerのmini-window系visual

## 今回許可する差分

- TS -> JS/JSX
- Vite alias/import適合
- 固定HEX -> `inputs/globals.css` のtheme token

これ以外の差分は原則作らない。
