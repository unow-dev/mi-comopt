# Production Recovery Runbook

## 目的

現在headが追加分だけを参照しており、旧有効データがcorpusから脱落しているproduction状態を一度だけ復旧する。

通常更新ロジックの修正だけでは既に脱落したデータは戻らないため、本runbookは必須。

## 事前に人間が確定する値

```text
baseCorpusVersionId
```

旧有効データ（例: 24,622件）を保持していた正常なversionを指定する。コードで推測しない。

```text
brokenHeadCorpusVersionId
```

recovery開始時点の壊れたcurrent head。

## recovery identity

`baseCorpusVersionId`と`brokenHeadCorpusVersionId`から決定的な`recoveryId`を作ることを推奨。

同一recoveryIdへ異なる入力を再利用した場合はidempotency conflictで拒否する。

## Procedure

### 1. Freeze

- v3 new startsを停止。
- legacy writerは無効のまま。
- v2 new startsは0。
- recovery inputsを固定。

### 2. Drain

- nonterminal v3 sessionsが0になるまでbootstrapを開始しない。

### 3. Head re-check

```text
current corpus head == brokenHeadCorpusVersionId
```

不一致なら`RECOVERY_HEAD_CHANGED`で停止。freezeは維持。

### 4. Build recovery Corpus v2

対象:

```text
base version ～ broken head
```

順序:

- state versions: version_no ASC
- v1 state内refs: legacy SHA/index order
- v2 state内refs: saved order
- snapshot ref duplicates: first-win unique

### 5. Project cumulative corpus

5-field exact first-win ruleを適用。

### 6. Recover classification

survivor observation IDsを先に固定する。

各survivor:

1. historical exact observation labelの最新version
2. historical same-comment label
3. human classification

ChatGPTへ送る直前にresolved item非混入assertionを行う。

### 7. Build Source Dataset v2

classification exact coverageを検証してから生成。

### 8. Regenerate all downstream artifacts

同じSource Dataset v2から以下を再生成。

- keyword
- account
- overview
- comments

### 9. Build / Review / Promote corrected Release

cross-pin / SHA integrity gateを通す。

### 10. Deploy and verify

- served release ID
- deployed artifact hashes
- source dataset identity

を確認。

### 11. Resume starts

corrected deployment verification成功後だけfreezeを解除。

## Failure behavior

Recovery開始後の失敗時:

- 欠落した旧releaseを「正解」としてrollbackしない。
-現在serve中のreleaseが残っている間はserve継続可。
- new startsはfreeze維持。
- 完了済みimmutable stageを再利用してfix-forward/retry。

## Production validation

今回の具体例では:

```text
expectedCount
= 24,622
+ 11,768
- fiveFieldDuplicateCount
```

この母集団がclassification / keyword / account / overview / commentsで一致することを確認する。
