# Review Notes — Protocol Reclassification

## 変更目的

前版 handoff は動作要件と具体的な React 実装形状を同じ強さで固定していた。

今回、`design_ai_protocol_v1` の境界に合わせ、設計を次へ再分類した。

- 不変仕様
- 完了条件
- 確定設計
- 実装仮説

また、入力側の分類は `DESIGN_CLASSIFICATION.md` に分離した。

## 確定設計として維持した判断

- loading view と通常 UI の表示・操作境界。
- design master と application-global styling の責務境界。
- artifact の同期可用性を初回 render 時に判断できる data-client / UI 契約。
- cache / in-flight request ownership を data-client に置くこと。
- component lifecycle と request lifecycle を同一視しないこと。
- artifact-specific temporary state を artifact identity にスコープすること。
- system toast を loading / normal view の双方から利用可能にすること。

これらは複数箇所が協調して初めて正しさが成立するため、実装側へ再判断させない。

## 実装仮説へ下げた判断

前版で hard requirement に近く扱っていた以下は、実コード上の事実に応じて変更可能とした。

- `LoadingScreen` を props なしにすること。
- exact JSX / span 構造。
- `getCachedArtifact()` という具体 API 名・実装。
- `useArtifact` の完成コード。
- `ArtifactRoute` / `AppShell` という component 分割。
- `key={screen}` による remount。
- loader 関連ファイルの exact path。
- local component 化。
- 新規 dependency を絶対禁止すること。

レビューではこれらへの一致自体を accept / reject 判定に使わず、不変仕様・確定設計・完了条件が成立しているかで判断する。

## 削除・緩和した過剰な完了条件

次のような source-shape check は completion definition から外した。

- 11文字を明示 `<span>` で書くこと。
- emblem spin と scale を特定の DOM 分割にすること。
- `ArtifactRoute` に必ず `key={screen}` を書くこと。
- `idle` / `enabled` という identifier が残っていないこと。
- `LoadingState` という component 名が削除されていること。
- 特定 selector / keyframe 名をアプリ側でも完全固定すること。

これらは要求される外部結果を成立させる手段であり、別実装でも正しさを保てるためである。

## 変更していないもの

- `reference/ISSUE_BODY.md`
- `reference/design-master/` 一式
- `reference/current-code/` の参照スナップショット
- `CHECKSUMS.sha256`
