# Optimicom React + Tailwind と現行DBの実現可否分類レポート

## 1. レポートの位置付け

- 対象UI: `docs/active/temp/optimicom-react-tailwind`
- 判定対象: ホーム、集計・現状・推移、コメント一覧、フィルターキーワード候補、ブロックアカウント候補
- DB: `var/comment-history.sqlite3`
- 調査日: 2026-09-12
- ベースラインコミット: `16ecffe chore: feasibility review baseline`
- 判定状態: 暫定。分類境界とサンプルデータを本番データとして扱う可否は、作業タスク5の人間判断待ち

このレポートでの分類は、判定境界の承認前に作成した作業用の分類案である。

- **完全実現**: 要求された意味・粒度の値がDBに存在する、またはDBを使わない静的UI操作である。
- **条件付き実現**: DBに候補値または導出材料はあるが、変換規則、時系列契約、更新、実装または永続化の追加が必要である。
- **現時点では実現不可**: 必須データがなく、既存値から意味を壊さずに導出できない。追加データ、仕様変更またはDB変更が必要である。

## 2. 結論

| 対象 | 現状DBだけでの評価 | 主な根拠 |
| --- | --- | --- |
| ホームの説明・ナビゲーション | 完全実現（静的UI） | DB依存なし |
| 最終集計日時 | 条件付き実現 | DBには抽出日時・公開日時があるが、画面はブラウザ現在時刻を表示しており、どの更新を指すか未定義 |
| 6分類の集計・構成比・推移 | 現時点では実現不可 | DBは `direct_nuisance`・`reactive`・`normal` の3分類のみ。6分類への可逆な対応表がない |
| スコア82、GOOD、前週比、総評 | 現時点では実現不可 | スコア式、前週比較の基準、総評の生成結果がない。3分類からの代替表示なら仕様変更が必要 |
| AI推奨対応 | 現時点では実現不可 | 推奨文・優先度・生成時点を保存するデータがない |
| コメント一覧の検索 | 条件付き実現 | 本文、ユーザー名、ハンドルはあるが、6分類での絞り込みラベルがない |
| コメント一覧の6分類タブ | 現時点では実現不可 | 3分類から肯定的・中庸的・批判的・対批判・迷惑・対迷惑を一意に分けられない |
| キーワード候補のDB由来表示 | 条件付き実現 | 現行DBの公開JSONに86候補と評価値がある。画面のリスク表示・理由・件数・更新連携は別途定義が必要 |
| キーワードの検索・推奨度絞り込み・NEW絞り込み | 条件付き実現 | 推奨度、導入日時はあるが、画面の「リスク」との対応、NEWの基準日時、設定の所在を固定する必要がある |
| キーワードのコピー | 完全実現（操作） | ブラウザのClipboard APIおよびフォールバックで実行可能 |
| キーワードの追加済み状態 | 条件付き実現 | 現UIはReact stateのみで、再読込・画面遷移後の永続状態はDBにない |
| ブロック候補の導出 | 条件付き実現 | 現行ポリシーの「direct_nuisance 2件以上」でDBから60ハンドルを導出できるが、配置済み成果物は54件で不一致 |
| ブロック候補のリスク表示 | 現時点では実現不可 | 現行ポリシーは候補閾値のみで、高・中リスクの分類規則がない |
| アカウントの履歴確認 | 条件付き実現 | ハンドル、本文、日付、表示時刻はあるが、正確な投稿時刻・安定ID・履歴の一意性が不足 |
| ブロック済み状態 | 条件付き実現 | 現UIはReact stateのみ。永続的な審査・適用状態の保存先がない |

したがって、完成形UIをそのまま本番データへ置き換えることはできない。まず3分類を表示するUIへ仕様を寄せるか、6分類ラベルと集計契約を追加する必要がある。候補画面は既存のDB由来成果物を利用できる部分が多いが、現在のDB公開行と配置済みアーティファクトの同期を解消する必要がある。

## 3. 対象UIの全画面・表示項目・操作

### 3.1 共通シェル

