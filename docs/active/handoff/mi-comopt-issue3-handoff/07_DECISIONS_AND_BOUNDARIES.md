# 07 決定事項と設計境界

## 議論済みの方針（変更の理由が必要）

1. 一括修正は個別修正Taskのループではなく、1つのCorrectionBatchとして処理する。
2. 代表Observation IDではなく、固定Corpus上の本文完全一致CommentGroupを更新対象とする。
3. Assessment/Proposal/Decision/Classification Versionはバッチ単位。部分承認なし。
4. Domainの対象解決・変更集合計算は純粋関数。データ読込や永続化は別のinterface。
5. commit直前の再検証と分類Version/Head更新は原子的に行う。
6. Task実行の`ctx.operationId`と業務操作の`correctionOperationId`を別概念として扱う。
7. commit後のPublication失敗は分類状態のcommit取り消しを意味しない。
8. Publicationは新ClassificationVersionを参照し、production Promotionで独立したHuman承認を要する。
9. 登録済み旧WorkDefinitionは変更せず、新revisionとして追加する。
10. 新WorkDefinitionは`invalid`/`rejected`/`superseded`枝から後続の公開Taskへ遷移させない。

## 作業者が選べる実装手段（上記の結果を満たす限り自由）

- JavaScript + JSDoc またはTypeScript、純粋関数のモジュール分割、物理的なファイル配置。
- ChangeSetの保存先（専用テーブル/既存不変payload/Content-addressed保存）。ただし再起動・別Sessionからの参照と改ざん検出を必須とする。
- 検証後の`refs`/`details`のどちらを使うか。ただし既存schemaとTask result rule、bindingを同時に整合させる。
- 既存ControlPlaneを拡張するか、トランザクション内で呼ばれる薄いPortを追加するか。
- Review DTOのフィールド構造（本文、差分、件数、理由、Version、根拠が完全に見えることが必要）。

## 事前確認を要する点

| 論点 | 作業で確かめる事項 |
|---|---|
| 単一修正ソースの所在 | Issue #2や実作業ブランチにあるコードとの共通化方針。`main`にないことだけで不要と判断しない。 |
| Version依存Head | どのpolicy Head一致まで必須とするか、Issueの「依存Version再検証」の意味と既存ControlPlaneの前提を合わせる。 |
| changeSet IDの置き場所 | Schemaを拡張するか`details`を使うか。変更後は型・ルール・定義を一貫させる。 |
| WorkDefinition revision | Registryの既存`classification-correction`のrevisionを検査してから番号確定。 |
| request fingerprintの正準化 | 修正要求の順序が意味を持たないなら並べ替えてhash。重複指定はhash化前に拒否する。 |
| Workflowの終端表現 | `noop`終端が外側の`sequence`を止めると仮定せず、Orchestrator意味論を確認し成功枝の入れ子で表現。 |

## このhandoffに含まれないもの

- 実際のproduction Session開始・review承認・Deployment公開の命令。
- 現在のproduction Headの状態に関する新しい保証。Issue作成時の数字は照合の基準のみ。
- 既存の`classification-correction@1`のソース全文（mainで未取得）。
- リリース可否や環境への適用判断。ワークフロー定義の責務と区別する。
