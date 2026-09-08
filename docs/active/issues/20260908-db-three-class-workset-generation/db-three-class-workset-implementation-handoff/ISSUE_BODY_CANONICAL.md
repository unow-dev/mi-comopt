# Issue: Comment DBから3-class作業セットを直接生成する経路を追加する

## 目的

Comment DBに保存されたコメントデータについて、対象スナップショットを明示的に選択し、既存のStage13 → 3-class single-roundtrip pipelineへ接続して、ChatGPTがそのまま分類作業を開始できるworksetを一度のコマンド実行で生成できるようにする。

生成物では、既存pipelineのclassification requestと、DB由来の順序・重複・出典provenanceを分離せず、一つのportable ZIPとして受け渡せるようにする。

同時に、ローカルには既存v1.5.0の`finalize-single-roundtrip`でそのまま確定処理を継続できるcanonical workspaceを保持する。

## 背景

Comment DBには、`comment-batch`およびrich raw snapshotをスナップショット単位で保持し、`export-analysis-input`によって厳密な5-field JSONとprovenance manifestへ投影する既存経路がある。

一方、3-class分類は、

`docs/active/operations/Integrated_Labeling_Handoff_v1.5.0/src/pipeline.py`

の`prepare-single-roundtrip`がファイル入力を受け取る構成であり、DB snapshot selectionからsingle-roundtrip生成までを直接接続する経路は存在しない。

そのため現在は、DB export、pipeline invocation、作業者向け成果物の整理を手動で接続する必要がある。

## スコープ

新しいComment DB CLI commandを追加し、次を一回の処理として実行する。

1. Comment DBから対象snapshotを明示的に選択する。
2. 既存analysis projectionを用いて5-field JSONとprovenance manifestを生成する。
3. その5-field JSONを変更せず既存v1.5.0 `prepare-single-roundtrip`へ渡す。
4. 既存pipeline workspaceを保持する。
5. classification requestとDB provenanceを一つのworkset ZIPへまとめる。

既存analysis projectionが正常に扱えるsnapshotを対象とし、`comment-batch`専用の新しいmaterialization gateは追加しない。

## 非目標

本issueでは以下を扱わない。

- Stage13またはThree-Classの分類ロジック変更
- Stage13 referenceのライフサイクル管理
- golden/P2 registryの管理方式変更
- ChatGPT responseの自動送受信
- classification resultのComment DBへのimport
- v1.5.0 protocolまたは`request_id`計算方式の変更
- ZIP単体からの`finalize-single-roundtrip`
- 過去workspaceのmigration

## CLI contract

追加するcommandは次とする。

```bash
npm run comment-db -- generate-three-class-workset \
  (--snapshot-ref <sha256:index> ... | --snapshot-sha <sha256> ...) \
  --reference <stage13-reference.json> \
  --workspace <workspace> \
  [--db <comment-db>] \
  [--state-dir <state-dir>]
```

要件:

- `--reference`は必須。
- `--workspace`は必須。
- `--snapshot-ref`または`--snapshot-sha`のどちらか一方を1件以上指定する。
- 両selectorの混在は禁止する。
- duplicate selectorは拒否する。
- `--snapshot-sha`が0 snapshotへ対応する場合はfailする。
- `--snapshot-sha`が複数snapshotへ対応する場合は曖昧選択としてfailする。
- 一意に解決された`--snapshot-sha`と等価な`--snapshot-ref`は同じresolved snapshot selectionとして扱う。
- user-supplied pathの解決規則は既存Comment DB CLIと同じにする。

## Snapshot selection / projection contract

snapshot selection後のanalysis input生成には、既存Comment DBのprojection semanticsをそのまま使用する。

snapshot間の順序は既存仕様どおり、

1. `payload_sha256`昇順
2. `snapshot_index`昇順

とする。

snapshot内では既存`source_index`順を保持する。

重複recordは削除しない。

新経路独自のreordering、deduplication、field normalization、provenance schemaを追加してはならない。

同一selectionに対する、

`export-analysis-input`

のJSON outputおよびmanifestと、新workset内のprovenance filesはbyte-for-byte同一でなければならない。

## Existing pipeline contract

5-field analysis inputは既存v1.5.0の、

`prepare-single-roundtrip`

へそのまま渡す。

Stage13 task生成、Three-Class task生成、reference binding、golden/P2 registry binding、config binding、implementation binding、`request_id`生成は既存pipelineを唯一のsource of truthとする。

Node側へこれらの判定ロジックを再実装してはならない。

既存の以下のcontractを変更しない。

- `request/`構造
- `request_id`
- `classification_handoff_<request_id>.zip`
- snapshot bindings
- `prepare-single-roundtrip`
- `finalize-single-roundtrip`

## Workspace contract

成功時の指定workspaceは、有効な既存v1.5.0 single-roundtrip workspaceでなければならない。

既存pipelineが生成した、

- `request/`
- `snapshot/`
- `prepare_receipt.json`
- `classification_handoff_<request_id>.zip`（human taskが存在する場合）
- zero-handoff時のfinalized artifacts

を削除または意味変更してはならない。

新経路はそのworkspaceへworkset用artifactを追加する。

生成後も既存の、

```bash
python .../pipeline.py finalize-single-roundtrip \
  --workspace <workspace> \
  --response <response.json>
```

を変更なしで利用できなければならない。

## Transport ZIP contract

最終的なportable artifactは、

`three_class_workset_<workset_id>.zip`

とする。

ZIPに含める内容は次だけとする。

