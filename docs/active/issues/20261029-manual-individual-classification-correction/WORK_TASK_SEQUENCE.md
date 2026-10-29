# Work Task Sequence: 手動での個別分類修正経路の実装

## Purpose

既に分類済みのコメントを個別に手動修正し、その理由と承認履歴を保持した新しいClassification Versionとして公開できる。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、決定済み事項と未決事項を分離する。
- [x] 2. 未決事項の範囲で、人間が、必要な仕様判断を行う。
- [x] 3. 既存分類フローの範囲で、AIエージェントが、現在の仕組みと変更影響を確認する。
- [x] 4. 仕様整理の範囲で、AIエージェントが、実装前に満たすべき条件を整理する。
- [x] 5. 必要最小限の変更範囲で、AIエージェントが、個別修正の目的を満たす変更を行う。
- [x] 6. 検証範囲で、AIエージェントまたはCIが、修正・監査・既存フローへの影響を確認する。
- [x] 7. 作業結果の範囲で、AIエージェントが、実施内容と確認結果を記録する。

## Work Notes

- 着手前のベースラインコミット: `992d22f baseline: classification correction handoff`。
- reviewed-fixed handoffにより仕様判断は確定済み。現行累積Classification headのStateはschema_version 2のため、訂正Versionもそのschema versionを維持する。
- `comment-data-update@3`のhashを保ち、安全な失敗分岐を`@4`として追加した。operatorは@4を既定候補として開始する。
- 補正経路は隔離DB/WorkspaceとMemoryDeploymentAdapterでaccept、Release pin、deployment identity検証まで確認した。
- production DB/Workspaceは使用していない。productionのAC-08 identity確認は未実施。
- 分類修正を含む関連テスト29件とTemporal E2E 4件が成功。パッケージ全体テスト212件も成功。
- 現行の累積分類プランは、既存のobservation labelまたはcomment text labelを引き継ぎ、未分類項目をhandoffに含める。
- 分類修正は既存Versionの直接変更ではなく、新しいVersionへの明示的な修正提案として扱う方針。
- 対象、修正前後のラベル、理由、実行者、対象Versionを監査可能にし、承認後は通常のrelease・promotion経路へ接続する。
