# Work Task Sequence: 継続更新フロー（rawからGitHub Pagesまで）

## Purpose

次回以降の更新で、5-field rawデータの準備からラベリング、候補キーワード更新、React UI反映、GitHub Pages公開確認までを、同じ検証条件と責務分担で再実行できる状態にする。

## Task Sequence

- [ ] 1. 更新run準備の範囲で、人間が、対象日付の5-field rawデータを配置し、入力元と対象期間を確認する。
- [ ] 2. raw契約検証の範囲で、AIエージェントが、入力形式・5フィールド完全一致・レコード件数・入力SHAを確認する。
- [ ] 3. Stage 13準備の範囲で、AIエージェントが、固定参照snapshotに基づくexact reuseとpendingバッチを生成する。
- [ ] 4. Stage 13意味レビューの範囲で、人間が、pendingバッチを確認し、各回答CSVへ`normal`または`nuisance`と判定根拠を記入する。
- [ ] 5. Stage 13回答検証の範囲で、AIエージェントが、全バッチの件数・coverage・source SHA・ラベル値・noteを検証する。
- [ ] 6. Stage 13最終化の範囲で、AIエージェントが、全回答を統合し、入力順と5フィールドを保持したStage 13ラベル済みJSONを生成する。
- [ ] 7. 3-Class first passの範囲で、AIエージェントが、golden/P2 registryを適用した候補結果とレビューキューを生成する。
- [ ] 8. 3-Class mandatory reviewの範囲で、人間が、未解決P0/P1を確認し、`record_key,label,note`契約のoverride CSVを完成させる。
- [ ] 9. 3-Class strict finalizationの範囲で、AIエージェントが、P0/P1未解決件数0を確認して最終3-Class JSONを生成する。
- [ ] 10. 統合検証の範囲で、AIエージェントが、raw・Stage 13・3-Class・監査情報の件数、順序、ラベル、参照整合性およびSHAを検証する。
- [ ] 11. candidate handoffの範囲で、AIエージェントが、labeling summary・validation・最終dataset SHAを検証した候補生成handoffを生成する。
- [ ] 12. 候補意味レビューの範囲で、人間が、candidate handoffをChatGPTへ渡し、candidate proposal JSONを未編集で保存する。
- [ ] 13. candidate proposal検証の範囲で、AIエージェントが、request identity、schema、candidate ID、taxonomy、variantsおよびaction競合を検証する。
- [ ] 14. local candidate publicationの範囲で、AIエージェントが、検証済みproposalをfull-updateし、生成されたcurrent publicationをvalidate-currentする。
- [ ] 15. リリース判断の範囲で、人間が、受入条件と公開成果物を確認し、運用開始を承認または保留する。
- [ ] 16. React UI反映の範囲で、AIエージェントが、承認済み公開データをUIの静的データへ反映し、テストとproduction buildを確認する。
- [ ] 17. Git反映の範囲で、AIエージェントが、必要なUIデータ・設定・作業記録だけをコミットし、rawと作業生成物を除外する。
- [ ] 18. GitHub Pages公開の範囲で、AIエージェントまたはCIが、`main`のbuild・Pages deploy・公開URLのHTTP応答を確認する。
- [ ] 19. 更新結果記録の範囲で、AIエージェントが、入力SHA、最終dataset SHA、run ID、公開件数、検証結果および注意点を記録する。

## Work Notes

- 対象runの作業領域は`work/<YYYYMMDD>/`とする。raw、ChatGPT回答、中間JSON、handoff、publication、ZIPはここに置き、`/work/`のignore設定によりコミットしない。
- 人間が配置するrawの標準パスは`work/<YYYYMMDD>/current_raw.json`。rawはtop-level arrayで、各レコードのキーを`username`、`handle`、`comment`、`postedAt`、`postedDate`の5つに限定する。
- Stage 13の標準コマンドは次のとおり。参照ファイルは毎回同じsnapshotを明示する。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' prepare-stage13 \
    'work/<YYYYMMDD>/current_raw.json' \
    --reference 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/reference/stage13_labeled_REFERENCE.json' \
    --outdir 'work/<YYYYMMDD>/stage13'
  ```

- Stage 13 pendingバッチは、各`batch_NNN.json`、`batch_NNN_context.json`、`batch_NNN_adjudications.csv`を同じ番号で扱う。回答CSVは生成templateとは別の`work/<YYYYMMDD>/chatgpt-stage13/`へ保存し、全expected batchが揃うまでfinalizeしない。
- Stage 13の統合コマンドは次のとおり。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' finalize-stage13 \
    'work/<YYYYMMDD>/current_raw.json' \
    --workspace 'work/<YYYYMMDD>/stage13' \
    --adjudications-dir 'work/<YYYYMMDD>/chatgpt-stage13' \
    --output 'work/<YYYYMMDD>/stage13_labeled.json'
  ```

- 3-Class first passは`--strict-final`なしで実行する。`unresolved_mandatory_reviews > 0`の場合だけP0/P1を人間がレビューし、P2未解決は公開阻止条件にしない。finalizeはoverride検証後に`--strict-final`で行う。
- 統合検証の標準コマンドは、`--require-resolved`と`--three-class-audit`を必須にする。`summary.final_published == true`、`summary.unresolved_mandatory_reviews == 0`、`validation.all_checks_passed == true`をcandidate handoffの前提とする。
- candidate handoffでは、`--labeling-summary`と`--labeling-validation`を必ず同時指定する。`prompt.txt`をChatGPTへのメッセージとして使い、`handoff_manifest.json`はChatGPTへ渡さず、回答JSONは未編集で保存する。
- candidate workflowの`--publication-root`は、直下に`current/`を持つ公開ルートでなければならない。`package/src/data`がフラットな場合は、既存5公開artifactを`work/<YYYYMMDD>/candidate-publication/current/`へ作業用に複製してからhandoff生成に使い、`package/src/data`を直接公開ルートとして指定しない。
- candidate `full-update`は基準公開ルートとは別の新規出力rootへ行う。出力rootの`current`には基準公開のcurrentを参照するsymlinkを先に用意し、atomic promotion後の`current`をrelease artifactとする。
- React UIは`package/src/App.jsx`から`package/src/data/filterKeywordCandidates.json`を静的importする。公開済みcurrentから次の5ファイルを反映し、`candidateWorkflowConfig.json`などUI固有データは変更しない。

  ```text
  candidate_registry.json
  candidate_evaluation.json
  filterKeywordCandidates.json
  filterKeywordCandidates.meta.json
  run_manifest.json
  ```

- GitHub Pages初回設定は`.github/workflows/deploy-pages.yml`と`package/vite.config.js`で済んでいる。ViteのPages baseは`/mi-comopt/`、build artifactは`package/dist`、公開URLは`https://unow-dev.github.io/mi-comopt/`。次回以降はUIデータの更新を`main`へpushすればworkflowがbuild/deployする。
- コミット対象は、承認済み公開データ、必要なUI設定、作業記録に限定する。`work/`、raw、ChatGPT handoff、回答CSV、中間publicationはコミットしない。別のactive Issueを内容確認なしにignoreしない。
- 完了判定は、local `validate-current`成功、GitHub Actionsのbuild/deploy成功、公開URL HTTP 200、公開HTMLの`/mi-comopt/assets/`参照確認まで行う。
- 今回の実績（2026-08-26）：raw 24,622件、Stage 13人手判定3,190件、3-Class mandatory review 14件、公開candidate 194件、candidate run ID `run_bf8163da-cc49-4549-a42a-f02636d4b97c`。
