# CHANGELOG

## 1.5.0 — 2026-09-06

分類handoffをsingle-roundtrip protocolへ拡張。v1.4の分類意味論、clean artifact schema、P2の任意review契約は変更しない。

- `prepare-single-roundtrip` が入力・reference・registry・config・実装manifestをsnapshotし、Stage13 S-taskとThree-Class potential T-taskを1つのrequestへ束ねる。
- `finalize-single-roundtrip` がstrict duplicate-key JSON、task coverage、active/inactive branch、reason mapping、integrated validationを検証してからaccepted/finalをatomic確定する。
- exact 5-field pending dedupe、exact `record_key` task grouping、zero-human path、golden conflict、same-response retryを追加。
- v1.4 fallback用のStage13 adjudication CSV、prospective golden、P2 snapshotをfinal artifactへ出力し、旧CLIでstrict-final replayできることを確認。
- downstream labeling evidenceは`1.4.0`/`1.5.0`の明示whitelistとsummary/validation version equalityを要求する。
- v1.5の全回帰25群、v1.4の全回帰24群、Node 78テスト、data verification、production buildを確認。
- 人間のcutover判断まではv1.4 recurring defaultを維持する。

## 1.4.0 — 2026-08-24

v1.3.0で保留したP2 8件を境界再評価。

- 「8件すべて強制確定」「7件確定+1件保留」「恒久defer機構追加」を比較し、7件確定+1件保留を採択。
- exact-case P2を7件追加: normal 3 / reactive 1 / direct_nuisance 3。
- P2 registryを345件へ更新: normal 242 / reactive 83 / direct_nuisance 20。
- 「痛いよ！痛い痛い」1件は身体的痛み/cringe評価を文面だけで分離できないため未解決維持。
- 1件のための新規defer状態は導入せず、既存P2 review contractを維持。
- baseline finalを reactive 1,225 / normal 19,659 / direct_nuisance 549へ更新。
- 境界7件と残存1件を固定する回帰テストを追加。

## 1.3.0 — 2026-08-24

P2 346件を高信頼exact-case reviewへ進め、P0/P1 goldenとは別registryで保持。

- `three_class_p2_adjudications.json` を導入。
- P2 338件を確定: normal維持239 / reactive 82 / direct_nuisance 17。
- 曖昧な8件は未解決P2として残し、推測で確定しない。
- P2 registryはP2-only exact recordに限定し、review reason driftをfail-closedで拒否。
- P0/P1 goldenとのregistry key重複を拒否。
- P2 registry keyへのmanual overrideを拒否。
- `--term-only` を追加し、全adjudication無効のdeterministic baselineを再現可能にした。
- baseline finalを reactive 1,224 / normal 19,663 / direct_nuisance 546へ更新。


## 1.2.0 — 2026-08-24

P0/P1の確定結果を、一般化ルールではなくexact-record golden adjudicationとして永続化。

- `three_class_golden_adjudications.json` を導入。
- baseline mandatory review 124行 / 123 unique keyをspec-guided semantic adjudicationで確定。
- golden適用は5 fields + Stage13 label由来の`record_key`完全一致のみ。
- goldenから未知レコードへの語彙・類似度一般化を禁止。
- golden keyへのmanual overrideを拒否し、canonical変更をchange-controlへ集約。
- `--no-golden`でv1.1.0 term-only candidateを再現可能。
- baseline strict finalを公開可能（unresolved P0/P1 = 0）。
- 必須P0/P1用 `manual_overrides.csv` と任意P2用 `optional_p2_overrides.csv` を分離。
- review queueへ解決状態・decision sourceを追加。
- テストを9群から13群へ拡張。
- 旧41+1例外コードの復元ではないことを明記。

## 1.1.0 — 2026-08-24

分類ロジックのbaseline互換性は維持し、運用安全性とlineage検証を強化。

- Stage 13 workspace schema v2導入。
- input SHA-256、各行5-field SHA-256、reference SHA-256でfinalizeを拘束。
- exact reuseをfinalize時にreferenceへ再照合。
- Stage 13 adjudication CSVへ `source_record_sha256` を追加。
- 3分類overrideのunknown/duplicate keyを拒否。
- P0/P1解決とlabel変更overrideに非空noteを必須化。
- `three_class_candidate.json` と final publication gateを導入。
- P0/P1未解決時は `three_class_labeled.json` を公開せず、stale finalも削除。
- config SHA-256を3分類summaryへ記録。
- 回帰/安全性テストを4群から9群へ拡張。

## 1.0.0 — 2026-08-24

Stage 13 と3分類を直列 + 共通監査層で統合。
