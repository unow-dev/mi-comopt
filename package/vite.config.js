import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.GITHUB_ACTIONS === "true" ? "/mi-comopt/" : "/";

export default defineConfig({
  plugins: [react()],
  base,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
