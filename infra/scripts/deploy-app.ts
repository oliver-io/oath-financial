// deploy:app — vite build, then publish app/dist: hashed assets immutable,
// index.html last with no-cache, invalidate exactly /index.html (plan §3).
// Vite copies its publicDir (the fixture pack) into dist/runs — the data plane
// belongs to deploy:data, so dist/runs is EXCLUDED here.
// Usage: bun infra/scripts/deploy-app.ts [--stack dev] [--no-build]

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  argValue,
  CC_IMMUTABLE,
  CC_NO_CACHE,
  hasFlag,
  invalidate,
  putFile,
  stackOutputs,
  walk,
} from "./lib.ts";

const stack = argValue("--stack", "dev");
const appDir = "app";
const dist = join(appDir, "dist");

if (!hasFlag("--no-build")) {
  console.log("building the SPA (vite build)…");
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: appDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) process.exit(1);
}
if (!existsSync(join(dist, "index.html"))) {
  console.error(`no ${dist}/index.html — build failed?`);
  process.exit(1);
}

const outputs = await stackOutputs(stack);
const bucket = outputs.bucketName;

const files = walk(dist).filter((f) => f !== "index.html" && !f.startsWith("runs/"));
console.log(`uploading ${files.length} static files (index.html last)`);
for (const rel of files) {
  // Only Vite's content-hashed output is immutable; other root files
  // (favicon etc.) are conservatively no-cache.
  const cc = rel.startsWith("assets/") ? CC_IMMUTABLE : CC_NO_CACHE;
  await putFile(bucket, rel, join(dist, rel), cc);
}
await putFile(bucket, "index.html", join(dist, "index.html"), CC_NO_CACHE);
console.log("uploaded index.html (no-cache)");

await invalidate(outputs.distributionId, ["/index.html"]);
console.log(`done: ${outputs.siteUrl ?? `https://${outputs.distributionDomain}`}`);
