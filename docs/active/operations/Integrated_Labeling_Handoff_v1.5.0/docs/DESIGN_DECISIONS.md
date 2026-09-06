# Design Decisions — 統合分岐評価

## 1. 基本アーキテクチャ

評価軸: 既存Stage 13再現性 35%、3分類互換性 25%、誤判定リスク 20%、監査可能性 10%、運用容易性 10%。5点満点。

| 案 | 概要 | Stage13 | 3Class | 誤判定 | 監査 | 運用 | 加重点 |
|---|---|---:|---:|---:|---:|---:|---:|
| A | 単一3分類器へ完全融合 | 2 | 2 | 2 | 3 | 5 | 2.45 |
| B | 単純直列、監査は各工程別 | 5 | 5 | 4 | 3 | 3 | 4.40 |
| C | 直列 + 共通監査層 | 5 | 5 | 5 | 5 | 4 | **4.90** |

**採択: C**

Stage 13 と3分類は直列接続し、意味判定に使える情報の境界を工程単位で固定する。

Stage 13で使用可能: `comment`、同一handle履歴、反復確認補助としての`postedDate`、参照確定ラベル、golden examples。

3分類の意味判定で使用: `comment`、上流Stage 13 label。

3分類で意味判定に使用禁止: `username`、`handle`、`postedAt`、`postedDate`、過去コメント履歴。

## 2. 出力スキーマ

### 案1: final JSONへ監査フィールドを混入

却下。Stage 13の「既存5フィールド + labelのみ」という契約を壊す。

### 案2: clean output + audit sidecar

**採択。**

- `stage13_labeled.json`: 5 fields + `label`
- `three_class_labeled.json`: 5 fields + `label`（publication gate通過時のみ）
- `audit_*.json`: 内部監査情報

## 3. Stage 13新規レコードの自動化

キーワード規則だけで自動確定する案は却下。Stage 13仕様自体がキーワード判定を禁止し、handle反復・引用・対象人物・羞恥機能など意味判断が必要なため。

**採択:** exact 5-field match のみ自動継承し、新規/変更分は明示adjudicationを要求する。

## 4. handle文脈

pending handleごとに current input 全コメントと prior reference 全コメントを `stage13_handle_context.json` にまとめる。3分類には渡さない。

## 5. v1.1.0: Stage 13 workspace拘束

問題: v1.0.0はprepare後に別入力をfinalizeへ渡した場合、行番号が一致すると誤ラベル組立が成立し得た。

候補:

| 案 | 方式 | 入力差替え検知 | 行入替え検知 | custom reference保全 | 運用 |
|---|---|---:|---:|---:|---:|
| W1 | source indexのみ | 1 | 1 | 2 | 5 |
| W2 | 行fingerprintのみ | 3 | 5 | 2 | 4 |
| W3 | input SHA + 行SHA + reference SHA再照合 | **5** | **5** | **5** | 4 |

**採択: W3。**

- workspaceへprepare時input SHA-256を保存。
- reuse/pending/adjudicationへ各行の5-field SHA-256を保存。
- finalize時にinput SHA、行SHA、coverageを検証。
- exact reuseはprepare時と同一SHAのreferenceへ再照合。

目的は悪意ある改ざん対策ではなく、古いCSV・別run workspace・並び替え済み入力などの事故をfail-closedにすること。

## 6. v1.1.0: 3分類final公開方式

問題: v1.0.0は `--strict-final` が失敗しても `three_class_labeled.json` を先に書き出したため、失敗runの成果物がfinal名で残った。

候補:

| 案 | 方式 | 誤利用耐性 | 互換性 | 明瞭性 |
|---|---|---:|---:|---:|
| P1 | final名で書いて終了コードだけ失敗 | 1 | 5 | 2 |
| P2 | status sidecarだけ追加 | 3 | 5 | 3 |
| P3 | candidate常時、P0/P1=0の時だけfinal公開 | **5** | 4 | **5** |

**採択: P3。**

`three_class_candidate.json` はレビュー途中の利用を許す監査対象。`three_class_labeled.json` はP0/P1全解決時だけ存在する。未解決runでは同じoutdirに残る古いfinalも削除する。

## 7. v1.1.0: override解決条件

候補:

- O1: labelが入っていれば空noteでも解決扱い。
- O2: provisionalから変更したときだけnote必須。
- O3: **P0/P1はlabelを維持する場合もnote必須。変更overrideもnote必須。unknown/duplicate keyは拒否。**

**採択: O3。**

P0/P1は「人間/LLMが判断した」という監査証跡が必要であり、空欄テンプレートの機械的埋め込みで解決扱いになる設計は不適切。

## 8. 既知ギャップ

基準データ上、復元済み42語だけのdeterministic適用は報告済み旧3分類件数と42件ずれる。失われた例外コードを推測して埋めない。P0/P1 review + explicit overrideで確定する。

