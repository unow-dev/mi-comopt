# Baseline

## Source snapshot

`inputs/source_snapshot.zip` を基準に確認。

## `npm test`

確認結果:

- total: 14
- pass: 11
- fail: 3

既知failure:

1. `src/lib contains only the account compatibility shim`
   - snapshot内の `src/lib` 内容がtest期待と一致しない。
2. `processing does not import outer layers or cross feature modules`
   - `src/processing` がsnapshotに存在せず `ENOENT`。
3. `database and processing do not import collector-specific modules`
   - `src/database` がsnapshotに存在せず `ENOENT`。

生ログは `baseline-npm-test.txt` を参照。

## `npm run build`

このhandoff生成環境のsource snapshotには `node_modules` / `package-lock.json` がなく、依存未install状態では `vite: not found` となる。

したがってbuild成功はbaseline実績としてではなく、実装後の必須acceptanceとして扱う。まず依存をinstallし、lockfileを生成してから判定する。
