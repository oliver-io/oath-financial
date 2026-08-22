// deploy:data — publish an ETL serve tree (or the fixture pack) to the stack.
// Atomicity is ordering (plan §3): upload the complete immutable run tree,
// verify it, THEN swap runs/latest.json, THEN invalidate only that path.
// Usage: bun infra/scripts/deploy-data.ts [--source build/serve] [--stack dev]
//        [--run <run_id>] [--prune]
// The source dir must contain runs/latest.json and runs/<run_id>/…
// (contracts/fixtures/static works identically until ETL M2 — plan §3).

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CC_IMMUTABLE,
  CC_NO_CACHE,
  argValue,
  hasFlag,
  invalidate,
  listKeys,
  putFile,
  s3,
  stackOutputs,
  walk,
} from "./lib.ts";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const source = argValue("--source", "build/serve");
const stack = argValue("--stack", "dev");
const runsDir = join(source, "runs");
if (!existsSync(join(runsDir, "latest.json"))) {
  console.error(`no runs/latest.json under '${source}' — pass --source <dir>`);
  process.exit(1);
}

const latestPath = join(runsDir, "latest.json");
const latest = JSON.parse(await Bun.file(latestPath).text()) as { run_id: string };
const runId = argValue("--run", latest.run_id);
const runDir = join(runsDir, runId);
if (!existsSync(runDir)) {
  console.error(`run dir '${runDir}' does not exist`);
  process.exit(1);
}

const outputs = await stackOutputs(stack);
const bucket = outputs.bucketName;
const prefix = `runs/${runId}/`;
const files = walk(runDir);

// Cross-check the local tree against its manifest before anything ships.
const manifest = JSON.parse(await Bun.file(join(runDir, "manifest.json")).text()) as {
  partitions: { path: string }[];
  ref: { path: string }[];
};
const expected = manifest.partitions.length + manifest.ref.length + 1; // + manifest.json
if (files.length < expected) {
  console.error(`local run tree incomplete: ${files.length} files, manifest expects >= ${expected}`);
  process.exit(1);
}

// Parity item 6: a run id already published is a no-op (matching) or an error
// (mismatched) — never a silent overwrite.
const existing = await listKeys(bucket, prefix);
if (existing.length > 0) {
  if (existing.length === files.length) {
    console.log(`run '${runId}' already published (${existing.length} objects) — skipping upload`);
  } else {
    console.error(
      `run '${runId}' exists remotely with ${existing.length} objects but local has ${files.length} — refusing to overwrite`,
    );
    process.exit(1);
  }
} else {
  console.log(`uploading ${files.length} objects to s3://${bucket}/${prefix} (immutable)`);
  for (const rel of files) {
    await putFile(bucket, `${prefix}${rel}`, join(runDir, rel), CC_IMMUTABLE);
  }
  // Verify BEFORE the pointer swap: latest.json must never reference a
  // partially-present run.
  const uploaded = await listKeys(bucket, prefix);
  if (uploaded.length !== files.length) {
    console.error(`verification failed: ${uploaded.length} remote vs ${files.length} local — latest.json NOT swapped`);
    process.exit(1);
  }
  console.log(`verified ${uploaded.length}/${files.length} objects`);
}

// The swap: the only mutable data object, uploaded last, no-cache.
const pointer = JSON.stringify({ ...latest, run_id: runId });
await s3.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: "runs/latest.json",
    Body: pointer,
    CacheControl: CC_NO_CACHE,
    ContentType: "application/json",
  }),
);
console.log(`swapped runs/latest.json -> ${runId}`);

await invalidate(outputs.distributionId, ["/runs/latest.json"]);
console.log("invalidated /runs/latest.json");

if (hasFlag("--prune")) {
  const all = await listKeys(bucket, "runs/");
  const stale = all.filter((k) => k !== "runs/latest.json" && !k.startsWith(prefix));
  if (stale.length > 0) {
    console.log(`--prune: deleting ${stale.length} objects from other runs`);
    for (let i = 0; i < stale.length; i += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }
}

console.log(`done: ${outputs.siteUrl ?? `https://${outputs.distributionDomain}`}/runs/latest.json`);
