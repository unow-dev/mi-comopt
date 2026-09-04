# Account Generator Provenance Compatibility Exception

## 結論

このissueでは `scripts/account-block-candidate-workflow.mjs` を1 byteも変更しない。

そのため、account実装をProcessingへ移した後も旧pathをre-export shimとして残す。

```text
src/lib/account-block-candidate-workflow.js
```

```js
export * from "../processing/account-block-candidates/account-block-candidate-workflow.js";
```

## 根拠

Supplied snapshotのaccount run manifest:

```text
src/data/accountBlockCandidateRunManifest.json
```

には:

```text
generator.content_sha256 = sha256:3dcf60dc1b4a6ba89a709fb02edb6d2439bacbb2c94248078bf944b2ce8fccc9
```

が記録されている。

実際の:

```text
scripts/account-block-candidate-workflow.mjs
```

のSHA-256も:

```text
3dcf60dc1b4a6ba89a709fb02edb6d2439bacbb2c94248078bf944b2ce8fccc9
```

で一致する。

さらに `scripts/verify-data.mjs` は現在checkoutされている同scriptのbytesを読み、`validateArtifactBindings(..., generatorBytes)` へ渡している。

したがってimport行1行の変更でもgenerator SHAが変わり、committed historical artifactと `verify:data` の契約へ波及する。

## 比較して不採択にした案

### Historical artifactを新SHAへ更新

不採択。過去runのgenerator provenanceを書き換えることになり、元入力一式がsupplied setに揃っている保証もない。

### `verify:data` からcurrent generator比較を削除

設計上の改善余地はあるが、integrity/provenance契約の変更であり今回のarchitecture issueに混ぜない。

### account scriptのimportだけ新pathへ変更

不採択。script bytesが変わるため上記契約を壊す。

### symlinkで旧pathを維持

不採択。Git/Windows/zip展開等のportable性で通常ファイルより劣る。

## 採択案

- 実装本体は `src/processing/account-block-candidates/` へ移す。
- 旧pathは通常ファイルのre-export shimだけ残す。
- account CLIとverify-dataのimport文は変更しない。
- account CLIのmanifest/meta/publication orchestrationは今回移動しない。

## shim削除条件

別issueでaccount generator identity/provenanceを、entrypoint script単体SHAへの強い結合から再設計した後に削除する。

そのissueで初めて:

- account CLI importを新Processing pathへ変更
- shim削除
- 必要ならgenerator source identityの再定義

を行う。
