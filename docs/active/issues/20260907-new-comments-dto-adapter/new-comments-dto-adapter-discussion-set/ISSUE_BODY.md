# Issue: `new-comments.json` のDTO変換adapterを作成する

## 目的

実更新で生成される `new-comments.json` を、collector側の責務として検証し、rich raw databaseの汎用入力境界が受け取れるsnapshot DTO列へ変換できる状態にする。

## 背景

実更新用の `/home/uya/Workspace/tiktok-filter-keywords/work/20260907/raw/incoming/new-comments.json` は、単一snapshotそのものではなく、複数の収集結果を `items` 配列に格納したwrapperである。確認時点ではrootが `{ "items": [...] }` で、8件のitemを含み、各itemは `extractedAt`、`source`、`video`、`stats`、`author`、`comments` などのrichな収集情報を持つ。

現行の `import-raw-snapshot` は `schemaVersion: 1` を持つ単一の `tiktokRawSnapshot` を受け取り、Database内でDTOへ変換する互換adapterである。そのため、`new-comments.json` のwrapperを直接受け付けるには、wrapper固有の形式を理解するadapterが必要になる。また、実データにはschema上のnullable値やwrapper固有の欠落項目があるため、単純なroot名の付け替えだけではDTOの検証条件を満たせない可能性がある。

## 議論対象

- wrapperの入力形式名・バージョン付けと、将来のwrapper変更を検出する契約。
- `items` の存在、空配列、itemの必須項目、未知項目、null、欠落値に対する検証方針。
- wrapperの各fieldをsnapshot DTO、video DTO、comment DTOへ対応付ける規則。
- 外部IDが空文字・null・欠落の場合の扱いと、DTOの非null制約を満たすための正規化方針。
- `loadedCount`、`reportedCount`、coverage情報、親子コメント、日時、統計値の対応付けと不整合時の扱い。
- `items` の順序をsnapshot indexへ反映する規則、および同一payload内のvideo・comment重複の扱い。
- wrapper全体の元bytesをそのまま `payloadBytes` として保存し、itemごとの再シリアライズを行わない方針。
- adapterの配置、Database/Processingにwrapper parserを追加しない境界、およびgeneric `importRawInput` への接続方法。
- 部分成功を許さず、検証失敗・変換不能・不明な値をatomicに拒否する方針。
- 実更新フローからの呼び出し位置、manifestとの関係、既存のraw integrationへの引き渡し方法。

## 対象範囲

- `new-comments.json` wrapperの構造検証。
- wrapper内の各itemを、既存のraw input DTO契約へ変換するadapter。
- wrapper全体のbytes、input format、snapshot DTO列を1回のgeneric importへ渡すための接続。
- 実データの形状を再現したfixture・unit test・integration test。
- adapterが担当するエラー分類、ログ可能な診断情報、順序安定性の明文化。

## 対象外

- rich raw databaseのsource-of-truth、再実行、冪等性、raw bytes整合性の基本設計変更。
- DatabaseまたはProcessing層への `new-comments.json` wrapper parserの追加。
- `new-comments.json` の実データ本体をrepositoryまたは議論セットへ取り込むこと。
- legacy rawとのmerge、重複排除、Stage13向けdataset生成、label・candidate処理。
- 本番DBへのバックフィルまたは本番更新の実行。

## 完了条件

- 実更新用wrapperの形状と入力契約が文書化され、バージョン不一致や未知の形状を検出できる。
- adapterがwrapper全体のbytesを保持したまま、全itemをDTOへ安定して変換できる。
- 実データに含まれるnull・欠落・空文字・件数不整合の扱いが明示され、DTO検証で黙って欠損を通さない。
- 変換結果のsnapshot index、video/commentのID、件数、日時、統計値、coverage情報がテストで確認される。
- 不正なitemがある場合に部分的なDB反映を行わず、generic `importRawInput` のatomic境界へ接続できる。
- Database/Processingがwrapper形式に依存していないことをテストまたは構造確認で担保できる。
- 更新フローがadapterの出力とmanifestを用いて、既存のraw integrationへ引き渡せる。

## 関連

- [rich raw database source of truth](../../20260907-rich-raw-database-source-of-truth/ISSUE_BODY.md)
- [current incoming raw dataset integration](../../20260826-090119-current-incoming-raw-dataset-integration/ISSUE_BODY.md)