| UI要素 | 表示・操作 | 実装上の入力 | 分類 |
| --- | --- | --- | --- |
| ブランド | Optimicomロゴ、サービス説明 | JSX固定値 | 完全実現（静的UI） |
| サイドバー | Home / Analyze / Action の5画面ナビゲーション | `navItems`固定値、`screen` state | 完全実現（静的UI） |
| ヘッダー | 画面タイトル・サブタイトル | `TITLES[screen]` | 完全実現（静的UI） |
| 最終集計日時 | 「最終集計日時: YYYY/MM/DD HH:MM」 | `new Date()` のブラウザ現在時刻 | 条件付き実現。DBの抽出・公開・適用日時のどれを表示するか要決定 |
| 通知ボタン | ベルアイコン | クリック処理なし | 現時点では実現不可（通知仕様なし） |
| 戻るボタン | ホームへ戻る | `onChange('home')` | 完全実現（静的UI） |
| モバイルナビ | 5画面切替 | `screen` state | 完全実現（静的UI） |
| トースト | 期間変更・コピー結果を一時表示 | `toast` state、1,800msタイマー | 完全実現（セッション内操作） |

### 3.2 ホーム

| UI要素 | 表示・操作 | 入力 | 分類 |
| --- | --- | --- | --- |
| ヒーロー | サービス名、説明、6分類を扱う旨 | JSX固定文 | 完全実現（静的UI） |
| ホーム画面ナビ | 集計、コメント、キーワード、アカウントへの遷移 | `navItems` | 完全実現（静的UI） |

### 3.3 集計・現状・推移

| UI要素 | 表示・操作 | 入力・粒度 | 分類 |
| --- | --- | --- | --- |
| 期間切替 | 24時間 / 7日間 / 30日間 | `period` state。表示データは変化せず、トーストだけ変化 | 条件付き実現。期間の基準時刻・タイムゾーン・欠測時の扱いが必要 |
| Optimicom Score | 82 / 100、GOOD、進捗バー | 固定値 | 現時点では実現不可。DBにスコア式とスコア履歴なし |
| 総評 | 健全性、批判的コメント増加、対批判の確認推奨 | 固定文 | 現時点では実現不可。根拠値と生成結果なし |
| 総コメント数 | 18,420、前週比 +8.4% | 固定値 | 現時点では実現不可。DBの観測数は27,299、ラベル済みは24,622で、6分類の18,420とは一致しない |
| 集計チャート | 6分類の構成比、18.4K | 固定の円グラフと割合 | 現時点では実現不可。6分類ラベルなし |
| 推移チャート | 9/6〜9/12の日次、6本の線、0〜3,000軸 | SVG座標・日付固定 | 現時点では実現不可。6分類なし、DBの最終投稿日は9/5 |
| AI推奨対応 | Priority A〜Cの3カード | 固定文 | 現時点では実現不可。AI出力・優先度・生成時点なし |

### 3.4 コメント一覧

| UI要素 | 表示・操作 | 入力・粒度 | 分類 |
| --- | --- | --- | --- |
| 6分類タブ | 各分類名と件数 | `COMMENT_KINDS` の固定6件 | 現時点では実現不可。DBは3分類のみ |
| 検索 | コメント本文・ユーザー名の部分一致 | `COMMENTS` の本文・`user` | 条件付き実現。DBの本文・username・handleで検索は可能だが、対象6分類がない |
| 並び順 | 「新しい順」のselect | selectに変更処理なし。実際は `order` 固定値で並び替え | 条件付き実現。DBのbatchは日付のみで、正確な同日順序なし |
| コメントカード | アバター、ユーザー、分類バッジ、本文 | サンプル6件、各分類1件 | 現時点では実現不可（6分類カード）。3分類カードなら条件付き |
| 空状態 | 検索結果が空の場合の専用表示 | 明示実装なし | 条件付き実現。要件として空状態を追加する必要あり |

### 3.5 フィルターキーワード候補

