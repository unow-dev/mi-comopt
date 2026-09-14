# Package

This directory is the deliverable boundary.

アーキテクチャの責務と依存規則は [ARCHITECTURE.md](./ARCHITECTURE.md) を参照してください。

## 開発サーバー

リポジトリ直下で `npm run dev`、またはこのディレクトリで `npm run dev` を実行すると、`src/ui/App.jsx` の新UIが起動します。公開データは `docs/active/temp/optimicom-react-tailwind/public/optimicom-ui-release.json` をrelease rootとして読み込みます。
