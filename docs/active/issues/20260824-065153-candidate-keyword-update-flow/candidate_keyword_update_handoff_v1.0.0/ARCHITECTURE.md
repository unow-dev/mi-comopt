# Architecture

## 原則

1. 候補の意味判断は外部LLM境界の外側で行う。ローカルは候補を生成しない。
2. 外部LLMについて仕様化するのは request contract と proposal contract だけ。
3. proposal確定後の処理は決定的・再構成可能でなければならない。
4. candidate identityは表示文字列から独立した永続 `candidate_id` とする。
5. candidate semantic state と dataset依存evaluationを分離する。
6. `reactive` は参考件数のみで、precision / utility / recommendationへ影響しない。
7. current publicationはatomicに更新し、stale parentを自動rebaseしない。
8. legacy 187候補はsemantic変更なしでbootstrapする。

## Run types

- `bootstrap_migration`: legacy 187件をregistryへ一度だけ移す。
- `full_update`: external proposalを適用し、新しいsemantic candidate stateを公開する。新datasetをcurrentへ出す場合は必須。
- `local_rebuild`: candidate semantic state (`status/keyword/variants/category_id`) を変えず、同一dataset上でpolicy/evaluator/表示派生物等を再構築する。first-publication historyは、never-published candidateが初めてeligibleになった場合に限り進められる。

## Run artifact retention

`full_update` では request/proposalを含む契約上のmachine-only artifactをGit側run historyへ保存する。LLM内部のraw応答・説明・chain-of-thought等は本仕様の対象外。

過去registry snapshotをrunごとに複製する必要はない。bootstrap stateとpublished change-set chainから再構成し、各manifestのregistry hashと一致することを検証する。
