import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.GITHUB_ACTIONS === "true" ? "/mi-comopt/" : "/";

export default defineConfig({
  plugins: [react()],
  base,
  publicDir: fileURLToPath(new URL("../docs/active/temp/optimicom-react-tailwind/public", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
