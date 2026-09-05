# Decision Log — 最終採択だけ

## 採択

1. rawはdeltaではなくauthoritative full snapshot。
2. 5-field重複を自動dedupしない。
3. Collector実装はout of scope。
4. Stage13 bootstrapはverified legacy outputがなければimmutable baseline。
5. Stage13 2回目以降はprevious successful published run outputをreferenceにする。
6. Stage13 referenceはprivate `var/` state。
7. prepare/finalize/validateでsame Stage13 referenceを明示。
8. 3-Class reviewed exact decisionsをoperational registryへpromotion。
9. immutable baseline registryとoperational registryを分離。
10. operational registryはminimal canonical form、record_key sort。
11. review CSVは`record_key,label,reason_code,note`。
12. free-text noteをpublic registry rationaleへ直接コピーしない。
13. keywordとaccountはsame three-class SHA。
14. accountは今回生成したkeyword metaにbind。
15. public data updateは8artifact exact set。
16. keyword `parent_manifest_content_sha256`を実parentへ接続。
17. runtime contractsを`package/contracts/`へ移設。
18. `package/public/data-release.json`を公開release identityにする。
19. CIでtests + verify:release + build。
20. Pages deploy後`data-release.json` byte一致確認。
21. deploy成功後だけStage13 reference promotion。

## 棄却 / defer

1. delta rawをそのまま候補評価へ渡す。
2. 5-field dedup merge。
3. raw corpusのstrict append-only強制。
4. Stage13 SHA->labelだけのstateでfull referenceを置き換える。
5. full Stage13 operational referenceをGit commit。
6. 大規模private release archive。
7. release ID state machine。
8. correction release framework。
9. 3-Class correction/retirement。
10. byte-exact full replay。
11. deployment-manifest。
12. historical release directory database。
13. generic provenance graph。
14. PR classifier framework。
15. candidate change-set identity sealing framework。
16. disaster recovery/retention infrastructure。
17. account generator schemaへ新Git revision field追加。
18. keyword/account published_atを同一時刻に強制。
19. account evidence schema変更。
20. Comment DBをStage13 state storeとして流用。

## 理由

issueの目的は正常な継続更新経路を閉じることであり、完全なrelease-management/DR基盤を新設することではない。既存contractを最大限維持し、次回更新で実際に欠けているcontinuity・joint publication・CI gateへ変更面積を集中させる。