```text
README_FIRST.md
workset_manifest.json

provenance/
  analysis_input.json
  analysis_input.manifest.json

request/
  <既存prepare-single-roundtripが生成した全request files>
```

以下はZIPへ含めない。

- `snapshot/`
- Stage13 reference snapshot
- golden/P2 registry snapshot
- config snapshot
- implementation manifest snapshot
- `prepare_receipt.json`
- finalization artifacts
- `classification_handoff_<request_id>.zip`

`request/`はclassificationのcanonical packageである。

`provenance/`はDB lineage、元record順序、重複、出典確認のための情報であり、追加のclassification evidenceとして使用してはならない。

この境界を`README_FIRST.md`で明示する。

## Provenance integrity contract

以下のbytesおよびSHA-256は一致しなければならない。

```text
DB analysis projection output
=
provenance/analysis_input.json
=
pipeline snapshot/input.json
```

さらに、

```text
SHA256(DB analysis projection output)
=
analysis_input.manifest.json.output_sha256
=
request/manifest.json.bindings.input_sha256
```

でなければならない。

一致しない場合はworksetを生成せずfailする。

## Workset identity contract

既存`request_id`の意味は変更しない。

`request_id`は既存single-roundtrip classification transactionのidentityである。

これとは別に、portable worksetのidentityとして`workset_id`を導入する。

`workset_manifest.json`自身を除くtransport対象の全regular fileについて、

- relative POSIX path
- SHA-256
- byte length

をpath昇順で列挙する。

`workset_id`は以下を含むcanonical JSON preimageのSHA-256として決定する。

- workset schema version
- workset protocol version
- `request_id`
- 上記member list

したがって、同じ`workset_id`は同じlogical transport member bytesを意味する。

ZIP containerそのもののSHA-256はworkset identityには使用しない。

CLI selectorの表記方法やtemporary workspace pathはidentityへ含めない。

## Reproducibility contract

「同じDB状態」とはDBファイル全体の同一性を意味しない。

再現性の対象は、同じresolved snapshot集合と、既存pipelineが拘束する同一semantic dependenciesである。

無関係なsnapshotが後からDBへ追加されても、明示選択されたsnapshotとsemantic dependenciesが同じならworksetは変化してはならない。

Stage13 reference、golden/P2 registries、relevant config、pipeline implementation等が変化し、それによって既存request packageが変わる場合は異なるworksetになることが正しい。

## Zero-handoff behavior

既存pipelineがhuman decision 0件と判定した場合も、workset ZIPは生成する。

この場合、既存pipelineの`FINALIZED_NO_HANDOFF` behaviorを変更しない。

`request/`にStage13またはThree-Classのtask JSONが存在しない場合、ChatGPT classification responseは不要であることを`README_FIRST.md`で明示する。

## Atomicity / failure contract

新commandはfail-closedでなければならない。

指定された最終workspaceは、DB projection、existing pipeline preparation、integrity checks、workset packagingのすべてが成功した場合にのみ出現する。

途中で失敗した場合、指定された最終workspaceを部分生成状態で残してはならない。

既存workspaceへの上書きは禁止する。

既存pipelineが生成したartifactを後処理で書き換えて整合させる設計は禁止する。

## Implementation boundaries

既存Comment DBのsnapshot selector resolutionは、`export-analysis-input`と新commandで同じ意味論を共有する。

snapshot selection logicを新command側へコピーして別実装にしてはならない。

新しいorchestration層は、

```text
Comment DB snapshot selection
→ existing analysis projection
→ unchanged v1.5.0 prepare-single-roundtrip
→ provenance binding
→ workset packaging
```

だけを担当する。

v1.5.0 pipelineまたはanalysis projectionの機能変更が必要であることが判明した場合は、実装者判断でcontractを変更せず、本issueの設計議論へ戻す。

## Acceptance criteria

以下を満たすこと。

1. 同じresolved snapshot集合は、selector指定順を変えても同じlogical worksetになる。
2. 一意な`--snapshot-sha`と等価な`--snapshot-ref`は同じworksetになる。
3. 同じselection後に無関係なDB snapshotを追加してもworksetは変化しない。
4. snapshot内のsource orderおよびduplicate recordsが維持される。
5. `export-analysis-input`のJSON/manifestとworkset provenanceがbyte-for-byte一致する。
6. workset provenance inputとpipeline `snapshot/input.json`がbyte-for-byte一致する。
7. 同一5-field inputでもDB provenanceが異なる場合、既存`request_id`が同一でも`workset_id`は異なる。
8. transport ZIPには規定されたmember以外を含めない。
9. workset manifestがtransport対象の全regular memberをSHA-256とbyte lengthで拘束する。
10. human decision 0件の場合もworkset ZIPを生成し、classification responseを要求しない。
11. human decisionが存在する場合、既存`classification_handoff_<request_id>.zip`を保持する。
12. 生成されたworkspaceを既存`finalize-single-roundtrip`で変更なしに利用できる。
13. snapshot selection、pipeline preparation、integrity verification、packagingのいずれかが失敗した場合、指定された最終workspaceを残さない。
14. 既存Comment DB export testsおよびv1.5.0 single-roundtrip testsをregressionさせない。

## 完了条件

このissueは、Comment DBの明示snapshot selectionから、既存single-roundtrip requestとDB provenanceを結合したportable workset ZIPを一回のcommandで生成でき、かつ生成されたlocal workspaceが既存v1.5.0 finalize contractを維持していることが自動テストで確認された時点で完了とする。
