// Prod-shaped local static server — infrastructure.md §2 / plan §4.
// Serves the SPA build + a runs/ tree with the SAME header table and fallback
// semantics as the deployed stack: immutable run objects and hashed assets,
// no-cache latest.json/index.html, SPA fallback for non-file routes, and REAL
// 404s under /runs/ (the loader must see missing partitions as errors).
// Usage: bun infra/scripts/serve-local.ts [--dist app/dist]
//        [--runs contracts/fixtures/static/runs] [--port 4173]

import { existsSync } from "node:fs";
import { join } from "node:path";
import { CC_IMMUTABLE, CC_NO_CACHE, argValue, contentTypeFor } from "./lib.ts";

const dist = argValue("--dist", "app/dist");
const runsDir = argValue("--runs", "contracts/fixtures/static/runs");
const port = Number(argValue("--port", "4173"));

if (!existsSync(join(dist, "index.html"))) {
  console.error(`no ${dist}/index.html — run 'bun run --cwd app build' first`);
  process.exit(1);
}

function fileResponse(path: string, cacheControl: string): Response {
  return new Response(Bun.file(path), {
    headers: { "cache-control": cacheControl, "content-type": contentTypeFor(path) },
  });
}

Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    const p = decodeURIComponent(url.pathname);
    if (p === "/runs/latest.json") return fileResponse(join(runsDir, "latest.json"), CC_NO_CACHE);
    if (p.startsWith("/runs/")) {
      const f = join(runsDir, p.slice("/runs/".length));
      // real 404, never the SPA shell — parity item 5
      return existsSync(f) && Bun.file(f).size >= 0 && !f.endsWith("/")
        ? fileResponse(f, CC_IMMUTABLE)
        : new Response("not found", { status: 404 });
    }
    if (p === "/" || p === "/index.html") return fileResponse(join(dist, "index.html"), CC_NO_CACHE);
    const rel = p.slice(1);
    const staticFile = join(dist, rel);
    if (/\.[a-z0-9]+$/i.test(rel) && existsSync(staticFile)) {
      return fileResponse(staticFile, rel.startsWith("assets/") ? CC_IMMUTABLE : CC_NO_CACHE);
    }
    if (/\.[a-z0-9]+$/i.test(rel)) return new Response("not found", { status: 404 });
    return fileResponse(join(dist, "index.html"), CC_NO_CACHE); // SPA fallback
  },
});
console.log(`prod-shaped local server: http://localhost:${port}  (dist=${dist}, runs=${runsDir})`);
