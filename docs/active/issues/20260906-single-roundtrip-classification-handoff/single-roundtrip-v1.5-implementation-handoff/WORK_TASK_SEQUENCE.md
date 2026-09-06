# Work Task Sequence: Single-roundtrip classification v1.5 implementation

## Purpose

v1.4の分類意味論と下流成果物の互換性を維持したまま、分類handoffを単一の送付と単一の回答で完結できるv1.5 pipelineを、検証済みの状態でcutoverできるようにする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、最終仕様、フリーズ要件、受入条件、対象外事項、および文書間の優先順位を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、実repositoryのv1.4基準状態、operational state、変更境界、および回帰確認方法を確認する。
- [x] 3. PR1の実装範囲で、AIエージェントが、v1.4の意味論を保持したv1.5 sibling implementationと、single-roundtrip用の内部準備を実現する。
- [x] 4. PR1の検証範囲で、AIエージェントまたはCIが、v1.4ツリーの不変性、v1.5との意味論的同等性、policy version、およびv1.5 manifestの整合性を確認する。
- [x] 5. PR2の実装範囲で、AIエージェントが、単一往復の分類依頼を準備し、snapshot、binding、分類task、request identity、およびhuman decisionが不要な経路を扱えるようにする。
- [x] 6. PR2の検証範囲で、AIエージェントまたはCIが、prepare処理、taskの重複排除・activation・再利用境界、request binding、およびCLI/receipt契約を確認する。
- [x] 7. PR3の実装範囲で、AIエージェントが、単一の分類回答を厳格に検証し、最終成果物、監査情報、operational state、および再試行可能な確定処理を実現する。
- [x] 8. PR3の検証範囲で、AIエージェントまたはCIが、response contract、最終成果物とprovenance、競合時のfail-closed動作、再試行、およびCLI/receipt契約を確認する。
- [x] 9. PR4の実装範囲で、AIエージェントが、v1.4とv1.5が並存する下流互換性、shadow replay、および既存候補・account・release工程との接続を実現する。
- [x] 10. PR4の検証範囲で、AIエージェントまたはCIが、version組合せの許可・拒否、v1.4 fallback、shadow replay、account/release、およびv1.4 default継続を確認する。
- [ ] 11. cutover判断の範囲で、人間が、PR1からPR4までの全gate結果を確認し、v1.5を通常運用へ切り替える可否を判断する。
- [ ] 12. PR5の実装・検証範囲で、AIエージェントまたはCIが、承認済みのv1.5分類工程を通常runbookへ反映し、v1.4を保持したままcutover後の受入条件を確認する。
- [ ] 13. 作業結果の範囲で、AIエージェントが、実施内容、各PRの検証結果、cutover判断、および残存する運用上の注意点を記録する。

## Work Notes

- 仕様の正本は `source/ISSUE_BODY.md` のフリーズ要件、`NORMATIVE_IMPLEMENTATION_SPEC.md`、v1.5で更新する `docs/PIPELINE_CONTRACT.md`、versioned request/response contractとacceptance tests、実装、README/runbook/commentsの順とする。
- v1.4の二段階運用とsource treeはcutover gate通過まで変更しない。v1.5はsibling implementationとして追加し、Stage13からThree-Classへの意味上の順序、Three-Class policy version、既存clean artifact schemaを維持する。
- human classification communicationは最大1 handoffと1 responseとする。一方でreviewer内部のmodel invocation、batch、pass数は制約しない。
- Stage13のpending dedupeはraw bytes/valueが完全一致する5 fieldに限定する。golden/P2の再利用とThree-Class taskの統合はexact `record_key`に限定し、unresolved P2だけをmandatory human taskに加えない。
- supplied v1.4 snapshotのmanifestにはhash/size不一致があるため、v1.4を変更して補正しない。PR1開始前に実repositoryのbaseline integrityを確認する。
- PR2からPR5へは対応するacceptance testsが通過した場合にのみ進む。受入試験はAからHまでの全ケースに加え、`npm test`、`npm run verify:data`、`npm run build`を最終確認とする。
- 新しいpublic CLIは成功時に単一JSON objectをstdoutへ出力してexit 0とし、想定される入力・契約・競合の失敗ではstdoutを空にしてexit 3とする。
- v1.5のcutoverは分類工程だけを置換する。candidate handoff以降の既存flowとv1.4 implementationは保持し、unknown pipeline versionやv1.4/v1.5のmixed evidenceは受け入れない。
- 2026-09-06時点でPR1〜PR4を完了。v1.5回帰25群、v1.4回帰24群、Node 78テスト、`verify:data`、production build、manifest 43 filesを確認した。
- H09 releaseは、single-roundtrip finalを既存release builder/validatorへ接続する隔離fixtureで確認した。H10 shadow replayは、同一accepted responseからのv1.4 fallbackとv1.5 finalでStage13/Three-Classの意味内容が一致することを確認した。
- finalized retryの`--state-dir` mismatch bypassを修正し、root receiptあり／promoted receiptのみの両経路でfail-closedを確認した。
- cutover判断は未実施。人間の承認まではv1.4 recurring defaultを維持し、PR5による通常runbookの置換は行わない。