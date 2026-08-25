# Baseline Test State of the Provided Discussion Snapshot

このhandoff作成時に、元のdiscussion ZIPをそのまま展開した状態で実測した結果です。

## Integrated Labeling

Command:

```text
python tests/run_all_tests.py
```

Result:

```text
exit 0
ALL OK: 20 test groups
```

したがって、今回の変更後も新規failure 0を要求してください。

## Candidate package

Command:

```text
npm test
```

Result:

```text
14 tests
13 pass
1 fail
```

失敗は既知のpackaging deficiencyです。

```text
bootstrap preserves 187 identities and canonicalizes only structure
ENOENT:
.../candidate_keyword_update_handoff_v1.0.0/reference/legacy_filterKeywordCandidates.json
```

discussion ZIPに当該reference fixtureが含まれていません。

### 実装時の扱い

- authoritative repositoryにfixtureが存在する場合は通常どおり全test greenを要求。
- このdiscussion snapshotだけで評価する場合、上記ENOENT 1件をbaseline failureとして扱い、新しいfailureが増えていないことを確認。
- fixtureを推測生成しない。
- test/bootstrap validationを弱めてgreen化しない。

生ログは `reference/baseline_logs/` に同梱しています。
