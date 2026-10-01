# Comment Loading — Design Master

このディレクトリをローディング画面の**デザイン正本**として扱う。

## 正本の役割

1. `tokens/design-tokens.json` — 再利用する色・余白・サイズ・タイポグラフィ・影・モーション値の唯一の編集元
2. `css/component.css` — レイアウト、SVG形状、ブレークポイント、キーフレームなど構造ルールの正本
3. `index.html` — 正規化された参照実装
4. `assets/emblem.webp` — エンブレム原本（表示に使用する正本）
5. `css/tokens.css` — **生成物**。直接編集しない

`reference/` は受領時原本の比較用で、正本ではない。

※ いったん導入した `assets/emblem.svg` は形状欠けを起こしたため、表示用の正本は `assets/emblem.webp` に戻した。

## 更新と検証

```bash
npm run build
npm run check
```

`tokens/design-tokens.json` を変更したら `npm run build` で CSS 変数を再生成する。`npm run check` は読み取り専用で、生成物が古い場合は書き換えずに失敗する。生成物の同期、トークン型・参照・CSS変数名衝突、未定義 CSS 変数、クラス名前空間、inline style、アクセシビリティ要件、アセット存在を検査する。

## トークン形式について

`tokens/design-tokens.json` はこのプロジェクトの CSS 生成用ローカルスキーマである。`$type` / `$value` を使うが、DTCG など外部交換仕様への完全準拠を保証するものではない。外部ツールとの相互運用が必要な場合は、対象仕様に合わせた変換層を別途設ける。

## 変更ルール

- 再利用するデザイン値を `index.html` や `component.css` に新規直書きしない。必要なら先に `tokens/design-tokens.json` に追加する。
- ブレークポイントやキーフレーム内の一回限りの値など、CSS変数では表現しにくい構造値は `component.css` を正とする。
- コンポーネントのクラス名は `loading-screen` / `loading-screen__*` / `loading-background` / `loading-background__*` に限定する。
- エンブレムの回転と拡縮は別要素のまま維持する。統合すると既存のモーション特性が変わる。
- `prefers-reduced-motion: reduce` を維持する。
- 読み上げ文言は `読み込み中` を正とし、装飾文字列とは分離する。

## 現行仕様の要点

| 項目 | 正本値 / 参照先 |
|---|---|
| ブランド色 | `#1ab7ec` — `tokens/design-tokens.json` |
| エンブレム表示サイズ | `46px` — tokens |
| 通常ギャップ | `15px` — tokens |
| 640px以下のギャップ | `13px` — tokens、閾値は `component.css` |
| ローダー行高 | `28px` — tokens |
| 文字サイズ | `clamp(18px, 7.2vw, 23px)` — tokens |
| ウェイト | `700` — tokens |
| 字間 | `0.045em` — tokens |
| アニメーション周期 | `2.4s` — tokens |
| 文字ウェーブ遅延 | `45ms / 文字` — tokens |

## 構造上の意図

- 背景は viewport 全体に固定し、コンテンツより下のレイヤーに置く。
- 中央コンテンツは `100dvh` を考慮しつつ中央配置し、下方向に `2vh` の視覚補正を入れる。
- 背景 SVG の色はすべてセマンティックトークン経由で参照する。
- 文字ウェーブの index は CSS 側で定義し、HTML の inline style は使わない。
- ローディング表示の視覚要素は `aria-hidden`、状態通知は `role="status"` の不可視テキストで担保する。
- 表示に使うエンブレムは `assets/emblem.webp` を正とする。HTML の `width` / `height` は表示寸法 `46×46` に合わせ、実際の表示スケールとの差異を作らない。
