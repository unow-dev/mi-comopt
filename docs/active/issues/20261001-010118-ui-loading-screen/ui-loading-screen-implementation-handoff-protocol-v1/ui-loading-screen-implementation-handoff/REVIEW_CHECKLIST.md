# Review Checklist

`IMPLEMENTATION_HANDOFF.md` の不変仕様・確定設計・完了条件をレビューするための補助資料。実装仮説そのものへの一致は accept 条件にしない。

## Reject の中心条件

- cache hit 再訪で loader flash が発生する。
- 同一 artifact の HTTP request が UI 側の実装変更によって重複する。
- UI が data-client 内部の cache / in-flight structure を直接操作する。
- component unmount を理由に既存 request lifecycle を変更する。
- artifact 間または再訪時に stale loading / error state が持ち越される。
- navigation 操作だけで暗黙 retry が発生する。
- loading 中に通常 UI が利用可能・操作可能なまま露出する。
- loading view のために system toast が失われる、または既存 timer semantics が変わる。
- design master の視覚・animation・responsive・accessibility の外部結果が崩れる。
- loader 用 style が application-global styling へ副作用を出す。
- Issue にない timeout、progress、cancel、routing、cache invalidation 等の外部意味を追加する。
- unrelated refactor / redesign が混在する。

## Accept の中心条件

- release root / artifact cold load の両方で正本準拠の loading experience が成立する。
- cache hit は不要な待機状態を経由しない。
- failure / retry / navigation / in-flight 再訪の状態遷移が完了条件どおりである。
- cache / in-flight request の所有が data-client に保たれる。
- artifact-specific temporary state が artifact identity にスコープされる。
- system toast が loading view と通常 view の双方で利用可能である。
- reduced motion / accessible loading status が正本の意味を維持する。
- existing tests / build と design master check が通る。

## 実装仮説の扱い

以下は、別案でも上記条件を満たすなら reject 理由にしない。

- `LoadingScreen` の props の有無。
- `ArtifactRoute` / `AppShell` という component 名や分割。
- `key={screen}` の使用有無。
- `getCachedArtifact()` という API 名。
- lazy initializer / attempt counter 等の hook 実装形状。
- JSX 内の span 個数や exact DOM shape。
- loader 関連ファイルの配置。

実装仮説から変更した場合は、変更理由が「実コード上の具体的事実」であり、確定設計を維持しているかを確認する。
