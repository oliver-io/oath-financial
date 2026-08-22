// Publish atomicity (docs/plans/etl_testing.md §3, M2): write everything,
// fsync, swap latest.json LAST. A kill between partition writes and the
// pointer swap must leave the previous run live and the half-written dir
// inert; a re-run recovers cleanly. RED until stage 5 is implemented.

import { describe, expect, test } from "bun:test";
import { expectReal, withHarness } from "./harness.ts";

describe("latest.json pointer swap ordering", () => {
  test("a fault after partition writes leaves latest.json on the prior run; re-run recovers", async () => {
    await withHarness("publish-atomicity", async (h) => {
      h.stageFixtures("slice");
      // Run 1: clean baseline.
      const r1 = await h.runPipeline({ noEnrich: true });
      expectReal(r1);
      expect(r1.exitCode).toBe(0);
      const run1 = String((await h.latestPointer())?.run_id ?? "");
      expect(run1).not.toBe("");

      // Run 2: killed between partition writes and the swap.
      h.failAt("s5_after_partition_writes");
      const r2 = await h.runPipeline({ noEnrich: true });
      expectReal(r2);
      expect(r2.exitCode).not.toBe(0);
      const pointerAfterKill = await h.latestPointer();
      expect(String(pointerAfterKill?.run_id)).toBe(run1); // still the prior run
      // The half-written run dir is inert: it exists but is not referenced.
      const orphans = new Set(
        h
          .publishedFiles()
          .map((f) => f.split("/")[0])
          .filter((d) => d !== run1 && d !== "latest.json"),
      );
      expect(orphans.size).toBeLessThanOrEqual(1);

      // Run 3: fault disarmed — clean recovery repoints to the new run.
      h.clearFault();
      const r3 = await h.runPipeline({ noEnrich: true });
      expectReal(r3);
      expect(r3.exitCode).toBe(0);
      const run3 = String((await h.latestPointer())?.run_id ?? "");
      expect(run3).not.toBe(run1);
      const files = h.publishedFiles();
      expect(files.some((f) => f === `${run3}/manifest.json`)).toBe(true);
    });
  }, 30_000);
});
