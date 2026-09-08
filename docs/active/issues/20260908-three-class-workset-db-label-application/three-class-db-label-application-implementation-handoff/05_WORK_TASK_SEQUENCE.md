# Work Task Sequence: three-class DB label application

## Purpose

検証済みの three-class workset 応答を、生成時に選択された Comment DB snapshot の観測行へ、raw 観測を変更せず安全かつ原子的に反映できる状態にする。

## Task Sequence

- [x] 1. 既存実装と確定仕様の範囲で、AIエージェントが、変更対象、既存契約、受入条件を確認する。
- [x] 2. データベーススキーマの範囲で、AIエージェントが、workset の生成元と現在の観測ラベルを保持できる状態へ変更する。
- [x] 3. workset 生成経路の範囲で、AIエージェントが、生成済み成果物と選択 snapshot の対応を安全に登録できる状態へ変更する。
- [x] 4. 応答検証と反映経路の範囲で、AIエージェントが、検証済み入力、生成元照合、ラベル整合性確認、および対象観測への反映を実現する。
- [x] 5. コマンドライン操作の範囲で、AIエージェントが、反映機能の入力、出力、エラーを既存の操作規約に沿って提供する。
- [x] 6. 自動テストの範囲で、AIエージェントが、スキーマ、生成元拘束、反映範囲、競合、原子性、再実行性、および CLI 契約を検証する。
- [x] 7. 変更結果の範囲で、AIエージェントが、全テストを実行し、実施内容と確認結果を記録する。

## Work Notes

- 実装の正本は `01_FINAL_DECISIONS.md`、`02_IMPLEMENTATION_SPEC.md`、`06_ACCEPTANCE_TESTS.md`、`07_CLI_AND_ERROR_CONTRACT.md` とする。未決の仕様判断はこの作業では追加せず、人間へ確認する。
- DB スキーマは migration 006 で version 6 へ進める。workset の親、workset と generation-time snapshot の対応、観測単位の現在ラベルだけを追加し、backfill、履歴、トリガー、CASCADE、ラベルの source workset は追加しない。
- 生成処理では、投影・パッケージング・アーカイブ検証・staging cleanup の成功後に限り、短い `BEGIN IMMEDIATE` トランザクションで provenance を登録する。登録に失敗した場合は、その実行が所有すると確認できる ZIP だけを cleanup する。
- 反映処理は、DB を開く前に workset と response を検証し、同一の検証済みインメモリ値を使用する。DB 依存の検証とラベル挿入は一つの `BEGIN IMMEDIATE` トランザクションで行う。
- 反映対象は registry に記録された snapshot の観測行だけとする。正確な comment 文字列を分類キーとし、DB 全体の既存ラベルは競合検出のために読むが、非選択 snapshot へは書き込まない。
- 同じ有効ラベルの再適用は成功し `unchanged` として数える。異なる既存ラベル、未登録 workset、再構成した ITEMS の不一致、または観測数・decision map の不変条件違反は、挿入前に失敗させる。MVP では訂正・更新・削除・force・dry-run を提供しない。
- `apply-three-class-response` は `--workset` と `--response` を必須、`--db` を任意とし、成功時は対象観測だけを数えた 1 行の `APPLIED ...` サマリーを出力する。終了コードは既存の 0/1/2 規約を維持する。
- 既存テストと追加テストを通過した後、リポジトリの既存コマンド `npm test` を実行する。migration による v5 から v6 への更新は、後続の業務上の反映失敗時に rollback しない一方、three-class ラベルの部分反映は残してはならない。
- 検証結果は `npm test` 107件成功、JavaScript/Python 構文検査成功、handoff の `MANIFEST.sha256` 検証成功。
