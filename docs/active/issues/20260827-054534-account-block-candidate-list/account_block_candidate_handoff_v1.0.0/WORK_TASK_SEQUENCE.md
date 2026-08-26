# Work Task Sequence: アカウントブロック候補リスト

## Purpose

公開済み3-Classデータを基に、反復する `direct_nuisance` 行為を持つアカウントを、利用者が根拠を確認して手動でブロック判断できる候補リストとして、安全かつ再現可能に表示・検証・公開できる状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、仕様の正本、受入条件、対象外事項および実施順序を確認する。
- [ ] 2. 既存実装と公開データの確認の範囲で、AIエージェントが、既存キーワード機能との変更境界、3-Class公開成果物、候補公開成果物および検証基盤の現状を確認する。
- [ ] 3. 候補生成契約の実装範囲で、AIエージェントが、exact `handle` とdistinct behavior eventに基づく候補判定、決定的な根拠抽出および入力不整合のfail-closed処理を実現する。
- [ ] 4. 公開と系譜検証の実装範囲で、AIエージェントが、候補・meta・run manifestの整合性、キーワード候補とのdataset snapshot一致および検証完了後の安全な公開を実現する。
- [ ] 5. 候補生成と公開の検証範囲で、AIエージェントまたはCIが、候補境界、重複・競合、決定性、改変検知、snapshot不一致および公開失敗時の保護を確認する。
- [ ] 6. 公開済み入力を用いる成果物生成の範囲で、AIエージェントが、検証済みの `three_class_labeled.json` と対応する `summary.json` から、リリース対象の候補成果物を生成する。
- [ ] 7. アカウント候補表示の実装範囲で、AIエージェントが、既存のフィルターキーワード表示を維持したまま、候補一覧、根拠の開閉およびraw handleのコピーを確認できる状態へ変更する。
- [ ] 8. 利用者向け表示の検証範囲で、AIエージェントまたはCIが、初期表示、view切替、根拠表示、コピー、候補0件時の表示および対象外情報が表示されないことを確認する。
- [ ] 9. リリース判断の範囲で、人間が、公開入力の正当性、privacy上の懸念、受入条件およびリリース可否を判断する。
- [ ] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、公開したdataset snapshotおよび残存する注意点を記録する。

## Work Notes

- 仕様の正本は `account_block_candidate_handoff/UPDATED_ISSUE_BODY.md`、技術契約の正本は `account_block_candidate_handoff/docs/ACCOUNT_BLOCK_CANDIDATE_CONTRACT.md`、現行policy値は `account_block_candidate_handoff/config/accountBlockCandidatePolicy.json` とする。正本間に矛盾がある場合は、実装・merge前に不整合を解消する。
- 入力はpublication gateを通過した `three_class_labeled.json`、対応する `summary.json`、policyおよび現在のキーワード候補metaに限定する。rawデータ、監査sidecar、候補キーワード用の分類・評価成果物は入力に使用しない。
- account候補の初回リリースには、対応する公開済み3-Classデータとsummaryが必要である。handoffには当該実データ本体が含まれないため、候補生成実装とfixture検証は先行できる一方、実成果物生成・E2E publication確認・リリース判断はこの入力が利用可能になってから行う。
- MVPはmanual review専用であり、自動ブロック、永続状態管理、score・推奨度、期間window、subtype推定、handle変更をまたぐ同一性推定、検索および複雑なfilterは対象外とする。
- Close gateは `npm test`、`npm run verify:data`、`npm run build` の成功、およびUI手動確認とする。
