# Candidate keyword manual ChatGPT handoff — implementation handoff (MVP v1)

## Status

このbundleは、`ChatGPT手動投入による候補キーワード提案生成` Issueを実装作業者へ引き渡すための **MVP実装仕様** です。

設計判断は閉じています。実装者が再設計する必要はありません。主仕様は `IMPLEMENTATION_SPEC.md`、テスト契約は `ACCEPTANCE_TESTS.md` を正本として扱ってください。

## MVP goal

既存のdeterministic candidate workflowに、次の手動境界だけを追加します。

```text
immutable current publication
        ↓
prepare-handoff
        ↓
ChatGPT-facing 10ファイル（prompt sourceを含む） + local integrity manifest
        ↓
manual ChatGPT
        ↓
candidate_proposal.json (JSON only)
        ↓
existing full-update
        ↓
deterministic validation / canonicalization / evaluation / publication
```

ChatGPT API連携、model記録、privacy/anonymization、raw response履歴、retry管理等はMVP対象外です。

## Read order

1. `IMPLEMENTATION_SPEC.md`
2. `PATCH_MAP.md`
3. `ACCEPTANCE_TESTS.md`
4. `DECISIONS_AND_NON_GOALS.md`
5. `KNOWN_BASELINE_ISSUE.md`
6. `contracts/candidate-handoff/v1/`

`reference/source_snapshot/` は今回のdiscussion bundleから抜き出した参照用snapshotです。実装先repositoryの現物が異なる場合は、現物を優先しつつ、本handoffの契約を満たすよう適用してください。

## Critical constraints

- `request.source_dataset.artifact_sha256` は **upstream publication artifact identity**。handoff内 `source_dataset.json` のbyte hashではない。
- handoff実ファイルのbyte integrityは新規 `handoff_manifest.json` で別管理する。
- `canonicalize-proposal` はmanual production procedureに挟まない。`full-update` 内でadd candidate IDを1回だけ発行する。
- core schema (`candidate-generation-request`, `candidate-proposal`, `candidate-change-set`) の意味は変更しない。
- current publicationは処理開始時にsymlink targetを1回だけresolveし、そのimmutable directoryから読む。
- `--outdir` はexclusive create。既存directoryを上書き・削除しない。

