# Stage 13 ラベル付仕様セット

収録ファイル:

1. `01_選別基準仕様_Stage13.md`
   - `normal` / `nuisance` の意味上の境界
   - Stage 13で追加された厳格化ルール

2. `02_ラベル付作業ルール仕様_Stage13.md`
   - 最新の5フィールド入力型を前提とした実作業手順
   - 同一ユーザー監査
   - `postedDate` を使った時系列確認
   - 機械チェック・品質管理

前提入力型:

```json
{
  "username": "...",
  "handle": "...",
  "comment": "...",
  "postedAt": "...",
  "postedDate": "YYYY-MM-DD"
}
```

出力では上記5フィールドを変更せず、`label` のみ追加する。
