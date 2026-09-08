# Final Decisions

この文書は議論で採択された最終判断の索引である。規範は`ISSUE_BODY_CANONICAL.md`。

## 採択

1. **新機能はcomposition layer**
   - Comment DB selection → existing analysis projection → unchanged v1.5 prepare → provenance binding → packaging。
2. **`request_id`と`workset_id`を分離**
   - `request_id`: existing classification transaction identity。
   - `workset_id`: portable transport content identity。
3. **Stage13 referenceは明示指定**
   - `--reference` required。
4. **`--state-dir`はoptional**
   - existing pipeline contractを維持。使用されたstate bytesは既存snapshot/bindingsが拘束する。
5. **snapshot selectorは既存Comment DB semanticsを継承**
   - `--snapshot-ref`とfail-closedなlegacy `--snapshot-sha`の双方を許可。
   - 同じresolved refsなら同一workset。
6. **comment-batch専用gateを追加しない**
   - existing projectionが正常に処理できるsnapshotを対象。
7. **canonical classification packageは`request/`**
   - provenanceは同梱するが、追加classification evidenceには使わない。
8. **workspaceとtransport ZIPを分離**
   - workspace: finalize可能なlocal canonical state。
   - ZIP: ChatGPTへ渡すportable artifact。
9. **existing handoff ZIPを保持**
   - 新wrapperは既存`classification_handoff_<request_id>.zip`を削除しない。
10. **outer stagingによるcommand-level atomicity**
    - 新artifact追加まで成功した後にfinal workspaceへcommit。
11. **zero-handoffでもouter workset ZIPを生成**
    - existing pipelineの`FINALIZED_NO_HANDOFF`を維持。
12. **workset identityはtransport logical membersから計算**
    - ZIP byte SHAそのものをidentityにしない。
13. **DB file全体をidentityにしない**
    - unrelated DB additionsで過去worksetを変えない。
14. **CLI invocation syntaxをidentityにしない**
    - SHA selectorと等価ref selectorは同一workset。
15. **existing pipeline/projectionの意味変更は禁止**
    - 必要になったら設計へ戻る。

## 撤回・却下済み

以下は途中で検討されたが最終仕様ではない。

- existing `request_id`へDB provenanceを混ぜる。
- workspace全体をChatGPT向けZIPへ入れる。
- `request/`だけをZIPにしDB provenanceを外す。
- `comment-batch`だけを新commandで許可する。
- `--snapshot-sha`を新commandで全面禁止する。
- `--state-dir`を必須化する。
- existing `classification_handoff_*.zip`を削除する。
- ZIP containerのSHAを`workset_id`にする。
- wrapper implementation SHAを`workset_id`へ入れる。
- temporary source pathを永続化するため既存snapshot manifest/receiptを書き換える。
- Stage13/Three-ClassロジックをNode側へ移植する。
- DBアクセスをv1.5 Python pipelineへ新規実装する。
- transport READMEへ分類規則を複製する。

## Scope外

- response自動送受信
- resultのDB import
- Stage13 reference管理方式
- registry lifecycle管理
- v1.5 protocol redesign
- zip-only finalize
