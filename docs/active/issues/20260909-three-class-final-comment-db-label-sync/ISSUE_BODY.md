## 背景

公開済みの`three_class_final`は、既存コメントに対する3分類評価の正本である。一方、同じraw snapshotを指すComment DBの3分類ラベルには、`three_class_final`と異なる値が保存されていた。この差異により、Comment DBを入力とするcandidate handoffが、既存の公開済み評価と異なるラベル集合を使用し得る状態になっている。

既存コメントを再評価することは目的ではない。公開済み`three_class_final`の評価結果を保持したまま、Comment DBを既存評価の追跡可能な保存先として扱える必要がある。

## 目的

既存`three_class_final`の3分類評価を、対応するComment DB snapshotへ正確に反映し、既存の公開済み評価とComment DBのラベル集合が一致する状態を実現する。以後、Comment DBを起点とする処理が既存評価と同じ3分類結果を参照できるようにする。
