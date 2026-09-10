# Semantic color map

`inputs/globals.css` のtoken名を使用する。Feature/component側で同等HEXを再定義しない。

| 意味 | token / variant | 備考 |
|---|---|---|
| 高推奨 | `y2k-mint` / `mint` | positive recommendation |
| 中推奨 | `y2k-lemon` / `lemon` | intermediate / caution |
| 任意 | `y2k-lilac` / `lilac` | optional / auxiliary |
| category | `y2k-blue` / `blue` | informational taxonomy |
| NEW | `y2k-pink` / `pink` | attention |
| direct_nuisance | `y2k-pink` | domain negative class |
| reactive | `y2k-lemon` | intermediate class |
| normal | `y2k-blue` | neutral class |
| 通常panel | `y2k-panel` / `card` | 非意味色 |
| foreground/border | `y2k-ink` | outline/text |
| muted text | `y2k-ink-muted` / `muted-foreground` | 補助情報 |
| UI system error / invalid | `destructive` | domainのpinkと区別する |
| focus ring | `ring` | themeではpinkへ接続 |

## 注意

`direct_nuisance = pink` は業務分類色であり、clipboard failure等のシステムエラー色ではない。システムエラーは必ずsemantic `destructive` を使う。
