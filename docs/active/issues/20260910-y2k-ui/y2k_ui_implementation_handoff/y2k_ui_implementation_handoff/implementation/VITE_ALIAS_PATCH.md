# Vite alias patch

既存 `vite.config.js` の `plugins` と `base` を維持し、`resolve.alias` だけ追加する。

```js
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.GITHUB_ACTIONS === "true" ? "/mi-comopt/" : "/";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```
