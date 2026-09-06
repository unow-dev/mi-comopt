# Work Task Sequence: 継続更新フロー（rawからGitHub Pagesまで）

## Purpose

次回以降の更新で、5-field rawデータの準備からラベリング、候補キーワード更新、React UI反映、GitHub Pages公開確認までを、同じ検証条件と責務分担で再実行できる状態にする。

## Task Sequence

- [ ] 1. 更新run準備の範囲で、人間が、対象日付の5-field rawデータを配置し、入力元と対象期間を確認する。
- [ ] 2. raw契約検証の範囲で、AIエージェントが、authoritative full snapshotの入力形式・5フィールド完全一致・全値string・レコード件数・入力SHAを確認する。
- [ ] 3. Stage 13準備の範囲で、AIエージェントが、bootstrapでは明示したimmutable baselineを、通常更新では直前公開成功runからpromoteしたprivate referenceを使ってexact reuseとpendingバッチを生成する。
- [ ] 4. Stage 13意味レビューの範囲で、人間が、pendingバッチを確認し、各回答CSVへ`normal`または`nuisance`と判定根拠を記入する。
- [ ] 5. Stage 13回答検証の範囲で、AIエージェントが、全バッチの件数・coverage・source SHA・ラベル値・noteを検証する。
- [ ] 6. Stage 13最終化の範囲で、AIエージェントが、全回答を統合し、入力順と5フィールドを保持したStage 13ラベル済みJSONを生成する。
- [ ] 7. 3-Class first passの範囲で、AIエージェントが、operational golden/P2 registryを適用した候補結果とレビューキューを生成する。
- [ ] 8. 3-Class mandatory reviewの範囲で、人間が、未解決P0/P1を確認し、`record_key,label,reason_code,note`契約のreview CSVを完成させる。
- [ ] 9. 3-Class registry promotionの範囲で、AIエージェントが、current auditに対するreview対象・reason/label整合・P2適格性・既存decision競合を検証してoperational registryへ反映する。
- [ ] 10. 3-Class strict finalizationの範囲で、AIエージェントが、overrideなしでP0/P1未解決件数0を確認して最終3-Class JSONを生成する。
- [ ] 11. 統合検証の範囲で、AIエージェントが、raw・Stage 13・3-Class・監査情報の件数、順序、ラベル、参照整合性およびSHAを検証する。
- [ ] 12. candidate handoffの範囲で、AIエージェントが、labeling summary・validation・最終dataset SHAを検証した候補生成handoffを生成する。
- [ ] 13. 候補意味レビューの範囲で、人間が、candidate handoffをChatGPTへ渡し、candidate proposal JSONを未編集で保存する。
- [ ] 14. candidate proposal検証の範囲で、AIエージェントが、request identity、schema、candidate ID、taxonomy、variantsおよびaction競合を検証する。
- [ ] 15. local keyword publicationの範囲で、AIエージェントが、親manifestを検証したfull-updateをstagingへ実行し、生成されたcurrent publicationをvalidate-currentする。
- [ ] 16. local account publicationの範囲で、AIエージェントが、今回生成したkeyword metaと同じthree-class finalからaccount候補をstagingへ生成する。
- [ ] 17. 共同公開検証の範囲で、AIエージェントが、keyword/accountの8 artifact、共有dataset SHA、data-release.jsonおよびcanonical runtime contractをfail-closed検証する。
- [ ] 18. リリース判断の範囲で、人間が、raw snapshot、公開対象、検証結果および公開可否を判断する。
- [ ] 19. React UI反映の範囲で、AIエージェントが、承認済み8 artifactとdata-release.jsonをUIの静的データへ反映し、テストとproduction buildを確認する。
- [ ] 20. Git反映の範囲で、AIエージェントが、8 artifact・operational registry・data-release.json・必要文書だけをコミットし、rawと作業生成物を除外する。
- [ ] 21. GitHub Pages公開の範囲で、AIエージェントまたはCIが、`main`のvalidation/build後に限りPagesへdeployし、公開URLの`data-release.json` bytes一致を確認する。
- [ ] 22. 公開後継続性の範囲で、AIエージェントが、公開成功後だけStage 13 outputをprivate referenceへpromotionし、次回prepareのsmokeを実行する。
- [ ] 23. 更新結果記録の範囲で、AIエージェントが、raw・Stage 13・three-class・keyword/account runの対応、入力SHA、公開件数、検証結果および注意点を記録する。

