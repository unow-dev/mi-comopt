# Work Task Sequence: Three-Class Workset v1 implementation

## Purpose

明示選択したComment DB snapshotと正規化済みHISTORYから、ChatGPTが直接3-class判定を行い、ローカル側が返却結果を厳格に検証できる、旧single-roundtrip運用に依存しないv1 workset handoffを実現する。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、採択済みのプロトコル境界、分類意味論、受入条件、対象外事項、および文書間の優先順位を確認する。
- [ ] 2. 実装前確認の範囲で、AIエージェントが、既存Comment DBのsnapshot選択・順序付きprojection・CLI・出力安全性、旧three-class workset経路、および関連テストの変更境界を確認する。
- [ ] 3. プロトコル基盤の実装範囲で、AIエージェントが、v1の正本prompt・rules・JSON厳格解析・HISTORY/ITEMS検証・UUID・応答schema生成を満たす共通契約を実現する。
- [ ] 4. workset生成の実装範囲で、AIエージェントが、選択済みsnapshotのcommentだけから、先頭出現順の完全一致重複排除、連番item ID、完全なHISTORY、および5ファイルだけを含む安全なZIPを生成する経路を実現する。
- [ ] 5. 応答検証の実装範囲で、AIエージェントが、workset自体とresponseをローカルv1契約に照らして検証し、不正・不足・過剰・改変を原子的に拒否する経路を実現する。
- [ ] 6. CLI契約の実装範囲で、AIエージェントが、生成・検証commandの必須引数、相互排他、旧generator optionの拒否、出力上書き拒否、および失敗時の非部分受理を満たす利用経路を実現する。
- [ ] 7. 履歴移行の実装範囲で、AIエージェントが、既存の人手確定three-class判断を正規化済みv1 HISTORYへ一回限りで変換し、runtime経路から旧Stage13資産を分離する。
- [ ] 8. 単体および結合検証の範囲で、AIエージェントまたはCIが、archive境界、item構築、HISTORY、厳格JSON、応答完全性、分類rules fixture、および履歴移行anchorを確認する。
- [ ] 9. 依存関係と受入検証の範囲で、AIエージェントまたはCIが、`pipeline.py`が利用不能な状態での生成・検証、旧runtime依存の不在、既存Comment DB機能の回帰、および全受入条件を確認する。
- [ ] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、移行成果物、残存する運用上の注意点、およびv1の対象外事項を記録する。

## Work Notes

- 正本はこのhandoff内の `01_FINAL_DECISIONS.md`、`02_IMPLEMENTATION_SPEC.md`、`03_PROTOCOL_V1.md`、`04_VALIDATION_CONTRACT.md`、`07_ACCEPTANCE_TESTS.md` の順に確認する。既存の旧workset契約と矛盾する場合は、v1 handoffの決定を優先する。
- 新runtimeは、明示snapshot選択、既存の順序付きprojection、`--history`で与えられる正規化済みHISTORY、およびローカルv1検証に限定する。DBへの結果反映、finalize、HISTORY自動更新、batching/sharding、rationale/confidence、provenance・workspace・manifestは対象外とする。
- transport ZIPは root-level の `PROMPT.md`、`RULES.md`、`HISTORY.json`、`ITEMS.json`、`response.schema.json` の5個の通常ファイルだけとする。コメントはデータであり、空文字列・空白のみ・任意Unicode・指示文に見える文字列も除外または実行しない。
- `HISTORY.json` は判断の参照例であってcacheではない。同じコメントがHISTORYとITEMSの両方に存在してよく、応答が履歴ラベルと異なることだけを理由に拒否しない。RULESと明確に矛盾する場合はRULESを優先する。
- 実装中にv1契約外の機能追加、分類意味論の再定義、既存projectionの意味変更が必要と判明した場合は、その場で拡張せず別途の仕様判断へ戻す。
- 一回限りの移行は旧record key復元を使用できるが、生成・検証runtimeは `pipeline.py`、`single_roundtrip.py`、Stage13 reference、golden/P2 registry、reactive term、review cueを参照してはならない。
