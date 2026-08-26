# Test Matrix

## Test philosophy

巨大なproduction snapshotをunit fixtureにしない。仕様分岐を1つずつ証明できる**最小合成fixture**を使用する。

Fixture `summary.json` の `final_output_sha256` は、テスト内でfixture datasetの実bytesから計算する。固定ダミーSHAでhash gateを迂回しない。

## Core fixtures

| ID | Input | Expected |
|---|---|---|
| F01 | handle A / distinct direct event 1件 | candidateなし |
| F02 | handle A / distinct direct event 2件 | Aをcandidate化、count=2、sample=2 |
| F03 | handle A / distinct direct event 4件 | count=4、sample=2 |
| F04 | usernameだけ異なる同一behavior event・同label | 1 eventへcollapse |
| F05 | 同一behavior event・異なるlabel | fail |
| F06 | handle/comment/postedDate同一、postedAtのみ異なる | 2 distinct events |
| F07 | handle/comment/postedAt同一、postedDateのみ異なる | 2 distinct events |
| F08 | 同内容/日時でもhandleが異なる | 別account |
| F09 | direct_nuisance + blank/whitespace handle | fail |
| F10 | reactive/normalのみ | candidateなし |
| F11 | 同datasetのrow順だけshuffle | candidate JSON byte-identical |
| F12 | `final_published=false` | fail |
| F13 | upstream final SHA mismatch | fail |
| F14 | unknown label | fail |
| F15 | required field不足 | fail |
| F16 | malformed JSON | fail |
| F17 | candidate 0件 | 正式 `[]` をpublish可能 |
| F18 | candidate content SHAをtamper | `verify:data` fail |
| F19 | manifest content SHAをtamper | `verify:data` fail |
| F20 | keyword/account dataset SHA mismatch | workflow/verify fail |
| F21 | policy `evidence_sample_size > minimum_behavior_events` | fail |
| F22 | direct 5件のfingerprint順をfixtureで固定 | sampleがfingerprint ASC先頭2件 |
| F23 | count同数の複数candidate | handle fingerprint ASCで決定的sort |

## Required assertions

### Behavior events

- `username`差分だけではevent数を増やさない。
- `postedAt` または `postedDate` のexact差分は別eventになる。
- same event / same labelの重複rowをcountへ二重算入しない。
- same event / label conflictは推測解決しない。

### Candidate semantics

- `direct_nuisance_count` はcollapse後のdistinct direct event総数。
- candidate conditionはpolicy `minimum_behavior_events` のみ。
- `reactive` / `normal` はcandidate集合に影響しない。
- evidence sampleは2件でもcountは全件数を保持する。

### Determinism

同じdataset content / policy contentに対して:

- candidate orderingが同じ
- evidence sampleが同じ
- `accountBlockCandidates.json` bytesが同じ

Run manifest/metaはrun ID / timestampがあるためbyte-identicalである必要はない。

## Publication / provenance tests

`verify:data` で最低限確認:

- 3 account JSONのparse
- candidate schema
- candidate hash ↔ meta
- manifest hash ↔ meta
- candidate hash ↔ manifest artifact entry
- run ID一致
- published_at一致
- dataset SHA一致
- policy version/hash一致
- `statistics.candidate_count == candidates.length`
- `statistics.collapsed_source_rows >= 0`
- keyword/account dataset SHA一致

## UI manual acceptance

MVPでは新しいDOM test framework導入を必須にしない。Close前に次を手動確認する。

1. 初期画面は従来のフィルターキーワードview。
2. `アカウント` viewへ切替可能。
3. account cardの根拠を開閉できる。
4. `コピー` がraw handleをそのままclipboardへ入れる。
5. account viewでkeyword recommendation tabsが表示されない。
6. candidate 0件時のaccount固有empty stateが表示される。
7. account viewに「高推奨」「危険度」「NEW」等が混入していない。

## CI close gate

```bash
npm test
npm run verify:data
npm run build
```

すべて成功を必須とする。
