# Legacy 5-field DB import — implementation handoff

Status: **design frozen / implementation ready**

このhandoffは、旧5-field JSONを現行のgeneric raw-input経路からComment DBへ取り込むissueについて、議論で採択済みの実装契約だけをまとめたものです。

実装者はまず `HANDOFF.md` を読み、次に `IMPLEMENTATION_CHECKLIST.md` の順序で作業してください。`reference/discussion-set/` はhandoff作成時点の現行実装断面であり、仕様そのものではなく根拠・比較用です。

## ファイル

- `HANDOFF.md` — 最終仕様、責務境界、DB v5、DTO、CLI、manifest、禁止事項
- `IMPLEMENTATION_CHECKLIST.md` — ファイル単位の作業順序と完了条件
- `TEST_MATRIX.md` — 必須テストとfailure/corruptionケース
- `DECISIONS.md` — 主要分岐の採否と理由。過去の議論を再現する必要がある場合のみ参照
- `reference/discussion-set/` — 元issueと現行コードの最小参照断面
- `SHA256SUMS` — handoff内容のハッシュ

## 再議論してよい条件

実装中に仕様を再オープンしてよいのは次のどちらかだけです。

1. privateな実データ24,622件に、issue前提と矛盾する具体例が見つかった場合（例: 5キー以外、非string値、rootがarrayではない）。
2. 現行rich regressionを維持しながらこのhandoffを実装することが原理的に不可能だと、テストまたはschema制約で具体的に示せた場合。

それ以外の実装都合で、空文字補完、日時推測、kind省略、schema緩和、Databaseへのformat固有分岐などへ変更しないでください。
