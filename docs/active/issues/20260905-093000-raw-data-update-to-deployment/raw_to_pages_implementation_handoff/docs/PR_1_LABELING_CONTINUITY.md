# PR 1 — Stage 13継続reference + 3-Class decision promotion

## 目的

ラベリングの人手判断を次回runへ正しく継続する。

## 変更対象

主対象:

- `docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py`
- 新規または既存のoperations helper（実装者の配置裁量可）
- `docs/active/operations/integrated-labeling-state/`
- Integrated Labeling tests
- `.gitignore`
- 3-Class review templates / runbook

### pipeline.pyで必須の最小変更

1. `validate_raw_records()`で5 field値をJSON string必須化。
2. 既存分類ロジック、Stage 13 exact reuse意味論は変更しない。
3. 必要に応じてreview template生成を4列
   `record_key,label,reason_code,note`
   へ拡張してよい。
4. `load_three_overrides()`の既存3 required columns互換は壊さない。

## Stage 13 standard state

private:
`var/integrated-labeling/stage13_reference.json`

bootstrap時:
- 検証済みlegacy Stage13がないならimmutable baselineを使用。

継続時:
- private referenceが存在しない場合は「何となくbaselineへ戻る」のではなく、operatorへ明示して停止する。
- bootstrapと通常updateを区別できるrunbookにする。

## Stage 13 standard invocation

3コマンド全部でsame reference:

```bash
python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' prepare-stage13 \
  'work/<run>/current_raw.json' \
  --reference 'var/integrated-labeling/stage13_reference.json' \
  --outdir 'work/<run>/stage13'
```

```bash
python3 'docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/src/pipeline.py' finalize-stage13 \
  'work/<run>/current_raw.json' \
  --workspace 'work/<run>/stage13' \
  --adjudications-dir 'work/<run>/chatgpt-stage13' \
  --reference 'var/integrated-labeling/stage13_reference.json' \
  --output 'work/<run>/stage13_labeled.json' \
  --audit 'work/<run>/audit_stage13.json'
```

最終validateでも同じ`--reference`を明示。

## Operational 3-Class registry bootstrap

baseline:
- `reference/three_class_golden_adjudications.json`
- `reference/three_class_p2_adjudications.json`

からrequired decision fieldsだけを抽出し、次を初期commitする。

- `docs/active/operations/integrated-labeling-state/three_class_golden_adjudications.json`
- `docs/active/operations/integrated-labeling-state/three_class_p2_adjudications.json`

top-levelは最小:
- `schema_version: 1`
- `registry_version: "operational"`
- `decision_count`
- `decisions`

## Promotion command

推奨subcommand名:
`promote-three-class`

必要入力:
- `audit_three_class.json`
- mandatory review CSV
- optional P2 review CSV（存在時）
- current operational golden registry
- current operational P2 registry
- output paths

必須検証:
- CSV keyがcurrent auditに存在する
- review対象である
- label有効
- reason_code有効
- reason_codeとlabel整合
- note non-empty
- golden/P2 promotion先をauditから機械決定
- existing same key / same decisionはidempotent no-op可
- existing same key / different decisionはfail
- output golden/P2 overlap禁止
- output decisionsはrecord_key昇順

public registryのrationaleはreason_codeから定型生成し、free-text noteをコピーしない。

## 標準3-Class run

first pass:
operational golden/P2を明示。

人間review:
4-column CSVを完成。

promotion:
operational registriesを更新。

strict final:
`--overrides`なしで、新しいoperational registriesを明示して再実行。

必須:
- `summary.final_published == true`
- `summary.unresolved_mandatory_reviews == 0`

## Stage13 reference promotion helper

PR1で用意してもPR2/3で用意してもよいが、production bootstrapまでには必須。

入力:
- 今回の`stage13_labeled.json`
- `package/public/data-release.json`
- destination

source SHAとrelease recordのStage13 SHAが一致した場合のみatomic replace。

## テスト

最低限:

1. 5 fieldのnumber/null/object/arrayをrawとして拒否。
2. 既存22 test groupsがgreen。
3. run1で人手判定したStage13 outputをrun2 referenceにするとexact reuseされる。
4. `validate --reference`を同じreferenceで実行するとpass。
5. 4-column override CSVを既存loaderが受理。
6. P1 review -> golden promotion -> overrideなしstrict finalで解決。
7. invalid reason_code/label mappingをreject。
8. auditにないrecord_keyをreject。
9. non-P2 reasonをP2 registryへpromotionできない。
10. existing decisionの異なる上書きをreject。
11. operational registry outputがrecord_key sortで安定。

## PR 1 DoD

- 既存分類結果をbaseline fixtures上で変更しない。
- 継続referenceとregistry promotionのテストがgreen。
- operational state初期ファイルがcommit済み。
- raw/Stage13 private stateはGitへ入らない。