## 9. v1.2.0: P0/P1確定資産の保持方式

評価軸: 誤判定波及リスク 35%、再現性 25%、監査可能性 20%、保守性 10%、運用負荷 10%。5点満点。

| 案 | 方式 | 波及抑制 | 再現 | 監査 | 保守 | 運用 | 加重点 |
|---|---|---:|---:|---:|---:|---:|---:|
| G1 | 124件から自動ルールを追加 | 1 | 5 | 3 | 2 | 5 | 2.80 |
| G2 | run単位override CSVを固定保存 | 5 | 3 | 3 | 2 | 3 | 3.60 |
| G3 | versioned exact-record golden registry | **5** | **5** | **5** | **5** | 4 | **4.90** |

**採択: G3。**

`record_key` は5フィールド + Stage13 labelを含むため、golden decisionは完全一致レコードだけに適用する。類似文、同一handle、同じcommentだけの一致には拡張しない。

baseline P0/P1 124行は123 unique keyとして現行仕様に沿って明示adjudicationした。これは過去の失われた41+1例外ロジックの復元ではない。

### precedence

1. deterministic provisional rule
2. exact-record golden adjudication（存在する場合）
3. manual override（goldenでないkeyのみ）
4. publication gate

run単位overrideでgoldenを上書きする案は却下。canonical decisionが一時CSVで静かに変わるため。golden変更はregistry versionとchange logを更新する。


## 10. v1.3.0: P2確定方式

P2 346件はすべて `Stage13=normal` かつ direct cue hit であり、単純な文字列誤検出、neutral/positive context、reactive context、本当のdirect nuisanceが混在した。

評価軸: 誤確定リスク 35%、層の責務分離 25%、再現性 20%、監査可能性 10%、運用負荷 10%。

| 案 | 方式 | 誤確定抑制 | 責務分離 | 再現 | 監査 | 運用 | 加重点 |
|---|---|---:|---:|---:|---:|---:|---:|
| Q1 | 346件を一律golden化 | 2 | 2 | 5 | 4 | 5 | 3.15 |
| Q2 | 高信頼だけexact-case確定、曖昧は残す | **5** | **5** | **5** | **5** | 4 | **4.90** |
| Q3 | P2を監査のみで永久に残す | 5 | 5 | 2 | 3 | 1 | 3.65 |

**採択: Q2。**

P0/P1のcanonical boundary decisionsとP2監査結果を同じregistryへ混ぜず、`three_class_p2_adjudications.json` を分離する。P2 decisionはexact `record_key`かつreview reasonsが `source_normal_direct_cue` のみである場合に限り適用する。将来のcue/policy変更でP1等へ昇格した場合は自動適用せずエラーにする。

baselineの346件を全件確認した結果、高信頼338件を確定し8件を保留した。高信頼338件の内訳は normal維持239、reactive 82、direct_nuisance 17。保留8件は、短文・混在評価・引用/自己評価の境界が文面だけでは一意に決めにくいもの。

### v1.3.0 precedence

1. deterministic provisional rule
2. P0/P1 exact golden adjudication（該当時）
3. P2 exact adjudication（P2-only key該当時）
4. manual override（registry非該当keyのみ）
5. publication gate

P0/P1 goldenとP2 registryのkey重複はエラー。run単位overrideでregistry判断を上書きすることも禁止する。


## 11. v1.4.0: 残存P2 8件の処理

評価軸: 誤確定抑制 40%、仕様の単純性 25%、監査可能性 20%、反復運用負荷 15%。

| 案 | 方式 | 誤確定抑制 | 単純性 | 監査 | 運用 | 加重点 |
|---|---|---:|---:|---:|---:|---:|
| R1 | 8件すべてexact labelを強制確定 | 2 | 5 | 4 | 5 | 3.55 |
| R2 | 7件だけ確定し、1件を既存P2未解決として残す | **5** | **5** | **5** | 4 | **4.85** |
| R3 | 7件確定 + 1件専用の恒久defer状態を実装 | 5 | 2 | 5 | 5 | 4.25 |

**採択: R2。**

確定した7件はすべてexact `record_key`限定で、一般ルールには昇格しない。内訳はnormal 3、reactive 1、direct_nuisance 3。

未解決の `f1fb38be87e3dc7a27a598ae`（「痛いよ！痛い痛い」）は、身体的痛みを述べるnormalと、投稿内容を「痛い」と評するdirect_nuisanceの双方が文面だけで成立する。追加文脈を3分類へ持ち込むことも仕様違反になるため、推測で確定しない。

1件のために新しいdefer状態をパイプラインへ追加すると、registry precedence、review semantics、summary、validationの状態数だけが増える。既存P2 review contractで1件を明示的に残す方が合理的。