| UI要素 | 表示・操作 | 入力・粒度 | 分類 |
| --- | --- | --- | --- |
| 候補件数 | 「12 候補」 | 固定値 | 現時点では実現不可。現行DB公開行は86候補 |
| 検索 | キーワード・メタ情報の部分一致 | サンプル3候補 | 条件付き実現。DB公開JSONのkeyword、category、評価値などで実装可能 |
| リスク絞り込み | 全リスク / 高リスク / 中リスク | `risk` state、サンプルの `high` / `mid` | 現時点では実現不可。DBは高推奨・中推奨・任意で、リスク変換規則なし |
| new絞り込み | newのみ | サンプル `isNew` boolean | 条件付き実現。DBに `introduced_at` はあるが、基準日時と14日設定の所在を明確化する必要あり |
| 候補カード | keyword、リスク、出現件数、カテゴリ、new | `KEYWORD_CANDIDATES` 3件 | 条件付き実現。カテゴリとdirect/reactive/normal命中数はあるが、表示リスク・表示メタの対応が必要 |
| 詳細 | 候補理由の開閉 | 固定 `reason` | 条件付き実現。DBに評価値はあるが、画面の自然言語理由は保存されていない |
| コピー | キーワードをクリップボードへコピー | ブラウザ操作 | 完全実現（操作） |
| 追加済みマーク | コピー後にカード状態を変更 | `marked` Setのみ | 条件付き実現。セッション内なら可能、永続化にはDBまたは外部フィルター管理が必要 |

### 3.6 ブロックアカウント候補

| UI要素 | 表示・操作 | 入力・粒度 | 分類 |
| --- | --- | --- | --- |
| 候補件数 | 「8 候補」 | 固定値 | 現時点では実現不可。現行DBからの再計算は60件（空ハンドル除外） |
| 検索 | アカウント名の部分一致 | サンプル3ハンドル | 条件付き実現。DBのhandleで実装可能 |
| リスク絞り込み | 全リスク / 高リスク / 中リスク | `risk` state、サンプル値 | 現時点では実現不可。リスク規則なし |
| 候補カード | アバター、ハンドル、リスク、迷惑コメント数 | `ACCOUNT_CANDIDATES` 3件 | 条件付き実現。handleとdirect_nuisance件数は導出可能、リスクとアバター規則は別途必要 |
| 履歴確認 | アカウント別の迷惑コメント履歴モーダル | `ACCOUNT_HISTORY` 固定履歴 | 条件付き実現。DB本文・handle・posted_dateから導出可能だが、正確な時系列と安定IDが不足 |
| コピー | ハンドルをコピー | ブラウザ操作 | 完全実現（操作） |
| ブロック済みマーク | コピー後に状態変更 | `marked` Setのみ | 条件付き実現。永続的なブロック適用状態はDBにない |
| モーダル閉じる | 閉じる、Escape、背景クリック、bodyスクロール抑止 | React state、DOMイベント | 完全実現（画面内操作） |

## 4. 既存実装とサンプルデータの確認

### 4.1 対象UIのサンプル依存

対象UIのREADMEは、`src/data.js` を「サンプルデータ」と明記している。実装もDB取得を行わず、次の固定値・画面内stateを使う。

| 対象 | 確認結果 | 参照 |
| --- | --- | --- |
| 画面一覧 | 5画面 | `src/App.jsx:12-18` |
| 6分類件数 | 8,842 / 3,868 / 2,764 / 1,104 / 1,289 / 553、合計18,420 | `src/data.js:9-16` |
| コメント | 6分類それぞれ1サンプル | `src/data.js:18-25` |
| キーワード | 3候補、リスク・メタ・理由・newを固定 | `src/data.js:27-55` |
| アカウント | 3候補、履歴3アカウントを固定 | `src/data.js:57-79` |
| 概要数値 | Score 82、18,420、+8.4%、6分類割合、7日チャートを固定 | `src/App.jsx:219-295` |
| 期間切替 | `period` stateとトーストのみ変更し、集計値は変更しない | `src/App.jsx:207-217` |
| コメント検索 | サンプル配列を分類・本文・ユーザー名でfilter | `src/App.jsx:300-326` |
| コピー・状態 | コピー成功時のみ `marked` Setへ追加。DB/API呼出しなし | `src/App.jsx:331-369`, `351-369` |
| アカウント履歴 | `ACCOUNT_HISTORY[account.id]` をモーダル表示 | `src/App.jsx:450-482` |
| 集計日時 | mount時にブラウザの `new Date()` を表示 | `src/App.jsx:123-134` |

