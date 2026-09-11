# Decision log

実装時に再検討しないための主要判断一覧。

| 論点 | 採択 | 不採択理由 |
|---|---|---|
| 最優先 | 機能的意味の保持 | referenceに合わせるための機能削除は不可 |
| 外観正本 | 3つの適用済みHTML | 現行Y2Kは今回置換対象 |
| 実装方式 | reference DOM/CSSをReact化 | Y2K wrapperへCSS上書きすると完全一致しにくい |
| SPA/routing | SPA維持・routing追加なし | routingは今回の目的外 |
| top tabs | 通常フロー | fixed/scroll-hideに業務上の意味がない |
| 3番目tab | コメントラベル集計 | `判定ログ`はfilter referenceのみの不整合 |
| card件数 | 全実データ表示 | reference件数への削減は機能劣化 |
| pagination | 追加しない | 要求外・現状規模で不要 |
| keyword filter | all cards mount + hidden | reference挙動に忠実でlocal stateも保持 |
| detail | 複数同時open | referenceは独立toggle、accordionではない |
| evidence | 全文表示 | clamp/scroll boxは情報確認機能を弱める |
| copy state | buttonごと独立 | reference動作 |
| toast | singleton | queue/stackはreferenceと異なる |
| copy timing | keyword 1300ms / account 1400ms | 各referenceへ一致 |
| toast timing | 1600ms | referenceへ一致 |
| copy failure | 現行failure判定を保持 | referenceの成功前提scriptより機能性を優先 |
| recommendation | exactly one active | 現行・referenceとも同じ意味 |
| NEW clock | mount時固定 | UI issueでtimer機能を追加しない |
| label 0% | width 0 | 3px visible barはデータ意味と矛盾 |
| breakpoint | 640 / 390 | referenceを正本とする |
| reduced motion | reference ruleを本番採用 | accessibility維持 |
| Web font | 導入しない | referenceはsystem font |
| visual test | 同一環境でreferenceと比較 | cross-OS golden pixel diffは不安定 |
| visual framework | 新規導入しない | issue規模を超える恒久基盤追加 |
| Y2K | 完全撤去 | 新旧theme併存は仕様矛盾 |
| `components.json` | 削除 | shadcn/Y2K生成基盤を使わないため |
| Radix | Tabs用途で維持 | keyboard/focus維持に有用 |
| `utils.js` | 今回は維持 | UI theme変更のためだけにutility境界を変更しない |
| 旧Y2K issue | supersede | active requirementsを競合させない |

## 適用例に未定義の状態

次の規則を使う。

1. 同じ画面内に近いpatternがあれば流用。
2. なければ他の2つの適用済みHTMLから流用。
3. それでもなければexpanded UI kitから最も近いpatternを使用。
4. 新規独自patternは最後の手段。

例:

- account empty → filter `.empty`
- copy failure → success toastと同一geometry、`--danger`背景
- account evidence → account `.detail-panel`を拡張
