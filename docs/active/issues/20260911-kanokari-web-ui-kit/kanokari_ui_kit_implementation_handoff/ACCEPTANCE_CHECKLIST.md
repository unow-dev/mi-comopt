# Acceptance checklist

以下をすべて満たしてDone。

## A. Build / tests

- [ ] 実リポジトリで`npm test`が全件成功
- [ ] 実リポジトリで`npm run build`が成功
- [ ] 既存テストを削除/弱体化して通していない
- [ ] logic変更を追加した場合は既存`node:test`体系で必要なtestを追加
- [ ] このissueだけのためにPlaywright等の恒久visual test基盤を導入していない

## B. Static cleanup

repo-wideで確認する。

- [ ] `y2k-ui-lib`参照 0
- [ ] `@y2k` registry 0
- [ ] UI実行対象の`--y2k-`参照 0
- [ ] UI実行対象の`bg-y2k-` / `border-y2k-`等 0
- [ ] `src/ui/globals.css`から`@import "tailwindcss"` 0
- [ ] `src/ui/globals.css`から`shadcn/tailwind.css` 0
- [ ] `src/ui/globals.css`から`tw-animate-css` 0
- [ ] Appから旧`src/components/ui/*` import 0
- [ ] `components.json`削除
- [ ] 不要依存削除後のlockfile整合

例:

```sh
rg -n 'y2k-ui-lib|@y2k|--y2k-|(?:bg|border|text)-y2k-' .
rg -n 'components/ui|sonner|tailwindcss|tw-animate-css|shadcn/tailwind.css' src package.json vite.config.js
```

検索結果がある場合、仕様上残す合理的理由がない限り未完了。

## C. Functional behavior

### Tabs

- [ ] 初期viewはフィルターキーワード
- [ ] 3タブ切替可能
- [ ] タブはfixedではなく通常フロー
- [ ] keyboard/focus navigationを維持
- [ ] URL routing/history/hash/queryを新設していない
- [ ] active viewに応じdocument.titleが変わる

### Keyword filtering

- [ ] 推奨度は常に`すべて/高推奨/中推奨/任意`のどれか1つactive
- [ ] active pill再クリックで「選択なし」にならない
- [ ] `NEWのみ`が動作
- [ ] recommendationとNEWはAND
- [ ] 全keyword cardはmountを維持し、filter対象外だけhidden
- [ ] filterで隠して戻しても同一view内のcard local stateが維持
- [ ] 0件時`条件に一致する候補はありません。`
- [ ] source順序を維持し全件表示

### NEW

- [ ] 14日判定は既存`isNewCandidate`/config semanticsを維持
- [ ] session mount時刻を基準にし、NEW更新timerを追加していない

### Detail

- [ ] keyword detailにdirect/reactive/normal/精度を表示
- [ ] variantがある場合だけ表記揺れ行を表示
- [ ] matchTypeがある場合だけ行を表示
- [ ] account detail先頭3行が`判定ラベル/該当コメント数/候補条件`
- [ ] account evidenceの日時・本文を全文表示
- [ ] evidence長文をtruncate/clampしない
- [ ] 複数detailを同時にopen可能

### Copy / toast

- [ ] Clipboard API成功
- [ ] Clipboard API失敗時document fallback
- [ ] fallbackも失敗した場合failure toast
- [ ] keyword buttonは成功後1300ms`コピー済み`
- [ ] account buttonは成功後1400ms`コピー済み`
- [ ] 複数buttonのcopied状態は独立
- [ ] toastはsingletonでstackしない
- [ ] toast 1600ms
- [ ] 新toastで前timerをreset
- [ ] failure時buttonを`コピー済み`にしない

### Label summary

- [ ] total/countを実データから表示
- [ ] percentageを小数1桁で再計算
- [ ] total=0で`0.0%`
- [ ] 0% progress fillは視覚的にもwidth 0
- [ ] snapshot表示
- [ ] referenceのdata note表示

## D. Visual acceptance

### 比較環境

reference HTMLとReact実装を**同一マシン・同一OS・同一Chromium系ブラウザ・device scale 1**で比較する。

- [ ] `prefers-reduced-motion: reduce`
- [ ] system font stackはreferenceと同一
- [ ] visual test目的のWeb fontを導入していない

主要viewport:

- [ ] `1280 × 900`
- [ ] `640 × 900`
- [ ] `390 × 844`

境界確認:

- [ ] `641px`幅
- [ ] `391px`幅

### 比較状態

- [ ] keyword通常状態
- [ ] account通常状態
- [ ] label summary通常状態
- [ ] recommendation active状態
- [ ] recommendation + NEW AND状態
- [ ] keyword detail open
- [ ] account detail open
- [ ] keyword copy済み + toast
- [ ] account copy済み + toast
- [ ] empty state
- [ ] narrow viewportのcopy button折返し

NEW比較時だけ比較環境の時計を`2026-09-11`相当に固定する。production codeへ`?now=`等のtest-only public interfaceを追加しない。

snapshotデータでは2026-09-11基準で:

- `わからせ`はNEW
- 高推奨+NEWは2件
- 中推奨+NEWは0件
- 任意+NEWは0件

empty state確認には`中推奨 + NEW`または`任意 + NEW`を使用できる。

### 直接比較可能な領域

- keyword: referenceと一致する先頭4カードを直接比較
- account: referenceと一致する先頭5カードを直接比較
- labels: 画面全体を直接比較

実データがreferenceより多いためページ全長の同一heightは要求しない。それ以降は同一card styleの反復であることを確認。

### 判定方法

固定golden画像の「全pixel差0」をDone条件にしない。system font/anti-alias差による偽陽性を避ける。

以下に**意図しない差がないこと**を確認する。

- layout / position
- width / height
- spacing / padding / gap
- colors / gradients
- borders
- radius
- shadows / backdrop
- typography size/weight/line-height/letter-spacing
- line breaks
- hover/focus/active/open/copied/toast states

## E. 許容差分の監査

referenceとの差が次のいずれかに該当するか確認。

- [ ] 3番目tab名を`コメントラベル集計`へ修正
- [ ] 実データ全件表示による追加height
- [ ] keyword実指標detail
- [ ] account evidence detail
- [ ] 0% progressの0幅
- [ ] failure/empty等reference未定義状態
- [ ] SPA/accessibilityを維持するための視覚非影響差

上記以外の差は原則修正対象。

## Verification note

- 2026-09-12時点の実リポジトリで、production buildは成功した。
- 全テストは124件中107件成功・17件失敗。失敗はUI変更前から継続する候補成果物の再構成hash不一致であり、今回のUI変更範囲外の未解決事項である。
- 実行対象コードの静的cleanup、3画面、主要viewport、境界幅、reduced-motion、keyboard/focus、filter/NEW、empty、detail、copy/toast、長文evidenceを確認した。
