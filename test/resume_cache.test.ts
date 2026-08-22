// Resume/cache integration (docs/plans/etl_testing.md §3, M3): a killed run
// resumes at record level off the same cache file, with zero client calls for
// cached records and no duplicate rows. RED until runner + cache land.

import { describe, expect, test } from "bun:test";
import { expectJobReal, InjectedFault, withHarness } from "./harness.ts";
import { happyJ5 } from "./helpers/happy.ts";

describe("kill mid-batch, re-run with the same cache", () => {
  test("no duplicate rows; previously-written records untouched; cached records make zero client calls", async () => {
    await withHarness("resume-after-kill", async (h) => {
      h.stageFixtures("slice");

      // Run 1: killed after the first transactional batch write.
      h.failAt("s3_after_batch_write");
      h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const killed = await h.runJob("J5");
      if (killed.error && killed.error.name === "Unimplemented") {
        throw new Error(`enrichment path not implemented yet: ${killed.error.message}`);
      }
      expect(killed.error).toBeInstanceOf(InjectedFault);
      const partialRows = await h.rowsIn("enrich.j5_audit");
      expect(partialRows.length).toBeGreaterThan(0); // at least one batch landed
      const partialCache = h.cacheRows();
      expect(partialCache.length).toBeGreaterThan(0);
      const partialKeys = partialRows.map((r) => String(r.observation_id)).sort();

      // Run 2: same workspace, same cache file, fault disarmed.
      h.clearFault();
      const client2 = h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const resumed = await h.runJob("J5");
      expectJobReal(resumed);
      expect(resumed.error).toBeNull();

      const rows = await h.rowsIn("enrich.j5_audit");
      // No duplicates: one row per record.
      const ids = rows.map((r) => String(r.observation_id));
      expect(new Set(ids).size).toBe(ids.length);
      // Previously-written records are untouched (still present, same ids).
      for (const k of partialKeys) expect(ids).toContain(k);
      // Cached records made zero client calls: run 2's calls cover only the
      // remainder, and the cache-hit count says so.
      expect(resumed.coverage?.cached_hit ?? 0).toBeGreaterThanOrEqual(partialCache.length);
      expect(client2.callCount).toBe(ids.length - (resumed.coverage?.cached_hit ?? 0));
      // Cache spy saw a get for every selected record.
      expect(h.cacheSpy.gets.length).toBeGreaterThanOrEqual(ids.length);
    });
  }, 30_000);

  test("--recache is the only path that drops cache rows", async () => {
    await withHarness("recache-explicit", async (h) => {
      h.stageFixtures("slice");
      h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const first = await h.runJob("J5");
      expectJobReal(first);
      const cachedBefore = h.cacheRows().length;
      expect(cachedBefore).toBeGreaterThan(0);

      // Plain re-run: cache intact, zero new calls.
      const client2 = h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const second = await h.runJob("J5");
      expectJobReal(second);
      expect(client2.callCount).toBe(0);
      expect(h.cacheRows().length).toBe(cachedBefore);

      // Explicit --recache: every record re-called.
      const client3 = h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const third = await h.runJob("J5", { recache: true });
      expectJobReal(third);
      expect(client3.callCount).toBeGreaterThan(0);
      expect(third.coverage?.cached_hit).toBe(0);
    });
  }, 30_000);
});

describe("enrich CLI", () => {
  test("etl enrich --job J5 runs the job through the CLI path", async () => {
    await withHarness("enrich-cli-j5", async (h) => {
      h.stageFixtures("slice");
      h.injectResponses({ perJob: { J5: [happyJ5()] }, repeatLast: true });
      const r = await h.runEnrichCli({ job: "J5" });
      if (r.unimplemented.length > 0) {
        throw new Error(`pipeline path not implemented yet: ${r.unimplemented.join(" | ")}`);
      }
      expect(r.exitCode).toBe(0);
      expect((await h.rowsIn("enrich.j5_audit")).length).toBeGreaterThan(0);
    });
  });

  test("etl enrich --job J9 fails with a clear unknown-job error (structural)", async () => {
    await withHarness("enrich-cli-unknown-job", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runEnrichCli({ job: "J9" });
      expect(r.exitCode).toBe(1);
      const fatal = r.logs.find((l) => l.event === "fatal");
      expect(String(fatal?.message)).toContain("unknown enrichment job");
    });
  });
});
