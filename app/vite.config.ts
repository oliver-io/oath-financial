import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev intentionally serves the synthetic fixture pack at /runs/*; production
// serves published runs from the same /runs layout (see src/data/loader.ts).
// publicDir carries `runs/latest.json` + the fixture run trees verbatim.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: fileURLToPath(new URL("../contracts/fixtures/static", import.meta.url)),
  server: {
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  build: { outDir: "dist", target: "esnext" },
});
