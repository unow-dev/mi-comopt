# 次回作業用プロンプト

以下のZIPをhandoffとして使用し、更新版TikTokコメントJSONをStage 13でラベル付してください。

必ず最初に `README_FIRST.md`、`specs/01_選別基準仕様_Stage13.md`、`specs/02_ラベル付作業ルール仕様_Stage13.md`、`policy/01_REPRODUCIBILITY_RULES.md` を読んでください。

最重要要件:

- 前回参照データ `reference/merged_array_stage13_labeled_REFERENCE.json` と5フィールド完全一致するレコードは、前回の`label`を固定継承する。再解釈して変更しない。
- 新規・変更レコードのみStage 13で判定する。
- 同一`handle`履歴はバッチをまたいで全体参照する。差分データしかない場合は過去参照データの同一handle履歴も補助的に参照する。
- バッチサイズは原則500件。バッチは作業単位であり文脈境界ではない。
- `reference/golden_boundary_examples.json` を境界の回帰テストとして使う。
- キーワードだけで判定しない。「誰に対して何をしているか」を優先する。
- 最終出力は入力5フィールドを一切変更せず、`label`だけを追加する。
- `normal` / `nuisance` の2値以外を使わない。
- `normal`残存監査、同一handle反復監査、性的対象化再監査、他コメント投稿者への攻撃監査、一貫性監査まで行う。
- 最後に `tools/validate_output.py` 相当の検証を実施し、前回完全一致レコードのラベル不一致が0であることを確認する。

最終成果物として、全件ラベル済みJSON、バッチZIP、検証レポートJSONを出力してください。
