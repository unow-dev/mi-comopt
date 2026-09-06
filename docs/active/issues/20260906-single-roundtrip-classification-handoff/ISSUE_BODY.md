# Issue: 分類handoffの単一往復化

## 目的

分類作業を、単一のhandoff送付と単一の回答取得による1往復で完了できる状態にする。最終3-class分類を確定しつつ、既存のStage13・three-classのprovenanceおよび下流成果物との互換性を維持する。

## 背景

現行の分類作業は、Stage13の`normal` / `nuisance`判定と、その出力を入力とする3-class分類に分かれている。Stage13は過去の確定判断の再利用と二値判断の根拠を担い、3-class成果物は候補生成、account候補、releaseの共通入力になっている。この二段階の人手往復は、作業量と運用の複雑さを増やしている。

## フリーズ要件

- 人間との分類作業は、単一のhandoff送付と単一の回答取得の1往復で完了させる。
- 統合後の分類結果は、最終3-classラベル、Stage13判断、各判断のprovenanceを追跡可能にする。
- 既存のStage13 reference、three-classのreviewed decision、候補生成、account候補、releaseが利用する下流互換性を維持する。
- 現行v1.4の二段階運用は、このissueの実装・検証が完了するまで変更しない。