# 添付snapshotのbaseline notes

このhandoffには元の議論セットを`reference/discussion_set/`として同梱している。ただしこれは**実リポジトリの完全cloneではない**。

## 確認済みsnapshot facts

### データ件数

- `filterKeywordCandidates.json`: 86件
- `accountBlockCandidates.json`: 54件
- NEW表示日数: 14
- label summary total: 24,622
  - direct_nuisance: 731
  - reactive: 1,339
  - normal: 22,552

### visual referenceと一致する先頭データ

Keyword先頭4件:

1. `わからせ`
2. `ちょっと待ってほしい`
3. `唐揚げだけは`
4. `かわいいなー俺もこういう子と付き合いたかったな`

Account先頭5件:

1. `madoloid` — 31件
2. `masayume0619` — 12件
3. `user57010900204392` — 9件
4. `user8811361111815` — 8件
5. `user3466237973467` — 6件

5番目accountのevidenceには非常に長いコメントがあり、long-content layout確認に利用できる。

## snapshot内 `npm test`

handoff作成時に元snapshotで実行した結果:

- 14 tests
- 11 pass
- 3 fail

失敗3件は`tests/architecture-boundaries.test.js`が要求する以下が議論セットの収録方針により存在しないため。

- `src/lib/account-block-candidate-workflow.js`
- `src/processing/`
- `src/database/`

これは実リポジトリの既知のfailureを意味しない。**実装完了時は完全な実リポジトリで`npm test`全成功を要求する。**

## snapshot内 `npm run build`

`node_modules`を同梱していないため、snapshot単体では`vite: not found`となりビルド検証不能だった。

実装完了時は実リポジトリで依存install済み環境から`npm run build`成功を確認する。

## architecture boundary

`tests/architecture-boundaries.test.js`は、generated JSONをUI層から直接乱用しないことを検証している。新Appは引き続き`candidate-data.js` / adapter経由でデータを読む。theme変更を理由にJSONを`App.jsx`から直接importしない。
