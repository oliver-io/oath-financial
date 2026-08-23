// The local/prod parity checklist, automated — docs/plans/infra.md §4 items 1–5.
// Item 6 (re-upload of an existing run id is a no-op or error) is a property of
// deploy-data.ts itself; this script prints a reminder for it.
// Usage: bun infra/scripts/parity-check.ts <base-url>
//   e.g. bun infra/scripts/parity-check.ts http://localhost:4173
//        bun infra/scripts/parity-check.ts https://dxxxx.cloudfront.net

export {}; // top-level await needs module context

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("usage: parity-check.ts <base-url>");
  process.exit(1);
}

interface Check {
  name: string;
  path: string;
  expectStatus: number;
  cacheControl?: string; // substring that must appear
  contentType?: string;
  expectHtml?: boolean; // body must (true) / must not (false) look like the SPA shell
}

const results: { name: string; ok: boolean; detail: string }[] = [];

async function run(c: Check): Promise<void> {
  try {
    const res = await fetch(`${base}${c.path}`, { headers: { accept: "*/*" } });
    const cc = res.headers.get("cache-control") ?? "";
    const ct = res.headers.get("content-type") ?? "";
    const problems: string[] = [];
    if (res.status !== c.expectStatus) problems.push(`status ${res.status} != ${c.expectStatus}`);
    if (c.cacheControl && !cc.includes(c.cacheControl))
      problems.push(`cache-control '${cc}' lacks '${c.cacheControl}'`);
    if (c.contentType && !ct.includes(c.contentType))
      problems.push(`content-type '${ct}' lacks '${c.contentType}'`);
    if (c.expectHtml !== undefined) {
      const isHtml = (await res.text()).trimStart().toLowerCase().startsWith("<!doctype html");
      if (isHtml !== c.expectHtml) problems.push(isHtml ? "got index.html" : "not the SPA shell");
    }
    results.push({
      name: c.name,
      ok: problems.length === 0,
      detail: problems.join("; ") || `${res.status} ${cc}`,
    });
  } catch (e) {
    results.push({ name: c.name, ok: false, detail: String(e) });
  }
}

// Discover the run + one fact partition from the live tree itself.
const latestRes = await fetch(`${base}/runs/latest.json`);
const latest = (await latestRes.json().catch(() => null)) as { run_id?: string } | null;
if (!latest?.run_id) {
  console.error(
    `FATAL: ${base}/runs/latest.json missing or malformed (status ${latestRes.status})`,
  );
  process.exit(1);
}
const runId = latest.run_id;
const manifest = (await (await fetch(`${base}/runs/${runId}/manifest.json`)).json()) as {
  partitions: { path: string }[];
};
const partition = manifest.partitions[0]?.path;

// Item 1 checks status/headers/run_id presence only — a deliberate, documented
// reduction of the plan's "valid per contracts schema" wording (no zod here).
await run({
  name: "1. latest.json 200 no-cache",
  path: "/runs/latest.json",
  expectStatus: 200,
  cacheControl: "no-cache",
  contentType: "json",
});
await run({
  name: "2. manifest.json 200 immutable",
  path: `/runs/${runId}/manifest.json`,
  expectStatus: 200,
  cacheControl: "immutable",
});
if (partition) {
  await run({
    name: "3. fact partition 200 immutable",
    path: `/runs/${runId}/${partition}`,
    expectStatus: 200,
    cacheControl: "immutable",
    contentType: "parquet",
  });
} else {
  results.push({ name: "3. fact partition", ok: false, detail: "manifest lists no partitions" });
}
await run({
  name: "4. SPA route -> index.html no-cache",
  path: "/ops/some/deep/route",
  expectStatus: 200,
  cacheControl: "no-cache",
  expectHtml: true,
});
await run({
  name: "5. missing partition -> real 404",
  path: `/runs/${runId}/facts/turns/day=1999-01-01.parquet`,
  expectStatus: 404,
  expectHtml: false,
});

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`);
  if (!r.ok) failed++;
}
console.log(
  "note  6. re-publish no-op/error is enforced by deploy-data.ts (run it twice to evidence)",
);
process.exit(failed === 0 ? 0 : 1);
