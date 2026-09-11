# Issue: UIに「彼女、お借りします。 inspired Web UI Kit」を適用する

## 目的

既存UI全体を、同梱の「彼女、お借りします。 inspired Web UI Kit」適用済み3画面の外観へ置換する。現行機能の意味を最優先で維持し、それと衝突しない範囲では適用済みHTMLとの外観完全一致を目指す。

## Visual reference

- `docs/active/temp/filter_keyword_ui_kit_applied.html`
- `docs/active/temp/block_account_ui_kit_applied.html`
- `docs/active/temp/comment_label_summary_ui_kit_applied.html`
- 未定義状態の補助: `docs/active/temp/kanokari_web_ui_kit_expanded.html`

referenceのダミー詳細文や画面遷移デモは製品仕様ではない。現行データ・機能をreferenceのvisual languageへ載せる。

## 実装方針

- SPAの3タブ構成を維持し、新routingは導入しない。
- タブ名は`フィルターキーワード / ブロックアカウント / コメントラベル集計`。
- top tabsはreferenceどおり通常フロー。現行fixed/scroll-hideを削除。
- data/state logicを維持し、presentation layerをreference HTMLに近いDOM/CSSへ再構築する。
- Y2K/shadcn wrapperへのCSS上書きで実現しない。
- UI Kit token、system font、body background、card/hero/intro、breakpoint 640/390、reduced-motionをreferenceから直接移植する。
- `index.html`へ`viewport-fit=cover`を追加。

## 機能保持

### フィルターキーワード

- 全候補をsource順で表示。referenceの4件へ削減しない。
- recommendationは常に1つactive、NEWのみとのAND条件。
- filter対象外cardはunmountせずhidden。0件時`条件に一致する候補はありません。`
- NEWは既存14日判定、session mount時刻基準を維持。
- detailにはdirect/reactive/normal/精度、表記揺れ、match typeを表示。
- 複数detail同時open可。
- copy成功時buttonは1300ms`コピー済み`、toastは1600ms。Clipboard fallbackと失敗処理を維持。

### ブロックアカウント

- 全候補をsource順で表示。referenceの5件へ削減しない。
- detail先頭に`判定ラベル / 該当コメント数 / 候補条件`を表示。
- その下に既存evidenceの日時・本文を全文表示。truncateしない。
- 複数detail同時open可。
- copy成功時buttonは1400ms`コピー済み`、toastは1600ms。
- 0件時`該当するアカウント候補はありません。`

### コメントラベル集計

- referenceのsummary panel / label cards / progress / data noteへ一致。
- counts/totalから割合を小数1桁で計算。
- 0%はprogress fillも0幅。

### Toast

- app全体でsingleton。
- stackしない。
- 新toastで前timerをreset。
- failureは同geometryで`--danger`背景。

## Cleanup

- `y2k-ui-lib`撤去。
- `@y2k` registry撤去。
- runtime UIから`--y2k-*`およびY2K utility参照を0件にする。
- `components.json`削除。
- 旧`src/components/ui/*`は新Appから参照しない。repo-wide consumerがなければ削除。
- Tailwind/shadcn/Sonner等はrepo-wide参照0になったものを依存から削除。
- RadixはTabs用途で維持してよい。
- `candidate-data.js`, adapter, NEW判定, generated JSONのarchitecture boundaryは維持。
- activeな旧Y2K issueは本issueによりsupersedeし、active requirementとして併存させない。

## Acceptance

- `npm test`全成功。
- `npm run build`成功。
- referenceと同一環境で`1280×900`, `640×900`, `390×844`を比較。641px/391pxも境界確認。
- keyword先頭4件、account先頭5件、label画面全体について、layout/spacing/color/gradient/border/radius/shadow/typography/line breakに意図しない差がない。
- detail、filter+NEW、copy済み+toast、empty stateも確認。
- NEW visual比較時のみ環境側の時刻を2026-09-11相当に固定し、productionへtest-only clock APIを追加しない。
- referenceより多い実データ、保持したdetail情報、0%補正、failure/empty等の未定義状態だけを意図的差分として許容する。
