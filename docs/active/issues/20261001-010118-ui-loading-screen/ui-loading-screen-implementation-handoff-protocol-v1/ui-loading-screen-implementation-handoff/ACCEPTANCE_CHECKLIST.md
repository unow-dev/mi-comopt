# Acceptance Checklist

このチェックリストは `IMPLEMENTATION_HANDOFF.md` の「完了条件」を検証しやすく展開したもの。新しい要求や特定の実装形状を追加するものではない。

## A. Release root

- [ ] pending 中は full-screen loading experience が表示される。
- [ ] pending 中に通常 navigation / content が操作可能な状態で露出しない。
- [ ] success 後は artificial delay なしに通常画面へ遷移する。
- [ ] failure 後は loader が残留せず、既存 release error flow が表示される。

## B. Artifact cold load / cache hit

overview / comments / keywords / accounts の対象画面で確認する。

- [ ] cache miss の初回表示で loading experience が表示される。
- [ ] success 後に対象画面へ遷移する。
- [ ] cache 済み artifact の再訪では loading の視覚的な点滅が発生しない。
- [ ] cache hit により追加 HTTP request が発生しない。

## C. Failure / Retry

- [ ] artifact request failure 後は loader が終了し、既存 error flow が表示される。
- [ ] 明示的 retry の開始後は再取得待機中の loading が表示される。
- [ ] retry により artifact request が再実行される。
- [ ] error 後の再訪で以前の component-local ErrorState を stale 表示しない。
- [ ] 同じ navigation 項目を再選択するだけで暗黙 retry が発生しない。

## D. In-flight navigation

- [ ] artifact A pending 中に離脱しても、既存 request lifecycle を UI unmount が勝手に cancel しない。
- [ ] 離脱中に A が成功した場合、再訪時に cache を再利用する。
- [ ] A がまだ pending のうちに再訪した場合、既存 in-flight request を共有し、重複 HTTP request を発生させない。
- [ ] 離脱中に A が失敗した場合、再訪時に以前の component-local error state を stale 表示しない。

## E. Toast

- [ ] loading 中でも既存 system toast が表示可能である。
- [ ] toast の timer semantics を変更していない。
- [ ] toast の通知内容・既存 styling の意味を変更していない。

## F. Design master fidelity

- [ ] 視覚文言が正本と一致する。
- [ ] emblem / background / typography / spacing / animation の外部結果が正本と整合する。
- [ ] desktop と narrow viewport で正本の responsive behavior が維持される。
- [ ] 狭幅で意図しない横スクロールが発生しない。
- [ ] application-global styling に loader 導入由来の副作用がない。

## G. Accessibility / Motion

- [ ] loading status が assistive technology から `読み込み中` と認識できる。
- [ ] decorative content と視覚専用ラベルが不要に読み上げられない。
- [ ] `prefers-reduced-motion: reduce` で正本の停止対象 animation が停止する。

## H. Existing data-client contracts

- [ ] cache hit の既存契約を維持している。
- [ ] cache miss の既存契約を維持している。
- [ ] in-flight dedupe の既存契約を維持している。
- [ ] UI がデータ取得層の内部 cache / in-flight structure を直接操作していない。

## I. Scope

- [ ] Issue にない timeout / progress / cancel 等の loading semantics を追加していない。
- [ ] request cancellation semantics をこの Issue のついでに変更していない。
- [ ] routing / cache invalidation / error UI redesign / 汎用 loading framework 等の独立改善を混在させていない。
- [ ] 通常 UI の unrelated behavior / styling を変更していない。

## J. Verification commands

実リポジトリの完全な checkout 上で確認する。

- [ ] 既存 test suite が成功する。
- [ ] production build が成功する。
- [ ] 既存の data-client tests がある場合、今回追加・変更した同期可用性契約と既存 dedupe 契約を同じ test framework で検証する。

同梱 design master で確認する。

- [ ] `npm run check`
- [ ] `sha256sum -c CHECKSUMS.sha256`
