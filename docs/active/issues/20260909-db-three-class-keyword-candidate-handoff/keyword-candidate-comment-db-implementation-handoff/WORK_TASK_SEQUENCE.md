# Work Task Sequence: Comment DB 3-class keyword-candidate handoff implementation

## Purpose

Comment DBの完全にラベル付けされた単一snapshotから、既存候補workflowと追跡可能に接続するkeyword-candidate handoffを生成し、検証済み候補publicationをDBへ安全に記録したうえで、DB-currentから既存UI契約の候補JSONを原子的に更新できる状態にする。

## Task Sequence

- [x] 1. 要求整理の範囲で、AIエージェントが、確定済みの設計判断、実装仕様、受入条件、対象外事項、および文書間の優先順位を確認する。
- [x] 2. 実装前確認の範囲で、AIエージェントが、Comment DB、候補workflow、publication、CLI、UI出力、および関連テストの既存契約と変更境界を確認する。
- [x] 3. 仕様差異の判断範囲で、人間が、既存実装が確定済みの前提と矛盾した場合に、設計へ戻る要否を判断する。
- [x] 4. 永続化境界の実装範囲で、AIエージェントが、候補publicationの検証済みmirror、snapshot単位のラベル読取り、および既存データとの互換性を満たす状態へ変更する。
- [x] 5. DB起点handoff生成の実装範囲で、AIエージェントが、単一snapshotと3分類ラベルから決定的な候補入力を構成し、既存handoff契約に従うread-only生成経路を実現する。
- [x] 6. publication検証とDB反映の実装範囲で、AIエージェントが、handoff・snapshot・filesystem publicationの対応をDB変更前に検証し、原子的な反映、履歴欠落の許容、および再実行時の整合性を実現する。
- [x] 7. DB-current UI出力の実装範囲で、AIエージェントが、DBに保持した検証済み候補JSONを既存UI契約のまま原子的に出力できる経路を実現する。
- [x] 8. CLIと運用契約の実装範囲で、AIエージェントが、3経路を独立して実行できる必須引数、出力安全性、エラー、および終了コードの契約を提供する。
- [x] 9. 単体・結合・回帰検証の範囲で、AIエージェントまたはCIが、migration、決定的projection、provenance拘束、DB反映の原子性・冪等性、UI出力の原子性、CLI契約、および既存機能の回帰を確認する。
- [x] 10. 作業結果の範囲で、AIエージェントが、実施内容、検証結果、設計へ戻る判断の有無、残存する運用上の注意点、および対象外事項を記録する。

## Work Notes

- 実装の正本は `README_FIRST.md`、`IMPLEMENTATION_SPEC.md`、`DECISIONS.md`、`ACCEPTANCE_TESTS.md`、`SOURCE_MAP.md` とする。確定済み設計を実装中に変更せず、明示的な前提との矛盾が判明した場合だけ人間の判断へ戻す。
- 候補状態とlineageの正本は既存のimmutable filesystem publicationとする。Comment DBは、既存`full-update`で公開済みのpublicationだけを検証して保持するdurable mirrorであり、候補の状態遷移・評価・DB側の再promotionは担わない。
- 3経路は独立した運用単位とする。handoff生成はDB read-only、DB反映はUI出力を生成せず、UI出力はhandoffまたはfilesystem publicationを読まずDB-currentだけを入力とする。
- DB起点の候補入力は、明示選択した1件のsnapshot、順序付き観測、対応する3分類ラベルから構成する。ラベル欠落・件数不一致・source index不整合はhandoff生成前にfail-closedとし、既存raw snapshot整合性確認を正本として再実装しない。
- handoffのsource identityはsnapshot参照と`source_dataset.json`のexact byte SHA、既存request fingerprintで拘束する。DB反映では同じデータセットをDBから再構成し、handoff、request、current publication、親publication、および生成artifactの不一致をDB変更前に拒否する。
- DB反映はfilesystem parentの検証を維持し、DBに未反映の中間runがあっても有効なfilesystem lineageは受け入れる。同一runの同一内容の再反映は変更なしで成功させ、異なる内容または非currentの既存runの再利用は競合として拒否する。
- UI出力は、DBにexact textとして保存したcurrentの候補JSONを検証後に同一ディレクトリの一時ファイルから原子的に置換する。UI schemaおよびUI componentは変更対象外とする。
- 既存workflow由来のエラーコード、path解決、引数検証、終了コードを維持する。issue固有の失敗は定義済みの専用コードに限定し、CLI引数エラーは終了コード2、その他の失敗は終了コード1とする。
- 検証では受入試験の全件と`npm test`を実行する。少なくとも、ラベル済みsnapshotからhandoff、既存full-update publication、DB反映、UI adapter読込みまでのend-to-end経路を確認する。
- DB側の候補状態機械、DB側の再評価、過去filesystem publicationの全件backfill、3分類`workset_id`の必須化、任意publicationのimport、DB履歴runの再promotion、およびUI schema変更は対象外とする。
- 着手前ベースラインは `0d5566c`（`chore: baseline comment DB candidate handoff work`）として記録した。
- 既存実装と確定済み設計の明示的な矛盾は確認されず、設計への差戻しは不要と判断した。
- migration 007、snapshot単位ラベル読取り、検証済みpublication mirror、DB起点handoff、filesystem `current`のfull-update再検証、DB-currentの原子的UI出力、および3つのCLI経路を実装した。
- `npm test`（112件）と `npm run build` が成功した。結合テストでは、ラベル済みsnapshotからhandoffを生成し、既存full-update publicationをDBへ反映して、DB-currentからUI JSONを出力する経路を確認した。
- 運用時のDB反映はfilesystem `current`と、そのrequestが指すimmutable parent publicationを必要とする。DBへ未反映の中間runは許容するが、DB側の過去run再promotionは実装していない。
- 2026-09-09に、完全ラベル済みsnapshot `98b1a2d6ca08fe61b8b821d4498e8bab8683d4cf0c4ac0843cb5b89f7a014c7c:0`（24,622件）から `work/20260909/keyword-candidate-handoff` へhandoffを生成した。生成後にmanifestの全10入力ファイルを再検証し、source dataset SHAは `sha256:320280e1a0c41bf4954b84f859345098a98447d457ed77e1101a415cb7419e2f` と確認した。生成に伴いDB schemaをv7へ移行したが、候補publicationのDB行は作成していない。
- handoff生成の最終成果物はZIPとし、flatな11ファイル（manifestを含む）だけを格納するよう変更した。2026-09-09に変更後のCLIで `work/20260909/keyword-candidate-handoff.zip` を生成し、全member、source dataset SHA、および候補publicationのDB行が0件であることを確認した。DB反映時はZIPを展開してから `handoff_manifest.json` を指定する。
- 2026-09-09に返却された `work/20260909/keyword_candidate_actions.json`（追加2件・更新2件）を、対応するhandoff ZIPから展開した入力と照合して適用した。`run_993b988e-1703-4a28-9730-c60500f04f9b` を`full_update`としてfilesystem `current`へ公開し、snapshot 9のDB mirrorへ`applied`として反映した。publicationは86件で、既存validatorによる検証に成功した。