### 4.2 リポジトリの現行アプリとの差

`package/src/ui/App.jsx` は対象UIとは別の現行候補UIであり、3タブ（コメントラベル集計、フィルターキーワード、アカウントブロック）だけを持つ。データは `package/src/data/*.json` をビルド時にimportしており、ブラウザからDBへ接続しない。

- 3分類サマリー: 24,622件を表示
- キーワード候補: 86件
- アカウント候補: 54件
- コピー、詳細開閉、NEW、トーストは画面内state
- DBの現行公開行から毎回再取得する処理はない

つまり、対象UIの5画面は完成形の視覚・操作案であり、現行アプリはDB由来3分類成果物を静的アーティファクトとして表示する別スコープである。この差を埋めるには、6分類を追加するか、対象UIの仕様を現行3分類成果物に合わせる必要がある。

## 5. 現行DBのスキーマ・保存単位・実データ

### 5.1 スキーマ

実DBの `PRAGMA user_version` は **7** である。リポジトリには8番目のmigration `008-three-class-workset-labeled-comment-exclusion.sql` があるが、DBにはそのテーブルが存在しない。

| 保存領域 | 内容 | 現在の件数・状態 |
| --- | --- | --- |
| `imports` / `comment_observations` | 旧形式観測 | 0 / 0 |
| `raw_inputs` | 入力payload本体 | 2件、合計6,455,483 bytes、wrapper/batchの2形式 |
| `raw_snapshots` | rich snapshotとcomment batchの共通メタデータ | 9件（rich 8、batch 1） |
| `videos` / `authors` / `comments` | 正規化された動画・投稿者・コメントの識別子 | 8 / 1 / 0 |
| `snapshot_video_observations` | rich snapshotの動画属性・指標 | 8件。投稿指標が埋まる動画は4件 |
| `snapshot_comment_observations` | スナップショット単位のコメント観測 | 27,299件（rich 2,677、batch 24,622） |
| `snapshot_comment_three_class_labels` | 観測ごとの3分類ラベル | 24,622件。batch snapshot 9のみ |
| `three_class_worksets` / `three_class_workset_snapshots` | ラベル作業単位と対象snapshot | 1 / 1（snapshot 9） |
| `keyword_candidate_publications` | 候補生成・公開JSON一式 | 1件、current 1件、snapshot 9、候補JSON 86件 |
| `three_class_workset_excluded_comments` | v8で追加された除外コメント | **テーブル未作成** |

### 5.2 snapshotと時系列

- rich snapshot 8件の抽出時刻は2026-09-05 08:23:10Z〜08:37:08Z、loaded合計2,677件。
- rich snapshotのコメント観測は2026-08-27〜2026-09-05で、ページに現在ロードされた範囲であり、全コメントを保証しない旨のcoverage noteがある。
- comment batch 1件は2026-06-26〜2026-08-26の24,622件で、3分類ラベルの全対象である。
- DB全体の最終 `posted_date` は2026-09-05。調査日2026-09-12時点で、9/6以降は0件、9/1以降は1,843件。
- 24時間・7日間の最新データは存在しない。30日間も調査日基準では9/6〜9/12が欠測である。

### 5.3 ラベルと分類意味論

DBに存在するラベルは次の3つだけである。

| ラベル | 件数 | 構成比 | 意味の要点 |
| --- | ---: | ---: | --- |
| `direct_nuisance` | 731 | 3.0% | 主たる迷惑・攻撃・性的対象化・スパム等 |
| `reactive` | 1,339 | 5.4% | 既存の批判・攻撃・コメント欄の対立への反応 |
| `normal` | 22,552 | 91.6% | 上記以外。通常の支持、質問、会話、通常の批判を含む |

この定義では、`normal`の中に肯定的・中庸的・批判的に相当し得る内容が混在する。また `reactive` は「対批判」と「対迷惑」を区別せず、`direct_nuisance`も対象UIの「迷惑」と同一概念とは限らない。したがって、3分類から6分類への単純な名称置換はできない。

### 5.4 欠損・識別子・重複

