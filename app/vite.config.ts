import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The fixture pack is served at /runs/* until the ETL M2 flip — at which point
// the data base URL (see src/data/loader.ts) becomes build/serve/ instead.
// publicDir carries `runs/latest.json` + the fixture run trees verbatim.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: fileURLToPath(new URL("../contracts/fixtures/static", import.meta.url)),
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  build: { outDir: "dist", target: "esnext" },
});