## Work Notes

- 対象runの作業領域は`work/<YYYYMMDD>/`とする。raw、ChatGPT回答、中間JSON、handoff、publication、ZIPはここに置き、`/work/`のignore設定によりコミットしない。
- v1.5 single-roundtripのcutover gateが承認されるまでは、通常更新のStage13〜Three-Class defaultはv1.4 commandを維持する。検証runだけは次の2コマンドで実行し、既存のcandidate handoff以降へはv1.4互換summary/validationとfinal datasetを渡す。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py' prepare-single-roundtrip \
    'work/<YYYYMMDD>/current_raw.json' \
    --reference 'var/integrated-labeling/stage13_reference.json' \
    --workspace 'work/<YYYYMMDD>/single-roundtrip' \
    --state-dir 'var/integrated-labeling'

  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py' finalize-single-roundtrip \
    --workspace 'work/<YYYYMMDD>/single-roundtrip' \
    --response 'work/<YYYYMMDD>/classification_response.json' \
    --state-dir 'var/integrated-labeling'
  ```

- single-roundtripの`final/summary.json`と`final/validation_report.json`は、既存のcandidate/account/release契約へ渡す前に、`final/three_class_labeled.json`のSHA、mandatory review解決、`pipeline_version`の一致を確認する。ZIPはtransport artifactであり、finalizeはworkspaceのcanonical requestを使う。
- 人間が配置するrawの標準パスは`work/<YYYYMMDD>/current_raw.json`。rawはtop-level arrayで、各レコードのキーを`username`、`handle`、`comment`、`postedAt`、`postedDate`の5つに限定する。
- Stage 13の標準コマンドは次のとおり。初回bootstrapだけ`--bootstrap`でimmutable baselineを選択でき、通常更新では`var/integrated-labeling/stage13_reference.json`の存在を確認して同じprivate referenceを3コマンドすべてに明示する。private referenceがない通常runは停止する。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' prepare-stage13 \
    'work/<YYYYMMDD>/current_raw.json' \
    --reference 'var/integrated-labeling/stage13_reference.json' \
    --outdir 'work/<YYYYMMDD>/stage13'
  ```

