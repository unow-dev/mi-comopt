# アカウントブロック候補リスト

## 目的

フィルターキーワードによるコメント単位の対策を補完し、ブロックを検討すべきアカウントを手動確認できる状態にする。

UI上でアカウントブロック候補リストを表示し、利用者が候補化の根拠を確認したうえで、自身でブロック判断を行えるようにする。

初期実装はMVPとして、候補生成・根拠確認・handleコピーに必要な最小範囲へ限定する。

## 背景

現行のフィルターキーワード候補リストは本文表現を対象とするモデレーション手段である。同一アカウントが文面を変えながら反復的に迷惑行為を行う場合、キーワード単位の対応だけでは継続的な対処として不十分になり得る。

既存Stage13では、同一ユーザーの反復確認にexact `handle` を利用し、反復否定について2件以上を作業上の反復境界としている。一方、公開済み3-Class finalでは `direct_nuisance / reactive / normal` が分離されている。

本issueでは、この既存境界を利用し、投稿者本人への一次的迷惑行為として確定した `direct_nuisance` の反復をアカウント単位でレビューできるようにする。

## MVP仕様

- アカウント候補は自動ブロック対象ではなく、利用者が最終判断するためのレビュー対象とする。
- 入力はpublication gateを通過した `three_class_labeled.json` と対応する `summary.json` とする。
- dataset内では、**exact `handle` 一致**を同一アカウントとして扱う。`username` は同一性判定に使用しない。
- behavior eventは exact `handle`、`comment`、`postedAt`、`postedDate` の組で識別する。値のnormalizationは行わない。
- 同一behavior eventに同一3-Class labelのsource rowが複数存在する場合は1 eventへcollapseする。
- 同一behavior eventに異なる3-Class labelが存在する場合は入力不整合として生成をfailする。
- exact `handle` ごとにdistinctな `direct_nuisance` behavior eventが**2件以上**ある場合、そのhandleを候補化する。
- `reactive` / `normal`、内容subtype、危険度score、比率、期間windowは候補判定に使用しない。
- UIではhandle、`direct_nuisance` の全event件数、決定的に選択した根拠例2件を確認できるようにする。
- 根拠例は「最新」「代表」「重大」等の意味付けをせず、決定的なsampling規則で選択する。
- UIからraw handleをそのままコピーできるようにする。
- キーワード候補とアカウント候補は同一リリース内で同じpublished 3-Class dataset snapshotを参照する。

## UI

既存アプリ内に最上位view切替を追加する。

- `フィルターキーワード`
- `アカウント`

初期viewは既存挙動を維持して `フィルターキーワード` とする。

アカウントviewでは、推奨度・score・NEW・自動ブロック状態等を表示しない。

候補カードの主要情報:

- exact handle
- `direct_nuisance` event件数
- handleコピー
- 根拠例2件の開閉

候補が0件の場合は正常な空状態として表示する。未生成・hash不一致・snapshot不一致はUI状態として扱わず、生成・releaseをfailさせる。

## データ・privacy境界

- 公開候補artifactへ `username` は含めない。
- `reactive` / `normal` の本文・件数は公開候補artifactへ含めない。
- 根拠本文は候補条件を確認するための2 eventだけを公開する。
- 3-Class監査sidecarやraw datasetをbrowser bundleへ含めない。

## Out of scope

以下は本MVPに含めない。

- 自動ブロックまたはプラットフォームへの直接操作
- `reviewed / dismissed / blocked` 等の永続状態管理
- browser localStorageによる状態管理
- 危険度・推奨度score
- `reactive` / `normal` を使った相殺・比率評価
- nuisance subtype分類
- 30日/90日等のrolling window
- handle変更を跨ぐアカウント同一性推定
- account候補の検索・複雑なfilter

## Upstream dependency

account candidate workflowはraw integration実装そのものには依存しない。正式入力はpublished 3-Class finalである。

将来のincomingデータを含めたreleaseでは、raw integration → Integrated Labelingによって新しいpublished finalが作成された後、そのsnapshotをaccount workflowへ入力する。

## Acceptance criteria

- published 3-Class finalから候補artifactを再現可能に生成できる。
- `summary.final_published === true` およびdataset SHA bindingを検証する。
- exact handle / behavior event / conflict規則がcontract通りに実装される。
- distinct `direct_nuisance` behavior event 1件では候補化せず、2件以上で候補化する。
- candidate JSONは同一入力・policyに対して決定的である。
- candidate/meta/manifestのhash bindingを検証できる。
- keyword/accountの `dataset_artifact_sha256` が一致しない状態はpublish/releaseできない。
- UI初期表示は既存キーワードviewのままである。
- account viewへの切替、根拠開閉、raw handleコピーが動作する。
- 自動ブロック・状態管理・score・time window・subtypeが実装されていない。
- `npm test`、`npm run verify:data`、`npm run build` が成功する。
