# Work Task Sequence: three-class workset labeled-comment exclusion implementation

## Purpose

Comment DBに既存の3分類ラベルを持つ完全一致コメントを、決定的な評価例としてworksetのHISTORYへ統合し、生成時と応答適用時の両方で新規分類対象から一貫して除外できる状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、規範仕様、確定済みのデータ意味論、受入条件、対象外事項、および文書間の優先順位を確認する。
- [ ] 2. 実装前確認の範囲で、AIエージェントが、three-class worksetの生成・応答適用、Comment DBのラベル読取りとworkset provenance、migration、final sync、および関連テストの既存契約と変更境界を確認する。
- [ ] 3. 実装境界の判断範囲で、人間が、既存実装が完全一致キー、ラベル優先順位、workset membership固定、またはv1プロトコル不変の確定仕様と矛盾した場合に、設計へ戻る要否を判断する。
- [ ] 4. 永続的な3分類規則の実装範囲で、AIエージェントが、`normal < reactive < direct_nuisance`の共有優先順位に基づき、Comment DBの既存ラベルをコメント単位で決定的に解決できる状態へ変更する。
- [ ] 5. workset生成の実装範囲で、AIエージェントが、解決済みDBラベルをHISTORYへ規定順で統合し、DBラベルを持つ完全一致コメントをITEMSから除外し、実際に除外した選択元コメントを取得できる状態へ変更する。
- [ ] 6. workset provenanceの実装範囲で、AIエージェントが、生成時に実際に除外したコメントだけをworksetと原子的に対応付け、既存worksetとの互換性を維持できる状態へ変更する。
- [ ] 7. 応答適用と生成元再現の実装範囲で、AIエージェントが、登録済みの除外コメントを用いてITEMSを再現し、除外された選択元観測を変更せず、生成後のラベル競合を既存契約に従って扱える状態へ変更する。
- [ ] 8. migration・リポジトリ・CLI互換性の実装範囲で、AIエージェントが、スキーマversion 8への安全な移行、既存migration列との接続、既存のCLI入出力契約、およびthree-class-workset-v1の不変性を満たす状態へ変更する。
- [ ] 9. 単体・結合・回帰検証の範囲で、AIエージェントまたはCIが、完全一致除外、最悪ラベルの解決、HISTORY統合順序、provenanceの原子性、生成元再現、応答適用範囲、生成後競合、legacy workset互換性、およびfinal sync・プロトコルの回帰を確認する。
- [ ] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、設計へ戻る判断の有無、migration時の注意点、および対象外事項を記録する。

## Work Notes

- 実装の正本は `HANDOFF.md` とし、受入条件は `ACCEPTANCE_TESTS.md` とする。`README.md` は読み始める順序と設計完了状態を示す補助文書であり、確定済みの意味論を実装中に変更しない。
- コメント照合はJavaScript/SQLiteの完全一致文字列だけをキーとする。trim、大小文字変換、Unicode正規化、空白の書換えを行わず、既存の先頭出現順による重複排除も維持する。
- 永続的なラベル優先順位は共有three-class domain moduleに置き、workset生成と一回限りの`three-class-final-sync`が同じ定義を利用する。`protocol.js`の列挙順から重大度を推論しない。
- DBの有効ラベルはコメントごとに最悪ラベルを採択し、同じコメントに対する全ラベル行の最小observation IDを、DB専用HISTORY追加順の決定性にだけ使用する。
- 入力HISTORYは現在の契約どおり先に検証する。入力内ラベル競合は`INVALID_HISTORY`のままとし、DBにも存在するコメントは入力での位置を保持してDB有効ラベルへ置換する。DB専用コメントは最小observation ID、comment textの順で末尾に追加する。
- HISTORYだけに存在するコメントはITEMSから除外しない。除外根拠は生成時点のComment DB有効ラベルだけとし、`ITEMS.json`のIDは除外後の残存コメントへ欠番なく割り当てる。空のITEMSは有効である。
- schema versionは8へ進め、既存007 migrationの後に008を追加する。除外provenanceにはworksetごとの実際に除外された選択元コメントだけを保持し、採択ラベル、workset version列、全DBラベルの複製は保持しない。
- 応答適用時のsource再現は、現在のComment DBラベルではなく登録済み除外集合を使用する。登録済み除外コメントが再構成した選択元に存在しない場合、または再構成ITEMSがZIPと異なる場合は`WORKSET_SOURCE_MISMATCH`で失敗させる。legacy worksetは除外行ゼロとして同じ経路を通す。
- 反映対象は応答decisionを持つ選択元観測だけとする。除外された観測は未変更のまま残し、返却する`observations`、`inserted`、`unchanged`はresponse targetだけを数え、`observations === inserted + unchanged`を維持する。
- 生成後にITEMだったコメントへ同一ラベルが追加された場合は反映を許可し、異なるラベルが追加された場合は既存の`LABEL_CONFLICT`として拒否する。除外済みコメントのラベル変更・削除はworkset membershipを変更しない。
- `three-class-workset-v1`、ZIPの5 member境界、response schema、prompt、rules、CLI引数・出力形式は変更対象外とする。workset runtimeから`three-class-final-sync`を呼び出す依存を追加せず、historical backfill以後の通常の正本はComment DBとする。
- supplied snapshotのmigration 007 SQLはhandoffに含まれていないため、実リポジトリに存在する007を復元・変更せず、その後へ008を追加する。
