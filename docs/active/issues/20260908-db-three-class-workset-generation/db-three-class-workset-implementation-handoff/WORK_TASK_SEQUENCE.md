# Work Task Sequence: Comment DB → 3-class workset generation implementation

## Purpose

Comment DBで明示選択したsnapshotから、既存のanalysis projectionおよびv1.5.0 single-roundtrip contractを変更せずに、finalize可能なlocal workspaceとportableな3-class workset ZIPを原子的に生成できる状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、規範仕様、採択済み判断、受入条件、設計へ戻る条件、対象外事項、および文書間の優先順位を確認する。
- [ ] 2. 実装前確認の範囲で、AIエージェントが、既存Comment DBのselector・projection・path・error contract、既存v1.5.0 single-roundtripのprepare・finalize contract、関連テスト、および変更境界を確認する。
- [ ] 3. 実装境界の判断範囲で、人間が、既存pipelineまたはanalysis projectionの意味変更、classification evidence境界の変更、finalize互換性の喪失、またはlineageの一意性不足が判明した場合に、設計へ戻る要否を判断する。
- [ ] 4. snapshot選択の実装範囲で、AIエージェントが、既存Comment DBと同一のfail-closedなselector解決意味論を共有し、明示selectionの決定性を維持する経路を実現する。
- [ ] 5. workset packagingの実装範囲で、AIエージェントが、規定されたtransport境界、logical memberに基づくworkset identity、manifest完全性、およびZIP生成時の安全性を満たす経路を実現する。
- [ ] 6. orchestrationとworkspaceの実装範囲で、AIエージェントが、既存projectionから変更のないsingle-roundtrip preparation、provenance binding、integrity verification、zero-handoff処理、およびcommand全体の原子性を接続する経路を実現する。
- [ ] 7. CLIと運用契約の実装範囲で、AIエージェントが、必須引数・既存path解決・既存error convention・成功時出力を維持した単一commandの利用経路を実現する。
- [ ] 8. 単体および結合検証の範囲で、AIエージェントまたはCIが、selector等価性・順序・重複・provenance bytes・integrity binding・workset identity・transport境界・安全なpackaging・zero-handoff・失敗時の非残留を確認する。
- [ ] 9. 互換性と受入検証の範囲で、AIエージェントまたはCIが、生成workspaceの既存finalize利用、human decisionあり・なしの実pipeline E2E、comment-batchとrich snapshotまたはmixed selection、既存Comment DB tests、既存v1.5.0 tests、および全受入条件を確認する。
- [ ] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、設計へ戻る判断の有無、残存する運用上の注意点、および対象外事項を記録する。

## Work Notes

- 規範仕様は `ISSUE_BODY_CANONICAL.md` とする。文書間に矛盾がある場合は、`README_FIRST.md` に定める優先順位に従い、本sequenceは仕様を再定義しない。
- 新経路は Comment DB snapshot selection、既存analysis projection、変更しないv1.5.0 `prepare-single-roundtrip`、provenance binding、workset packagingを接続するcomposition layerに限定する。Stage13/Three-Classの分類意味論、`request_id`、既存request package、既存pipeline artifactを変更しない。
- `request/`をclassificationのcanonical packageとし、`provenance/`はDB lineageの確認に限定する。transport ZIPのmember境界、`workset_id`のcanonical preimage、既存workspaceに保持するartifactは canonical issueおよび `ACCEPTANCE_CHECKLIST.md` に従う。
- selectorの共有、outer staging、integrity mismatch、ZIP安全性、既存workspace上書き拒否はfail-closedとする。途中失敗時に指定final workspaceを残さず、既存artifactを書換えて一致させない。
- 検証ではselector表記や一時pathではなくresolved snapshot selectionとlogical transport member bytesを基準に再現性を判定する。無関係なDB snapshotの追加は同一selectionのworksetを変化させてはならない。
- v1.5.0 pipelineまたは5-field projectionの意味変更が必要になった場合、実装で吸収・変更せず、task 3の設計判断へ戻す。response自動送受信、DB import、reference/registry lifecycle、zip-only finalize、過去workspace migrationは対象外である。
