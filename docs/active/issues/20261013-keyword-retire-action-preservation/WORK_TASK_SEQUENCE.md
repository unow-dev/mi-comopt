# Work Task Sequence: キーワード引退提案の保持と再評価

## Purpose

提出されたキーワード提案の追加・更新・引退が欠落なく評価され、修正後の更新案を人間がレビューできる状態になる。

## Task Sequence

- [x] 1. 既存の提案処理と再評価の範囲で、AIエージェントが、欠落の原因と既存評価の扱いを確認する。
- [x] 2. 必要最小限の変更範囲で、AIエージェントが、引退提案を保持する変更を行う。
- [x] 3. 評価から公開用データ生成までの検証範囲で、AIエージェントが、提案内容と引退状態が保持されることを検証する。
- [x] 4. 提出済み提案の再評価の範囲で、AIエージェントが、修正済み処理でレビュー可能な更新案を作成する。
  - [x] 4.1 提案の整合性確認の範囲で、AIエージェントが、全34件の保持と候補間の制約を検証する。
  - [x] 4.2 重複表現の扱いの範囲で、人間が、検出された競合の解消方法を決定する。
  - [x] 4.3 人間の判断を反映した提案の範囲で、AIエージェントが、再評価を行う。
- [x] 5. 作業結果の範囲で、AIエージェントが、変更内容と検証・再評価の結果を記録する。

## Work Notes

