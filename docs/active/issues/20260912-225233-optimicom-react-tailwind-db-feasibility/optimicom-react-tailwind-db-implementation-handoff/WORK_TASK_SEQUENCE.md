# Work Task Sequence: Optimicom React + Tailwind UIのDB正本化

## Purpose

`optimicom-react-tailwind`を、Comment DBを正本とする決定的なread-only公開データで動作する本番向けUIへ移行し、定義済みの受入条件を満たした状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、実装正本・受入条件・対象範囲・対象外範囲を確認する。
  - [x] 1.1 仕様確認の範囲で、AIエージェントが、`IMPLEMENTATION_SPEC.md`を実装動作の正本として整理する。
  - [x] 1.2 完了判定の範囲で、AIエージェントが、`ACCEPTANCE_TESTS.md`の検証条件を実装領域ごとに整理する。
- [x] 2. 既存実装の範囲で、AIエージェントが、対象UI・Comment DB・既存候補生成・既存公開契約の利用箇所と変更境界を確認する。
- [x] 3. 仕様整理の範囲で、AIエージェントが、DB schema v8、単一snapshot、3分類、read-only transaction、決定的artifact、release root、画面別lazy loadの実装条件を整理する。
- [x] 4. DB公開基盤の範囲で、AIエージェントが、明示的なmigration実行とschema v8を前提としたread-only読み取りを可能にする変更を行う。
  - [x] 4.1 migration運用の範囲で、AIエージェントが、既存の自動migration動作を壊さず明示的にmigrationだけを実行できる状態へ変更する。
  - [x] 4.2 DB読み取りの範囲で、AIエージェントが、migration・write・DDLを伴わずschema v8以外を拒否する読み取り経路へ変更する。
  - [x] 4.3 snapshot整合性の範囲で、AIエージェントが、current keyword publicationが指す単一snapshotから観測と3分類ラベルを同一read transactionで取得する状態へ変更する。
- [x] 5. 決定的データ生成の範囲で、AIエージェントが、Comments・Overview・Keywords・Accountsの4つの公開データを同一snapshotから生成する変更を行う。
  - [x] 5.1 source datasetの範囲で、AIエージェントが、既存handoff契約と同一のshape・key order・serializationでsource datasetを生成し、current publicationのSHAを検証する。
  - [x] 5.2 Overview集計の範囲で、AIエージェントが、基準日・期間集計・3分類件数・欠測日・coverageを決定的に生成する。
  - [x] 5.3 Keywords公開の範囲で、AIエージェントが、current publicationの候補順と既存semantic hashを維持した公開データを生成する。
  - [x] 5.4 Accounts候補の範囲で、AIエージェントが、既存policy 1.0.0と既存候補生成処理を再利用して候補と根拠例を生成する。
- [x] 6. UI release公開の範囲で、AIエージェントが、4つのcontent-addressed artifactと専用release rootを検証可能かつ原子的に公開する変更を行う。
  - [x] 6.1 release契約の範囲で、AIエージェントが、source・policy・artifact・record countの整合性を表現するrelease schemaを整備する。
  - [x] 6.2 公開処理の範囲で、AIエージェントが、artifactを先に公開しrelease rootを最後に原子的に切り替える状態へ変更する。
  - [x] 6.3 検証処理の範囲で、AIエージェントが、localおよびdeployed releaseのbyte SHA・shape・件数・semantic invariantsを検証する状態へ変更する。
- [x] 7. UIデータ表示の範囲で、AIエージェントが、sample business dataを排除しrelease rootを起点とするread-only表示へ5画面を変更する。
  - [x] 7.1 runtime loadingの範囲で、AIエージェントが、page lifetimeのrelease固定、画面別lazy load、成功artifactのmemory cache、fatal／screen-local errorを実現する。
  - [x] 7.2 Home・Overviewの範囲で、AIエージェントが、3分類の実データ、対象観測数、データ基準日、部分観測を仕様どおり表示する。
  - [x] 7.3 Commentsの範囲で、AIエージェントが、3分類filter・検索・50件pagination・決定的順序・空状態を仕様どおり表示する。
  - [x] 7.4 Keywords・Accountsの範囲で、AIエージェントが、既存recommendation・構造化根拠・候補判定の根拠を仕様どおり表示する。
  - [x] 7.5 表示制約の範囲で、AIエージェントが、6分類・Score・GOOD・AI総評・risk・Priority・unsupported history・sample fallbackを本番UIから除去する。
