# File Change Map

## Move

| Current | Target | Notes |
|---|---|---|
| `src/lib/candidate-workflow.js` | `src/processing/keyword-candidates/candidate-workflow.js` | NEW判定のみUIへ寄せる。それ以外は挙動維持。 |
| `src/lib/update-flow.js` | `src/processing/keyword-candidates/update-flow.js` | import更新のみを基本とする。 |
| `src/lib/artifact-validation.js` | `src/processing/keyword-candidates/artifact-validation.js` | shared errorを利用。 |
| `src/lib/account-block-candidate-workflow.js` | `src/processing/account-block-candidates/account-block-candidate-workflow.js` | 元pathにはre-export shimを残す。 |
| `src/lib/comment-database.js` | `src/database/comment-database.js` | API再設計なし。 |
| `src/lib/new-badge.js` | `src/ui/new-badge.js` | UI版を正とする。 |
| `src/lib/publication.js` | `scripts/adapters/keyword-publication.js` | filesystem boundary。 |
| `src/App.jsx` | `src/ui/App.jsx` | raw artifact schema参照をUI modelへ置換。 |
| `src/styles.css` | `src/ui/styles.css` | `main.jsx` import更新。 |

## Add

| File | Purpose |
|---|---|
| `src/processing/shared/workflow-validation-error.js` | keyword/account共通validation error |
| `src/processing/keyword-candidates/handoff-workflow.js` | handoffの意味処理 |
| `src/ui/candidate-data.js` | generated JSON import boundary |
| `src/ui/candidate-data-adapter.js` | artifact -> UI model変換 |
| `tests/new-badge.test.js` | NEW判定のUI ownership |
| `tests/candidate-data-adapter.test.js` | UI model変換契約 |
| `tests/architecture-boundaries.test.js` | 依存境界の回帰防止 |
| `ARCHITECTURE.md` | architecture決定の正文 |

## Keep as compatibility shim

`src/lib/account-block-candidate-workflow.js`

```js
export * from "../processing/account-block-candidates/account-block-candidate-workflow.js";
```

この1ファイル以外の `src/lib/*` は残さない。

## Must remain byte-for-byte unchanged

- `scripts/account-block-candidate-workflow.mjs`

実装前後でSHA-256を比較すること。

Supplied snapshot SHA-256:

```text
3dcf60dc1b4a6ba89a709fb02edb6d2439bacbb2c94248078bf944b2ce8fccc9
```

## Import updates

### scripts

- `scripts/candidate-workflow.mjs`
  - candidate workflow -> `src/processing/keyword-candidates/candidate-workflow.js`
  - update flow -> `src/processing/keyword-candidates/update-flow.js`
  - artifact validation -> `src/processing/keyword-candidates/artifact-validation.js`
  - publication -> `scripts/adapters/keyword-publication.js`
  - handoff semantic logic -> `src/processing/keyword-candidates/handoff-workflow.js`
- `scripts/comment-database.mjs`
  - Comment DB -> `src/database/comment-database.js`
- `scripts/account-block-candidate-workflow.mjs`
  - **変更しない**。旧 `../src/lib/account-block-candidate-workflow.js` を維持。
- `scripts/verify-data.mjs`
  - **今回変更しない**。旧shim経由を維持。

### tests

- `tests/candidate-workflow.test.js` -> new keyword processing paths
- `tests/full-update.test.js` -> new keyword processing paths
- `tests/publication.test.js` -> `scripts/adapters/keyword-publication.js`
- `tests/handoff.test.js` -> publication new path; handoff pure testsを追加可
- `tests/comment-database.test.js` -> `src/database/comment-database.js`
- `tests/account-block-candidate-workflow.test.js` -> 実装本体を直接検証するためnew processing pathへ変更
- NEW判定5境界ケース -> `tests/new-badge.test.js`

## Delete from candidate processing

- `DEFAULT_NEW_KEYWORD_DISPLAY_DAYS`
- `isNewCandidate()`

この2つは `src/ui/new-badge.js` のみを正とする。