- 2026-10-13、ユーザーが不具合修正と修正後の再評価を明示的に指示した。
- 入力は追加6件・更新20件・引退8件の計34件。旧更新案 `proposal_8990b1ac5a1a93b6167cc0fc6ec7181a` では引退8件が欠落し、26件になっていた。
- 引退アクションは契約上 `action` と `candidate_id` のみを持つ。キーワード名は同じhandoffの候補情報を根拠に解決する。
- 既存評価のoperation receiptとProposalは変更しない。確定済みの分類と提出済み提案を引き継ぐ再評価手順を用いる。
- 既存のユーザー変更には手を加えない。`docs/archive` は参照しない。
- 引退対象のキーワードは、ArtifactStoreの固定handoff ZIPから候補一覧を読み、request ID、input fingerprint、manifestのファイルハッシュを照合して解決する。既存DB schemaとv2の正規化処理は変更しない。
- 回帰テスト4件と関連テスト29件が成功。引退の保持、DB保存、UI公開からの除外、handoff不一致時の拒否、旧receiptの保持を確認した。
- 提出済みの実入力でも34件（追加6・更新20・引退8）の保持を確認した。
- 全34件の公開用データ生成を検証したところ、更新候補 `kw_76bd7568-806f-41d8-93d2-99994b3f4616` のvariant `25歳が何してる` が、既存候補 `kw_8ecfb342-eb86-4bad-9778-f95a8c869411` と新たに競合することを確認した。ユーザーが、既存候補を維持し更新側から重複表現を除外する扱いを決定した。
- 旧案は、ユーザーの修正・再評価指示に基づく不完全な評価の却下として記録した。旧Sessionはcompleted、Keyword finalizationはrejected。旧Proposalとreceiptを保持している。
- 再評価用Sessionは `production-comment-data-update-20261013T122628Z-retire-fix`。同一comment-batchを再利用し、Corpusは `version_c1ab5fb49db7c1d13ec7c3912f68de5b` のままunchanged、確定済みClassification `version_1bdcfbf6eebbbf834439151f0f0d5ad5` をpinした。
- 再評価用SessionでClassificationはunchanged / reusedとなり、新しいkeyword handoffを生成した。request IDは `cgr_fb901a91-ebb7-4b64-8a6d-4a771e97f7e4`、input fingerprintは元と同じ `sha256:a15c8a7e66fb03f9140d68d313b4e1c4dba9f5cba5ee036ff3172f1c05b707fc`。requestとmanifest以外の9ファイルは元のhandoffとbyte単位で一致している。
- 新しい提案の受け取り先は `var/work-orchestrator-production/sessions/2dd1d525dff84afec98f6bf12301fb3f/55b1f768a9bed1cec9a20a295f510c8d/output/candidate_proposal.json`。ユーザーの判断を反映して重複variantを1件除外し、同一input fingerprintの新しいrequest IDに合わせた提案を配置・提出した。その他の33件のアクションは元の提案と一致し、元ファイルは保持している。
- 修正済み提案のSHA-256は `ffee7fc52f84627cbc2365eb3ac50039094c012ec6f36dfcc39f1223963690b6`。スキーマ、候補ID・ライフサイクル、候補間の競合、引退8件の適用を再検証した。公開候補の試算は194件。
- 本番再評価のassessmentは `assessment_ed4e0d4164d0a6731a47ee7fe7f89411`、新Proposalは `proposal_ed4e0d4164d0a6731a47ee7fe7f89411`。全34件（追加6・更新20・引退8）の状態が提出内容と一致し、引退8件の `selection_state=retired`、重複表現の除外、Corpus・Classificationのdependency pinを確認した。semantic SHAは `4ea7492758332035b90bd5a593ce6c8bb11540140ce5fad1a93b1ee56ea0b581`。
- 修正と再評価の作業は完了。次は新Proposalに対する人間レビュー `09-review-keyword-selection`（ready）であり、承認前のKeyword Headは `version_1b77978c7138a58e9833c1e4dc6a61d2`。
- ユーザーが再評価済み更新案を承認し、Keyword Version `version_c182c844c8e16cdeb12199ea966a47ee` として34件を確定した。引退8件のDB保存を確認した。
- Release `release-v3_487c656859ca1ea695663708fb63da8b` を生成・materializeした。コメント40,848件、キーワード194件、ブロック候補99件、日次集計30件。6 artifactのhash・bytes、policy、集計とアカウント候補の再現性、引退8件の公開候補からの除外、指定variantの除外と既存候補の保持を確認した。
- レビュー用の同一bytesを `work/20261013/release-v3_487c656859ca1ea695663708fb63da8b/` に配置し、canonical UI release verifierがverifiedを返した。release bundle SHAは `baef1b9caecb9eab2cac248a6b0eb276c55aff45bf3e7dd7052f0f9d438f0037`。
- 公開承認前の本番公開レビュー `13-review-production-promotion` はreadyで、Pages workflowのqueued / in_progressはともに0件であることを確認した。
- `git diff --check` は成功。ユーザーの既存変更を保持した。
- 2026-10-14（JST）、ユーザーの「GitHub Pagesへ本番公開しましょう。」に基づき、検証済みReleaseの本番公開承認を記録した。専用ブランチ `codex/ui-release/deployment-request-v3_b6d9ebe85ebf8a3b61775778e42bb7a2` からworkflow_dispatchを実行し、[Actions run 38418118107](https://github.com/unow-dev/mi-comopt/actions/runs/38418118107) のvalidate・deployがともにsuccessとなった。
- [本番GitHub Pages](https://unow-dev.github.io/mi-comopt/) はHTTP 200。公開markerのRelease ID・Deployment Request ID・bundle SHA・UI manifest SHAが承認対象と一致し、deployed UI verifierがverifiedを返した。コメント40,848件、キーワード194件、ブロック候補99件、日次集計30件の公開artifactを検証した。
- Actions完了イベントの取り込みでは、`COMMENT_DATA_UPDATE_PAGES_REF` に今回の公開専用ブランチを指定した。adapterの既定poll対象はmainのため、実際のworkflow_dispatch先に合わせた。adapterのソースは変更していない。
- Deployment Request `deployment-request-v3_b6d9ebe85ebf8a3b61775778e42bb7a2` はsucceeded、external run refは `github-actions-run:38418118107`。更新Sessionはcompleted、actionable Human Taskは0件。Corpus・Classification・KeywordのHeadは固定Versionと一致し、Promotion・DeploymentのHeadは今回のReleaseを参照している。cutover stateはsmoke_verified、legacy writerとv2 startsは無効、v3 startsは有効であることを確認した。
