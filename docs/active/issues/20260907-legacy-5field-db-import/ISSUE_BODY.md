# Issue: 旧5-fieldデータの明示的なDB import契約を追加する

## 目的

旧来の5-field raw JSONを新データ型の互換性ある部分集合として扱い、新データと同じgeneric import経路でComment DBへ取り込める状態にする。

旧データを別形式専用の下流処理へ分岐させず、新データと同じ保存・読取り・Processing経路で利用可能にする。旧データのレコード順と重複を保持し、不足する情報の扱いを明示したうえで、既存DBへ再現可能かつ原子的に取り込める状態を実現する。

## 背景

現在の更新経路は、`tiktokNewCommentsWrapper-1.0.0`をCollector側でgeneric snapshot DTO列へ変換し、`importRawInput`を経由してComment DBへ保存した後、既存の読取り・Processing経路へ渡す構成になっている。一方、旧データとして残っている`/home/uya/Workspace/tiktok-filter-keywords/work/20260826/current_raw.json`は、`username`、`handle`、`comment`、`postedAt`、`postedDate`だけを持つ24,622件の配列であり、新データ型が持つ情報の一部だけを表現している。

この5-field配列にはsnapshot識別子、動画ID、取得元、収集時刻、raw bytesに対応するrich metadataが含まれないため、現行のrich raw importへそのまま渡すことはできない。また、現行のnormalized importが要求する`source`、`postRef`、`collectedAt`も元データから復元できず、値を無条件に推測・補完すると旧データの出所と意味を失う。

その結果、現在のDBへ新しいwrapper由来のデータは保存できても、旧5-fieldデータは同じgeneric import経路へ載せられず、新旧データを同じ利用モデルで扱えない。旧データを新データ型の部分集合として互換的に受け入れるには、旧データ固有の入力形式と、表現されていない情報・順序・重複・保存時のprovenanceを明示的に扱うimport契約が必要になっている。
