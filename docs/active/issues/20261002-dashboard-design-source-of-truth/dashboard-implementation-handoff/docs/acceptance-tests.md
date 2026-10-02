# 受け入れ条件・テストマトリクス

## A. 必須受け入れ条件

- [ ] 起動後のホームがサービス紹介ではなくダッシュボードになっている。
- [ ] ホームのページHeaderは `ダッシュボード`。
- [ ] ホーム期間は `7日 / 30日` のみ。
- [ ] 初期期間は7日。
- [ ] 7日/30日の切替で治安指数、一次迷惑率、対象観測数、集計期間、coverage、状態コメントが同じperiodへ連動する。
- [ ] `データ基準日` は `overview.data_end_date`。
- [ ] `今日` / `リアルタイム` という表現が存在しない。
- [ ] 治安指数は既存 `derivePublicOrderIndex()` を使用する。
- [ ] 一次迷惑率・治安指数は既存formatterを使用する。
- [ ] ゲージは一次迷惑率の0〜6%評価境界を表す。
- [ ] 色だけで評価状態を伝えていない。
- [ ] partial時に部分観測が明示される。
- [ ] observation_count=0で算出不可表示になる。
- [ ] 状態コメントはevaluationから決定論的に決まる。
- [ ] 対応候補件数はmanifestのrecord_countと一致する。
- [ ] 対応候補件数は7日/30日切替に連動しない。
- [ ] 候補0件でも行が表示され、詳細画面へ遷移できる。
- [ ] ホームにはNEWバッジを表示しない。
- [ ] ホーム表示のためにkeywords/accounts/comments artifactを取得しない。
- [ ] overview取得失敗でもmanifest由来の候補件数は残る。
- [ ] overview再試行はoverviewのみを対象とする。
- [ ] ホーム30日 → 分析概要で30日を維持する。
- [ ] 分析概要7日 → ホームで7日を維持する。
- [ ] 分析概要30日 → ホームで30日を維持する。
- [ ] 分析概要1日 → ホームで7日に正規化する。
- [ ] periodはlocalStorageへ保存しない。
- [ ] `<=820px` は下部ナビ + 1カラム。
- [ ] `>820px` は左サイドバー + 主要領域2カラム。
- [ ] ホームには戻るボタンを表示しない。
- [ ] 正式マスコット画像がなくてもUIが成立する。

## B. 自動テスト推奨ケース

### 1. Period state

| case | start | action | expected |
| --- | --- | --- | --- |
| initial | app load | none | dashboard=7d |
| dashboard switch | 7d | click 30日 | dashboard=30d |
| carry to overview | dashboard 30d | 分析概要を見る | overview=30d |
| carry from overview | overview 7d | home | dashboard=7d |
| carry from overview | overview 30d | home | dashboard=30d |
| normalize | overview 1d | home | dashboard=7d and shared state=7d |

### 2. Overview values

fixtureごとに検証:

- complete + goal_met
- complete + goal_unmet
- complete + caution
- complete + warning
- partial
- observation_count=0

確認項目:

- evaluation label
- score label
- rate label
- observation count
- period dates
- marker position / absence
- status comment

### 3. Network behavior

mock fetchでホーム初期表示を検証。

期待fetch:

```text
optimicom-ui-release.json
<overview artifact path>
```

期待しないfetch:

```text
<keywords artifact path>
<accounts artifact path>
<comments artifact path>
```

### 4. Overview error

overview fetchを失敗させる。

期待:

- `コメント欄の状態を読み込めませんでした。`
- retry button
- keyword record_countは表示継続
- account record_countは表示継続
- retryでoverview pathだけ再fetch

### 5. Candidate navigation

- keyword row click → keywords画面
- account row click → accounts画面
- query/filter/selectionは通常初期状態
- count=0でもclick可能

### 6. Accessibility

- 期間groupに `aria-label="分析期間"`
- active periodに `aria-pressed="true"`
- bottom nav currentに `aria-current="page"`
- errorに `role="alert"`
- overview loading sectionに `aria-busy="true"`
- gaugeに `aria-hidden="true"`
- candidate row keyboard activation
- focus-visibleが消えていない

## C. 手動確認

### Desktop (>820px)

- sidebarが表示される
- dashboardの主要状態カード + 状態コメントが横並び可能
- 対応候補はその下
- 過度な空白・横スクロールなし

### Mobile (<=820px)

- bottom navが表示される
- すべて1カラム
- Headerに `ダッシュボード`
- bottom navでホームがcurrent
- 44px以上の操作領域
- safe-areaを含めコンテンツがbottom navに隠れない

## D. 非回帰

- [ ] コメント一覧の既存挙動を変更していない。
- [ ] キーワード候補の既存検索・コピー状態を変更していない。
- [ ] ブロック候補の既存検索・コピー・ブラウザ内マーク状態を変更していない。
- [ ] release root validationを変更していない。
- [ ] 初期2秒loading演出を変更していない。
- [ ] 分析概要の1日表示を失っていない。
