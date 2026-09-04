# Closed Decisions

実装中に再議論しないための決定記録。scope変更が必要な場合だけ明示的に開き直す。

| Topic | Adopted | Rejected | Reason |
|---|---|---|---|
| Layer model | Collector / Database / Processing / UI | 第5のadapter layer | 元issueの大枠を維持。adapterは必要な境界だけに置く。 |
| Generic `src/lib` | 解消 | 責務混在のままrenameのみ | ディレクトリ単位で責務を識別する目的を満たさない。 |
| Account legacy path | 1ファイルだけre-export shim | 全shim削除 / artifact書換え / verify:data弱化 | account CLI bytesがhistorical generator SHA契約に含まれるため。 |
| Shim form | 通常JS re-export file | symlink | Git/Windows/zip環境のportable性。 |
| Account CLI | byte-for-byte変更禁止 | import更新 / orchestration抽出 | generator provenanceを壊さない。 |
| Keyword publication | `scripts/adapters/keyword-publication.js` | Processing / Database / generic lib | filesystem境界であり、4レイヤーの実装責務に押し込まない。 |
| Keyword handoff | 意味ロジックをProcessingへ抽出 | scriptに全ロジックを残す | 移動だけでは責務分離が見かけに留まる。 |
| Account orchestration | 今回scriptに残す | keywordと対称になるまで抽出 | provenance契約への波及を避ける。 |
| Comment DB | `src/database` へ移動、API維持 | file-read API分解 / pure-core化 | 既存MVP handoffでDB境界は既に決定済み。 |
| UI data boundary | artifact -> UI model変換 | JSONの単純re-export | raw schemaへの依存を境界で変換するため。 |
| UI adapter fields | Appが使うfieldだけ公開 | artifact全fieldをcamelCaseコピー | adapter自体がartifact schemaの複製になるのを防ぐ。 |
| NEW判定 | UI moduleのみを正とする | Processingにも重複保持 | 表示規則であり現状重複している。 |
| Architecture enforcement | Node標準test | レビュー規約のみ / ESLint plugin追加 | 新dependencyなしで回帰を検出する。 |
| Pure-core rules | 今回導入しない | UUID/時刻/node:crypto等を全面排除 | issue本文の要求を超えるscope creep。 |
| Historical artifacts | byte-for-byte変更しない | refactor後に再生成 | 過去provenanceを書き換えない。 |
| UI footer copy | 原則変更しない | architecture理由だけで文言変更 | 文字列表示はコード依存ではなく、product copy変更はscope外。 |
