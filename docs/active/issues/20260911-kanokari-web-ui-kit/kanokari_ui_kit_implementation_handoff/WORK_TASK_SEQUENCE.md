# Work Task Sequence: 「彼女、お借りします。 inspired Web UI Kit」適用

## Purpose

既存UIの機能的意味、データ境界、操作性、およびアクセシビリティを維持したまま、同梱された「彼女、お借りします。 inspired Web UI Kit」適用済み3画面の外観へ置換し、受入条件を満たした状態にする。

## Task Sequence

- [ ] 1. 要求整理の範囲で、AIエージェントが、確定仕様、視覚的正本、優先順位、受入条件、および対象外事項を確認する。
- [ ] 2. 実装前確認の範囲で、AIエージェントが、現行UIの構造、データ取得境界、状態管理、依存設定、テスト基盤、および既存変更を確認する。
- [ ] 3. 仕様逸脱判断の範囲で、人間が、handoffの確定仕様だけでは判断できない機能保持、依存削除、または旧UI要件との競合事項について実装継続または別Issue化を判断する。
- [ ] 4. 仕様整理の範囲で、AIエージェントが、共通デザイン基盤、SPAの3タブ構成、レスポンシブ境界、reduced-motion、viewport、およびdocument titleの実装条件を整理する。
- [ ] 5. 共通UI基盤の実装範囲で、AIエージェントが、UI Kitのtoken、system font、背景、hero、intro、content、card、tab、empty、detail、およびtoastの表示基盤を整備する。
- [ ] 6. 画面構成の実装範囲で、AIエージェントが、フィルターキーワード、ブロックアカウント、コメントラベル集計の3画面を、現行データを保持したUI Kit準拠の表示へ統合する。
- [ ] 7. 操作挙動の実装範囲で、AIエージェントが、推奨度・NEWの絞り込み、全件表示、detailの独立開閉、evidence全文表示、copy成功/失敗、およびsingleton toastを確定仕様どおり維持する。
- [ ] 8. 旧UI整理の範囲で、AIエージェントが、Y2K/shadcn/Sonnerの旧表示基盤、不要な依存、registry、utility参照、および未使用componentを影響範囲確認後に整理する。
- [ ] 9. データ境界維持の範囲で、AIエージェントが、candidate data・adapter・NEW判定・生成JSON・processing・database・collectorの責務と既存契約が変更されていないことを確認する。
- [ ] 10. 自動検証の範囲で、AIエージェントまたはCIが、静的cleanup、既存テスト、必要な回帰テスト、およびproduction buildを実行して結果を確認する。
- [ ] 11. Visual QAの範囲で、AIエージェントまたはCIが、指定されたviewport、境界幅、通常状態、filter/NEW、detail、copy/toast、empty、長文、およびkeyboard/focus状態をreferenceと比較する。
- [ ] 12. 受入と作業結果の範囲で、AIエージェントが、acceptance checklist、許容差分、検証結果、未解決事項、および旧Y2K issueのsupersede状態を記録し、完了可否を報告する。

## Work Notes

- 正本の優先順位は、`IMPLEMENTATION_SPEC.md`、現行Reactロジック・表示データ、3つの適用済みHTML、未定義状態を補う`kanokari_web_ui_kit_expanded.html`、現行Y2K UIの順とする。
- visual referenceは`filter_keyword_ui_kit_applied.html`、`block_account_ui_kit_applied.html`、`comment_label_summary_ui_kit_applied.html`。reference内のダミー詳細文、件数制限、画面遷移デモは製品仕様ではない。
- SPAの3タブ構成、タブ名、通常フロー、全候補表示、source順、複数detail同時open、既存data adapter・NEW判定・generated JSONのarchitecture boundaryを維持する。routing/history/hash/queryは追加しない。
- キーワードのrecommendationは常に1つactive、NEWとの組み合わせはAND、filter対象外cardはunmountせずhidden、0件文言は`条件に一致する候補はありません。`とする。
- アカウントのdetailには判定ラベル・該当コメント数・候補条件とevidence全文を表示し、0件文言は`該当するアカウント候補はありません。`とする。evidenceはtruncate/clamp/internal scroll boxで制限しない。
- copyの成功表示時間はkeyword 1300ms、account 1400ms、toastは成功/失敗とも1600ms。toastはsingletonでstackせず、新しいtoastで前timerをresetする。
- label summaryは実データから割合を小数1桁で再計算し、totalが0の場合は`0.0%`、0%のprogress fillはwidth 0とする。
- cleanupでは`y2k-ui-lib`、`@y2k` registry、実行対象の`--y2k-*`、旧Tailwind/shadcn/Sonner参照をrepo-wideで確認する。RadixはTabs用途で維持してよく、`src/lib/utils.js`は今回のtheme変更だけを理由に変更しない。
- `src/data/*`、候補抽出・分類・NEW判定、processing、database、collector、および既存の外部データ契約は、UI適用のために加工・削減・変更しない。不要依存や旧componentの削除はconsumerがないことを確認してから行う。
- 必須検証は実リポジトリでの`npm test`全成功と`npm run build`成功。比較環境は同一OS・同一Chromium系ブラウザ・device scale 1とし、1280×900、640×900、390×844、および641px/391px境界を確認する。
- NEWのVisual QAだけは比較環境の時計を2026-09-11相当に固定し、production codeへtest-only clock APIを追加しない。実データ全件、保持したdetail情報、0%補正、failure/emptyなどreference未定義状態による差分だけを許容する。
- `docs/active/issues/20260910-y2k-ui/ISSUE_BODY.md`は本issueと要求が競合するため、本issueのUI適用が完了した時点でactive requirementとして併存させない。
