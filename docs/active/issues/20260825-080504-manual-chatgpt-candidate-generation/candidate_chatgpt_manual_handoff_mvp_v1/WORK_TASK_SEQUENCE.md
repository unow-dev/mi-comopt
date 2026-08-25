# Work Task Sequence: ChatGPT手動候補提案handoff MVP v1

## Purpose

既存の決定的な候補キーワード更新フローへ、ChatGPTに手動投入する候補提案handoffを安全に接続し、生成したhandoff bundleから返却されたJSON提案を完全性と既存の更新契約を保って公開まで処理できる状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、実装仕様、受入条件、決定済み事項および対象外事項を確認する。
- [ ] 2. 実装前提の確認の範囲で、AIエージェントが、権威あるrepositoryにおける基準fixtureの所在と既存テストの実行可能性を確認する。
- [ ] 3. runtime契約とpublication読取基盤の範囲で、AIエージェントが、handoff用の固定契約資源と単一のimmutable publicationを読むための基盤を整備する。
- [ ] 4. handoff生成の範囲で、AIエージェントが、入力整合性、再評価、source identity、排他的出力およびbyte integrityを満たす手動handoff bundleの生成を整備する。
- [ ] 5. 手動提案の受入と更新保護の範囲で、AIエージェントが、request artifact bindingとhandoff manifest検証を既存のfull-update処理へ整備する。
- [ ] 6. 手動運用手順の範囲で、AIエージェントが、handoff生成、ChatGPTへの投入、JSON-only提案の保存およびfull-update実行の手順を記録する。
- [ ] 7. 検証範囲で、AIエージェントまたはCIが、handoff生成、改変検知、更新処理、既存回帰および手動フローの受入条件を確認する。
- [ ] 8. リリース判断の範囲で、人間が、受入条件、既知の基準fixture問題の扱いおよび運用開始の可否を判断する。
- [ ] 9. 作業結果の範囲で、AIエージェントが、実施内容、検証結果および残存する運用上の注意点を記録する。

## Work Notes

- 正本は `IMPLEMENTATION_SPEC.md`、受入確認の正本は `ACCEPTANCE_TESTS.md`、設計上の判断と非目標は `DECISIONS_AND_NON_GOALS.md` とする。設計判断は閉じており、実装時に再設計しない。
- runtimeはIssue配下の文書へ依存させず、handoff用の4契約資源をrepository/package側の安定した場所に配置する。core schemaの意味・version・`$ref`は変更しない。
- `current`は処理開始時に一度だけ解決したimmutable publicationから読み、base publicationの検証とpolicy/taxonomyを含むcross-bindingを満たさない入力は既存エラーまたは`HANDOFF_INPUT_MISMATCH`として停止する。
- requestのdataset SHAはupstream publication artifact identityであり、handoff内のdataset raw byte SHAとは区別する。raw byteの完全性はmanifestで検証する。
- `--outdir`は排他的に作成し、既存directoryを変更しない。通常の失敗時に削除できるのは当該実行が新規に作成した出力directoryだけとする。
- handoffはmanifestを含む11ファイルで構成し、manifestはChatGPTへ渡さない。外部入力と契約資源はraw bytesのままコピーし、生成JSONは決められた整形で出力する。
- manual production flowでは、ChatGPTのJSON-only回答を修復・編集せずに`full-update`へ渡す。`canonicalize-proposal`を事前実行せず、add candidate IDはproductionの`full-update`内で一度だけ発行する。
- `--handoff-manifest`は既存`full-update`との後方互換のためoptionalとするが、手動handoff運用では必須とする。manifest検証時は候補proposal以外のhandoffファイルとCLI入力のraw bytesをfail-closedで照合する。
- supplied snapshotでは既存bootstrap testに必要な権威fixtureが欠け、`npm test`は9件成功・1件失敗となる。権威あるrepositoryにも存在しない場合は、本Issueの回帰判断前に別の準備作業として復元方針を扱う。
- MVPの対象外は、ChatGPT/OpenAI API連携、provider/model設定の記録、匿名化、raw response・実行履歴・retry、ZIP生成、出力修復、自動rebase、policy/taxonomy移行、JSON Schema engine導入およびcandidate IDの決定的生成とする。
