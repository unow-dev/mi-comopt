# Package

This directory is the deliverable boundary.

アーキテクチャの責務と依存規則は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

## 開発サーバー

リポジトリ直下で `npm run dev`、またはこのディレクトリで `npm run dev` を実行すると、`src/ui/App.jsx` の新UIが起動します。公開データは `docs/active/temp/optimicom-react-tailwind/public/optimicom-ui-release.json` をrelease rootとして読み込みます。

## Comment DB State Control Plane

新しい業務状態経路を使う場合は `openCommentStateDatabase()` または `openCommentDatabase(path, { stateControlPlane: true })` で明示的にState Control Planeを有効化します。通常のv8 read-model接続には状態テーブルを追加しません。

```js
import { openCommentStateDatabase, StateControlPlane } from "./src/comment-db-state.js";

const db = await openCommentStateDatabase("./var/comment-history.sqlite3");
const state = new StateControlPlane(db);
```

`src/application/`のApplication ServiceがProposal → Decision → Commitを担当し、`src/workflow/`はWork Orchestratorの定義・互換アダプターだけを担当します。Releaseはexact versionの組合せで構築し、Account Candidateは派生値として再計算します。