- `comments`テーブルは0件、全27,299観測の `comment_pk` はNULL。
- comment batch 24,622件では、`comment_id_raw`、`video_id_raw`、`parent_comment_id_raw`、`user_id_raw`、`created_at` が全件NULL。
- rich snapshot 2,677件では、上記のraw識別・作成日時フィールドが空文字で、意味のある値として利用できない。`like_count`と`reply_count`も全件NULL。
- comment batchには12,736ハンドルがあり、空ハンドルは16件。本文のdistinctは20,096件で、繰返し本文行は4,526件。
- comment batchの `posted_at` は「2日前」「7-15」など表示用文字列で、distinct 100値。厳密な時刻順序ではない。
- comment batchで `handle + comment_text` の重複行は1,777件。安定したコメントIDがないため、同一コメントの再観測、同文の別コメント、重複入力を区別できない。

### 5.5 候補成果物の状態

- DBのcurrent keyword publicationは、run `run_993b988e-1703-4a28-9730-c60500f04f9b`、2026-09-09公開、snapshot 9、候補86件。
- 現行ポリシーはキーワード候補を `direct_nuisance` / `reactive` / `normal` の命中数、精度、推奨度で評価する。`reactive`は参考値であり、UIの6分類ではない。
- `package/src/data/filterKeywordCandidates.json` は86件で、DB公開JSONの構造に対応する。
- `package/src/data/run_manifest.json` とキーワードmetaは2026-08-26のrunを指し、DBcurrentの2026-09-09 runとは公開履歴が異なる。
- ベースライン後の `npm test` では124件中107件成功・17件失敗。失敗はhandoffの再構成検証で `DERIVED_ARTIFACT_MISMATCH`、`PUBLISHED_HASH_MISMATCH`、`CURRENT_META_HASH_MISMATCH` が発生したもので、候補JSON・registry/evaluation・公開hashの同期確認が必要である。
- 現行ポリシー（候補条件2件以上）でDBを再集計すると、空ハンドルを除くブロック候補は60ハンドル、direct_nuisance 224件。
- 配置済み `package/src/data/accountBlockCandidates.json` は54ハンドル、direct_nuisance 202件で、DB再集計より6ハンドル・22件少ない。DBのみの候補は `adadaaa424242`、`ayanaayana59`、`haruka37trumpet`、`meri63891`、`s102m`、`user62321921781195`。
- `npm run verify:data` は配置済みアーティファクトの内部整合性としては成功するが、DBとの同期検証ではない。

## 6. UI要求とDB候補データの対応表