- [x] 8. ブラウザローカル状態の範囲で、AIエージェントが、copy事実とaccountのmanual markを外部適用状態と分離して保持する変更を行う。
  - [x] 8.1 状態管理の範囲で、AIエージェントが、versioned local stateの読み書き・検証・不正値処理を整備する。
  - [x] 8.2 操作結果の範囲で、AIエージェントが、clipboard成功時だけcopied stateを更新し、accountのblocked markを独立してtoggleする状態へ変更する。
  - [x] 8.3 状態境界の範囲で、AIエージェントが、local stateをDB-derived valueへ影響させず、TikTok上の適用確認と誤認させない表示へ変更する。
- [ ] 9. 検証範囲で、AIエージェントまたはCIが、DB・公開処理・release検証・UI表示・local state・既存契約の受入条件を確認する。
  - [x] 9.1 公開データの範囲で、AIエージェントまたはCIが、schema v8必須、read-only、single snapshot、完全label、exact SHA、determinism、manifest-lastを検証する。
  - [x] 9.2 UIの範囲で、AIエージェントまたはCIが、release pinning、lazy load、failure isolation、3分類、欠測と0の区別、検索・pagination、recommendation、NEW判定を検証する。
  - [x] 9.3 既存契約の範囲で、AIエージェントまたはCIが、既存`data-release.json` schema v1と既存テストに回帰がないことを確認する。
  - [ ] 9.4 全体検証の範囲で、AIエージェントまたはCIが、package tests、対象UI tests、build、local release verification、deployed release verificationを実行する。
- [x] 10. 作業結果の範囲で、AIエージェントが、実施内容・検証結果・残存制約・release identityを記録する。

## Work Notes

- 実装時の優先順位は `IMPLEMENTATION_SPEC.md`、`ACCEPTANCE_TESTS.md`、本書、`DECISIONS.md`、`SOURCE_MAP.md`、上位Issue本文、調査資料の順とする。
- Phase 1のsource snapshotは、DB-current `keyword_candidate_publications` rowが指す単一snapshotに固定する。
- UI runtimeはSQLiteへ直接接続せず、DBから生成したread modelだけを読む。既存`data-release.json` schema v1と`publish:joint-data`の契約は変更しない。
- 3分類は `normal`・`reactive`・`direct_nuisance` を維持し、6分類・新規score・AI生成要約・risk modelは対象外とする。
- 欠測日は0件ではなく `null`／gapとして扱い、観測が存在する日の特定label件数0とは区別する。
- Comments artifactはdeterministic source datasetのexact bytesを使用し、Accountsは`source_index`だけを除去して既存candidate policyへ渡す。
- 現行DBから得られる候補件数は回帰確認値であり、60件・86件・24,622件をproduct contractとして固定しない。
- sample値へのfallback、DBのexport時自動migration、UI exportのDB write、copy成功を追加済み／TikTok上でblock済みと扱うことは禁止する。
- 既存handoff文書と本書は `docs/archive` 配下を参照しない。
- ベースラインコミットは `cdf9127`（`chore: baseline before optimicom DB implementation`）。
- DB reader、deterministic source dataset、Overview、UI release root、4 artifact、local/deployed verifier、UI runtime、localStorage境界を実装した。
- `node --test tests/optimicom-ui-release.test.js tests/architecture-boundaries.test.js tests/comment-database.test.js tests/raw-snapshot-database.test.js tests/three-class-label-summary.test.js` は36件（追加後はread-onlyテストを含む37件）成功した。対象UIのVitest 7件、Vite build、既存 `release.test.js` / `publication.test.js` も成功した。
- explicit migration CLIはテスト用DB複製に対してschema v7→v8を適用でき、fixture releaseのlocal verifierはrelease identity・4 artifact・canonical policyを検証して成功した。実DBexportはschema v7でmanifestを作らず終了した。
- `npm test` は129件中112件成功・17件失敗。失敗は今回変更していない `package/src/data/filterKeywordCandidates.json` がcanonical registry/evaluationの194件ではなく86件で、既存handoff／keyword-candidate DB契約の再構成検証に失敗する既存不整合によるもの。今回のUI releaseテストは成功している。
- 実DB `var/comment-history.sqlite3` はschema v7のためexportを `SCHEMA_VERSION_REQUIRED` で拒否した。テスト用複製DBを明示migrationした後も、current publicationのsource dataset SHA不一致を検出して公開を拒否した。実DB・既存publicationは変更していない。
- production release identityはsource SHA不一致により生成していない。manifestのidentityは `source`・`policies`・4 artifact metadataの決定的組み合わせとしてlocal/deployed verifierで比較する。