- Stage 13 pendingバッチは、各`batch_NNN.json`、`batch_NNN_context.json`、`batch_NNN_adjudications.csv`を同じ番号で扱う。回答CSVは生成templateとは別の`work/<YYYYMMDD>/chatgpt-stage13/`へ保存し、全expected batchが揃うまでfinalizeしない。
- Stage 13の統合コマンドは次のとおり。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' finalize-stage13 \
    'work/<YYYYMMDD>/current_raw.json' \
    --workspace 'work/<YYYYMMDD>/stage13' \
    --adjudications-dir 'work/<YYYYMMDD>/chatgpt-stage13' \
    --reference 'var/integrated-labeling/stage13_reference.json' \
    --output 'work/<YYYYMMDD>/stage13_labeled.json'
  ```

- 3-Class first passはoperational golden/P2 registryを明示して`--strict-final`なしで実行する。`unresolved_mandatory_reviews > 0`の場合だけP0/P1を人間がレビューし、P2未解決は公開阻止条件にしない。review後は`promote-three-class`でregistryへ反映し、overrideなしで`--strict-final`を再実行する。
- operational registryの初期値は、immutable baselineから次で一度だけ生成する。通常更新ではこのstateを入力にし、同一`record_key`の異なるdecisionは停止する。

  ```bash
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' bootstrap-three-class-state
  python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' promote-three-class \
    --audit 'work/<YYYYMMDD>/three_class/audit_three_class.json' \
    --review-csv 'work/<YYYYMMDD>/three_class/manual_overrides.csv' \
    --p2-review-csv 'work/<YYYYMMDD>/three_class/optional_p2_overrides.csv'
  ```
- 統合検証の標準コマンドは、`--require-resolved`と`--three-class-audit`を必須にする。`summary.final_published == true`、`summary.unresolved_mandatory_reviews == 0`、`validation.all_checks_passed == true`をcandidate handoffの前提とする。
- candidate handoffでは、`--labeling-summary`と`--labeling-validation`を必ず同時指定する。`prompt.txt`をChatGPTへのメッセージとして使い、`handoff_manifest.json`はChatGPTへ渡さず、回答JSONは未編集で保存する。
- candidate workflowの`--publication-root`は、直下に`current/`を持つ公開ルートでなければならない。`package/src/data`がフラットな場合は、既存5公開artifactを`work/<YYYYMMDD>/candidate-publication/current/`へ作業用に複製してからhandoff生成に使い、`package/src/data`を直接公開ルートとして指定しない。
- React UIのgenerated data import境界は`package/src/ui/candidate-data.js`だけに限定する。runtime contractは`package/contracts/`のcanonical pathを使い、active Issue配下のpolicyを参照しない。
- candidate `full-update`は基準公開ルートとは別の新規出力rootへ行う。出力rootの`current`には基準公開のcurrentを参照するsymlinkを先に用意し、`--parent-manifest`で同じ親manifestを渡す。atomic promotion後の`current`をkeyword stagingとする。
- account候補は`npm run account-candidate-workflow`へ今回のthree-class final、summary、canonical account policy、今回生成したkeyword metaを渡す。keyword/accountのdataset SHAが一致しない場合は公開を中止する。

- `npm run publish:joint-data`はkeyword 5 artifact、account 3 artifact、raw、Stage 13、three-classからdata-release.jsonを生成し、検証済み8 artifactを原子的に`package/src/data`へ反映する。通常更新で次のファイルは変更しない。

  ```text
  candidate_registry.json
  candidate_evaluation.json
  filterKeywordCandidates.json
  filterKeywordCandidates.meta.json
  run_manifest.json
  accountBlockCandidates.json
  accountBlockCandidates.meta.json
  accountBlockCandidateRunManifest.json
```

- `npm run verify:release`は`package/public/data-release.json`と公開8 artifactを検証する。raw・Stage 13・作業directory・review CSV・handoff/proposal/intermediate publicationはコミットしない。
- Pages公開が成功し、公開URLのrelease bytesがrepository版と一致した後だけ、次のコマンドでStage 13 private referenceを更新する。releaseまたはSHAが不一致なら既存referenceを変更しない。

  ```bash
  python3 scripts/promote_stage13_reference.py \
    --stage13 'work/<YYYYMMDD>/stage13_labeled.json' \
    --reference 'var/integrated-labeling/stage13_reference.json' \
    --release 'package/public/data-release.json' \
    --destination 'var/integrated-labeling/stage13_reference.json'
  ```

- GitHub Pages初回設定は`.github/workflows/deploy-pages.yml`と`package/vite.config.js`で済んでいる。ViteのPages baseは`/mi-comopt/`、build artifactは`package/dist`、公開URLは`https://unow-dev.github.io/mi-comopt/`。次回以降はUIデータの更新を`main`へpushすればworkflowがbuild/deployする。
- コミット対象は、承認済み公開データ、必要なUI設定、作業記録に限定する。`work/`、raw、ChatGPT handoff、回答CSV、中間publicationはコミットしない。別のactive Issueを内容確認なしにignoreしない。
- 完了判定は、local `validate-current`・`verify:data`・`verify:release`・build成功、GitHub Actionsのvalidation/build/deploy成功、公開URLの`data-release.json` HTTP 200とrepository版bytes一致、Stage 13 reference promotionおよび次回prepare smokeまで行う。
- 今回の実績（2026-08-26）：raw 24,622件、Stage 13人手判定3,190件、3-Class mandatory review 14件、公開candidate 194件、candidate run ID `run_bf8163da-cc49-4549-a42a-f02636d4b97c`。