| UI要求 | 必要な項目・粒度 | DB候補 | 時系列・識別子 | 判定（暫定） | 不足・条件 |
| --- | --- | --- | --- | --- | --- |
| 6分類の件数 | observation単位の6値ラベル | 3値ラベルのみ | batch 24,622件のみ | 現時点では実現不可 | 6分類ラベル、分類ポリシー、ラベルrunが必要 |
| 6分類の構成比 | 同じ母集団の6分類件数 | 3分類件数のみ | rich 2,677件は未ラベル | 現時点では実現不可 | 母集団と欠測の集計契約が必要 |
| 6分類の日次推移 | 日次×6ラベル | `posted_date`×3ラベルなら導出可能 | batchは6/26〜8/26、最新9/5 | 現時点では実現不可 | 6ラベル、最新取得、日付TZが必要 |
| 総コメント数18,420 | UI分類母集団の件数 | 観測27,299、label済24,622 | unique comment IDなし | 現時点では実現不可 | 6分類とunique/observationの定義が必要 |
| 前週比+8.4% | 対象期間2つの同じ集計 | 3分類の日付集計は可能 | 最新期間欠測 | 現時点では実現不可 | 比較基準、欠測処理、6ラベルが必要 |
| Score 82 / GOOD | スコア値・式・判定閾値 | 該当列なし | 履歴なし | 現時点では実現不可 | スコア契約と算出結果が必要 |
| AI推奨対応 | 推奨文、priority、生成日時、根拠 | 候補評価値の一部のみ | keyword publicationに限定 | 現時点では実現不可 | 推奨出力または再現可能な生成ロジックが必要 |
| コメント本文・ユーザー検索 | 本文、username/handle | 27,299観測に存在 | handleは空16件 | 条件付き実現 | 6分類対象が別途必要 |
| コメントの新しい順 | 正規化された投稿日時 | `posted_date`、表示文字列 `posted_at` | 同日順序不可 | 条件付き実現 | timestamp保持または日付単位表示へ仕様変更 |
| キーワード候補 | keyword、variants、category、命中数、精度、推奨度 | current JSON 86件 | candidate_id、introduced_atあり | 条件付き実現 | DB公開JSONの読出しと画面モデル変換 |
| キーワードのリスク | high / mid等のrisk enum | 高推奨 / 中推奨 / 任意 | 変換規則なし | 現時点では実現不可 | riskとrecommendationの同一視可否を人間が決定 |
| キーワード候補理由 | 人間向け説明文 | metrics/categoryはある | reason列なし | 条件付き実現 | 決定的テンプレートまたはreason保存 |
| キーワードNEW | introduced_atと現在時刻 | introduced_atあり、設定JSONに14日 | DBに設定値なし | 条件付き実現 | 設定の正本と基準日時を定義 |
| アカウント候補 | handle単位、direct件数>=2 | SQL導出可能（60件） | handle空16件を除外要 | 条件付き実現 | 候補run・同期・空handle方針が必要 |
| アカウントリスク | high / mid | 該当列・規則なし | — | 現時点では実現不可 | リスクスコア・分類契約が必要 |
| アカウント履歴 | handle単位の本文・時刻・分類 | 本文、handle、posted_dateあり | comment IDとtimestampなし | 条件付き実現 | 重複・時刻・履歴対象の契約が必要 |
| コピー | keyword/handleの文字列 | DB不要 | ブラウザ操作 | 完全実現 | clipboard権限失敗時のUIは実装済み |
| 追加済み/ブロック済み | ユーザー操作の永続状態 | 保存先なし | React stateのみ | 条件付き実現 | stateテーブルまたは外部適用システムが必要 |

## 7. 不足データと追加対応候補

| 不足領域 | 必要なデータ・契約 | 対応種別 |
| --- | --- | --- |
| 6分類 | observationごとの6値ラベル、ラベルポリシーversion、分類run、対象母集団、必要なら信頼度・根拠 | 追加データ＋DB変更候補 |
| 3分類から6分類への関係 | `normal`内の肯定/中庸/批判、`reactive`内の対批判/対迷惑を決める明示規則または再分類結果 | 仕様変更＋追加データ |
| 安定識別子 | external comment ID、user ID、video ID、parent ID、`comment_pk`、重複排除規則 | 収集契約変更＋再取込、必要ならDB補完 |
| 正確な時系列 | UTC timestamp、タイムゾーン、取得時刻、投稿日と観測日の区別 | 収集契約変更＋DB/出力項目追加 |
| 集計 | unique commentかobservationか、期間端点、欠測・部分取得、比較対象期間、集計基準日時 | 仕様変更＋導出ロジック |
| スコア | 算式、重み、GOOD等の閾値、前回値または比較スナップショット | 仕様変更＋保存結果 |
| AI推奨 | 推奨文、priority、根拠参照、生成モデル/版、生成日時、再現性 | 追加データまたは生成結果保存 |
| キーワード表示 | recommendationとriskの対応、候補理由、画面表示用メタの定義 | 仕様変更。reason保存ならDB変更候補 |
| アカウント候補 | current runの正本、空handle除外、リスク式、通報数・投稿頻度のデータ | 仕様変更＋同期処理。通報数等は追加データ |
| 操作状態 | キーワード追加、アカウントブロック、適用日時、操作者、外部適用結果 | DB変更または外部システム連携 |
| 更新状態 | 全体の最終集計時刻、source snapshot、partial/complete、エラー状態 | DB/公開manifestの項目追加＋UI契約 |
| v8差異 | `three_class_workset_excluded_comments`を適用するか、未適用を正本とするか | 人間判断＋migration運用 |

## 8. 検証記録

