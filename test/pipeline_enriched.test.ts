// Full-pipeline enriched run (docs/plans/etl_testing.md §3, M3): the same
// slice with scripted responses at the client seam; assert the enriched deltas
// and that NOTHING ELSE changed — the degradation contract, exercised.
// RED until the pipeline is implemented.

import { describe, expect, test } from "bun:test";
import { expectReal, withHarness } from "./harness.ts";
import { expectation, loadExpectations } from "./helpers/fixtures.ts";
import { happyJ1, happyJ2, happyJ3, happyJ4, happyJ5 } from "./helpers/happy.ts";

const expectations = await loadExpectations();
const sliceSessionIds = (await loadExpectations()).find((e) => e.metric === "slice.session_ids")
  ?.value as string[];

const fullHappyScript = () => ({
  perJob: {
    J1: [happyJ1()],
    J2: [happyJ2()],
    J3: [happyJ3()],
    J4: [happyJ4([sliceSessionIds[0] ?? ""])],
    J5: [happyJ5()],
  },
  repeatLast: true,
});

describe("etl run with scripted enrichment on the 5-session slice", () => {
  test("enriched deltas appear and nothing else changes vs the degraded run", async () => {
    await withHarness("enriched-vs-degraded", async (h) => {
      h.stageFixtures("slice");
      // Degraded baseline first.
      const degraded = await h.runPipeline({ noEnrich: true });
      expectReal(degraded);
      expect(degraded.exitCode).toBe(0);
      const degradedLatest = await h.latestPointer();
      const degradedRun = String(degradedLatest?.run_id ?? "");
      const degradedFiles = h
        .publishedFiles()
        .filter((f) => f.startsWith(degradedRun))
        .map((f) => f.slice(degradedRun.length));
      const degradedSessions = await h.queryParquet(`${degradedRun}/ref/sessions.parquet`);

      // Enriched run: same fixtures, scripted client at the seam.
      h.injectResponses(fullHappyScript());
      const enriched = await h.runPipeline({});
      expectReal(enriched);
      expect(enriched.exitCode).toBe(0);
      const enrichedRun = String((await h.latestPointer())?.run_id ?? "");
      expect(enrichedRun).not.toBe(degradedRun);

      // Same file SET (relative to the run dir) — enrichment adds values, not files.
      const enrichedFiles = h
        .publishedFiles()
        .filter((f) => f.startsWith(enrichedRun))
        .map((f) => f.slice(enrichedRun.length));
      expect(enrichedFiles).toEqual(degradedFiles);

      // Deltas: model-class session fields flip from NULL to scripted values...
      const sessions = await h.queryParquet(`${enrichedRun}/ref/sessions.parquet`);
      for (const s of sessions) {
        expect(s.outcome).toBe("completed");
        expect(s.job_type).toBe("tie_out");
      }
      // ...while every structural fact is byte-identical to the degraded run.
      const structural = ["session_id", "turn_count", "first_ts", "last_ts", "resumed_fragment"];
      const key = (r: Record<string, unknown>) => String(r.session_id);
      const before = new Map(degradedSessions.map((r) => [key(r), r]));
      for (const after of sessions) {
        const b = before.get(key(after));
        for (const col of structural) expect(String(after[col])).toBe(String(b?.[col]));
      }
      // Coverage lands in the manifest for every job that ran.
      const manifest = (await h.manifests()).find((m) => m.run_id === enrichedRun);
      const jobs = Object.keys(manifest?.enrichment ?? {}).sort();
      expect(jobs).toEqual(["J1", "J2", "J3", "J4", "J5"]);
      for (const j of jobs) {
        const cov = manifest?.enrichment[j];
        expect((cov?.judged ?? 0) + (cov?.abstained ?? 0) + (cov?.error ?? 0)).toBeGreaterThan(0);
      }
    });
  });

  test("J2 coverage denominator equals the slice turn count (exactly-one-row invariant, whole run)", async () => {
    await withHarness("enriched-j2-denominator", async (h) => {
      h.stageFixtures("slice");
      h.injectResponses(fullHappyScript());
      const r = await h.runPipeline({});
      expectReal(r);
      const manifest = (await h.manifests()).at(-1);
      const j2 = manifest?.enrichment.J2;
      const total = (j2?.judged ?? 0) + (j2?.abstained ?? 0) + (j2?.error ?? 0);
      expect(total).toBe(expectation(expectations, "slice.trace_count").value as number);
    });
  });
});
