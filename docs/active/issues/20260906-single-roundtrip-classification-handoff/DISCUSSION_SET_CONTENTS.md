# 単一往復分類 handoff 議論セット

## 目的

`ISSUE_BODY.md` の単一往復化を議論するために、現行分類パイプライン、判断入力、下流互換性境界、および回帰テストを1つの archive に集約する。

## 収録範囲

- `docs/active/operations/Integrated_Labeling_Handoff_v1.4 (2).0/`
  - 現行 v1.4.0 分類パイプライン本体、仕様、prompt、policy、reference、template、回帰テストを完全収録する。
  - Python bytecode cache は除く。
- `docs/active/operations/integrated-labeling-state/`
  - 実行時に参照する current three-class golden/P2 adjudication state を収録する。
- `package/`
  - final three-class を検証して keyword candidate handoff へ渡す処理、account candidate 処理、joint release 処理、契約、現行公開artifact、および関連テストを収録する。

## 除外条件

- `docs/archive/` と `docs/active` 以外の `docs/` 文書は収録しない。
- `work/`、旧 handoff package、移行元artifact、legacy bootstrap 入力、コンパイル済み cache は収録しない。
- 現行コードから参照される互換性 shim は、現行の release 検証境界を理解するために収録対象とする。ただし、shim が参照する旧artifact自体は収録しない。

## Archive 構成

archive の root には `ISSUE_BODY.md` とこの目録を `CONTENTS.md` として置く。その他のファイルは repository root からの相対パスを維持する。