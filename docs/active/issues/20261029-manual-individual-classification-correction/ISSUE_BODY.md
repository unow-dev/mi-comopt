# 手動での個別分類修正経路を実装する

作成日: 2026-10-29（JST）

状態: 実装済み（production AC-08 pending）

## 目的

既に分類済みのコメントを対象指定して手動修正し、変更理由と承認履歴を保った新しいClassification Versionとして公開できるようにする。

## 背景

現行の累積分類フローは既存Classification Versionのラベルを引き継ぎ、未分類の項目を主なhandoff対象としている。既存ラベルの誤りを個別に直すための明示的な上書き経路がない。

分類誤りが見つかった場合も、対象コメントの判断を記録して修正し、後続のキーワード選定・release・production公開まで一貫して反映できる必要がある。

## 要求

- 対象コメントを特定し、現行ラベルと修正後ラベルを明示して修正できる。
- 修正対象ごとの理由と実行者を記録する。
- 既存Versionを直接変更せず、新しいClassification Versionとして修正を提案する。
- 修正前後の値、理由、対象Versionをレビュー時に確認できる。
- 承認後は通常の下流更新・release・production promotion経路に接続する。
- 不明な対象、無効なラベル、競合したVersionなどをfail-closedで扱う。

## 完了条件

- 既に分類済みのコメントを指定して個別修正できる。
- 修正提案には対象・修正前後のラベル・理由が含まれ、レビューを経て承認または却下できる。
- 承認時のみ新しいClassification Versionが作成され、却下時は現行Versionが変わらない。
- 修正結果が後続のreleaseに反映され、production公開後のidentity検証まで完了する。
- 既存の新規コメント分類フローと累積ラベルの不変条件が維持される。

## 作業タスク列

- [WORK_TASK_SEQUENCE.md](WORK_TASK_SEQUENCE.md)

## 関連実装

- [累積分類プラン](../../../../package/src/three-class/cumulative-classification-plan.js)
- [分類Application Service](../../../../package/src/application/v3/domain-services.js)
- [v3分類ワークフロー](../../../../package/src/workflow/v3/definitions.js)

## 実装結果

- `classification-correction@1` を追加し、指定Observationと同じ完全一致コメント本文を持つ全survivorを一括で提案する。
- Classificationのhuman accept時だけ新Versionを作成し、rejectとHead競合では既存Headを維持する。Proposalのcommit preflightでCorpus Head、依存、全件差分、Assessment、semantic hashを再検証する。
- 現在の累積Classification headは`schema_version:2`のため、訂正後もbaseのState schema versionを保持する。WorkDefinition schema version 2とは区別する。
- `comment-data-update@3`の定義hashは維持し、安全分岐を実装した`@4`を新設する。
- production DB/Workspaceへの起動、Promotion、Deploymentは実施していない。AC-08のproduction identity確認はpending。