すべてDBクエリは `file:var/comment-history.sqlite3?mode=ro` で読み取り専用接続して実行した。`docs/archive` 配下は参照していない。

### 8.1 DB存在・件数

- `PRAGMA user_version`: 7
- `raw_snapshots`: 9（rich 8 / comment-batch 1）
- `snapshot_comment_observations`: 27,299
- `snapshot_comment_three_class_labels`: 24,622
- ラベル内訳: direct_nuisance 731 / reactive 1,339 / normal 22,552
- `keyword_candidate_publications`: 1（current 1、候補JSON 86）
- v8予定の `three_class_workset_excluded_comments`: `no such table`

### 8.2 欠損・重複・時系列

- rich snapshotは2,677件、batchは24,622件。
- batchのコメント識別・親子関係・ユーザーID・作成日時のraw値は全件NULL。
- richのコメント識別・動画ID・親ID・ユーザーID・作成日時は全件空文字。
- batchの本文distinctは20,096件、本文重複行は4,526件。
- batchの`handle + comment_text`重複行は1,777件。
- DB全体のdistinct `posted_date` は72日、範囲は2026-06-26〜2026-09-05。9/6以降は0件。

### 8.3 ラベル対応・参照整合性

- ラベルの孤立行: 0
- batch観測の未ラベル行: 0
- rich観測に付いたラベル: 0
- `three_class_workset_snapshots`: workset 1件がsnapshot 9を参照
- 外部キー検査結果: エラー出力なし

### 8.4 既存出力の検証

- `npm run verify:data`（`package`）: 成功。配置済みJSON自身の整合性は確認できた。
- `npm run build`（`package`）: 成功。現行3タブUIのビルドは通過した。
- `npm test`（`package`）: 124件中107件成功・17件失敗。失敗は候補成果物の再構成・公開hash検証に集中し、`DERIVED_ARTIFACT_MISMATCH`、`PUBLISHED_HASH_MISMATCH`、`CURRENT_META_HASH_MISMATCH` が報告された。
- これらの検証は、対象のTailwindサンプルデータが本番DBと一致すること、またはDBとJSONの公開同期を保証しない。

## 9. 未決事項（作業タスク5）

以下は人間が決定しない限り、最終分類として確定しない。

1. `完全実現`を「SQLで導出できれば可」とするか、「既存の公開成果物・更新処理まで存在すること」を要求するか。
2. サンプルデータを本番データとして扱わず、production表示をDB値へ置換する方針を採用するか。
3. 3分類を正式表示にするか、6分類を正式要求として追加ラベルを作るか。
4. 期間集計で、部分取得・欠測期間を「0件」と表示するか、「データ不足」と表示するか。
5. キーワードの `高推奨 / 中推奨 / 任意` を、対象UIの `高リスク / 中リスク` に変換してよいか。
6. DBから再計算した60件のアカウント候補と、現行アーティファクト54件のどちらを正本とするか。
7. `three_class_workset_excluded_comments`のmigrationを現行DBへ適用するか。

## 10. 追跡可能な参照先

- 対象UI: `docs/active/temp/optimicom-react-tailwind/src/App.jsx`
- 対象UIサンプルデータ: `docs/active/temp/optimicom-react-tailwind/src/data.js`
- 対象UI説明: `docs/active/temp/optimicom-react-tailwind/README.md`
- 現行UI: `package/src/ui/App.jsx`
- 現行UIデータ接続: `package/src/ui/candidate-data.js`, `package/src/ui/candidate-data-adapter.js`
- DB migration: `package/db/comment-database/001-init.sql`〜`008-three-class-workset-labeled-comment-exclusion.sql`
- 3分類ルール: `package/templates/three-class-workset/RULES.md`
- キーワード評価契約: `package/contracts/keyword-candidates/evaluation-policy-1.0.0.json`
- アカウント候補契約: `package/contracts/account-block-candidates/accountBlockCandidatePolicy-1.0.0.json`
- DB由来ラベルサマリー: `package/src/data/threeClassLabelSummary.json`
- DB由来キーワード候補: `package/src/data/filterKeywordCandidates.json`
- DB由来アカウント候補: `package/src/data/accountBlockCandidates.json`
