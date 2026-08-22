// Full-pipeline degraded mode (docs/plans/etl_testing.md §3, M2):
// `etl run --no-enrich` on the 5-session slice, asserting the published
// artifact. RED until stages 0-2/4-5 are implemented.

import { describe, expect, test } from "bun:test";
import { expectReal, withHarness } from "./harness.ts";
import { expectation, loadExpectations } from "./helpers/fixtures.ts";

const expectations = await loadExpectations();
const REF_FILES = [
  "sessions",
  "failure_signatures",
  "incidents",
  "capability_gaps",
  "gap_sessions",
  "findings",
  "auditor_timeline",
  "dims",
];

describe("etl run --no-enrich on the 5-session slice", () => {
  test("publishes the full partition + reference file set and repoints latest.json", async () => {
    await withHarness("degraded-publish-set", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      expect(r.exitCode).toBe(0);
      const latest = await h.latestPointer();
      const runId = String(latest?.run_id ?? "");
      expect(runId).not.toBe("");
      const files = h.publishedFiles();
      const days = expectation(expectations, "slice.event_days").value as string[];
      for (const day of days) {
        expect(files).toContain(`${runId}/facts/turns/day=${day}.parquet`);
        expect(files).toContain(`${runId}/facts/tool_events/day=${day}.parquet`);
      }
      for (const ref of REF_FILES) expect(files).toContain(`${runId}/ref/${ref}.parquet`);
      expect(files).toContain(`${runId}/manifest.json`);
      // No partitions outside the slice's event days.
      const partitionDays = files
        .filter((f) => f.startsWith(`${runId}/facts/turns/`))
        .map((f) => f.split("/").at(-1)?.replace("day=", "").replace(".parquet", ""));
      expect(partitionDays?.sort()).toEqual([...days].sort());
    });
  });

  test("degraded contract: enrichment columns all NULL, coverage empty, findings reduced to requires_enrichment=false", async () => {
    await withHarness("degraded-null-enrichment", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      const latest = await h.latestPointer();
      const runId = String(latest?.run_id ?? "");
      const sessions = await h.queryParquet(`${runId}/ref/sessions.parquet`);
      expect(sessions).toHaveLength(5);
      for (const s of sessions) {
        expect(s.outcome ?? null).toBeNull(); // NULL = job not run (etl.md stage 5)
        expect(s.job_type ?? null).toBeNull();
      }
      const manifest = (await h.manifests()).at(-1);
      expect(Object.keys(manifest?.enrichment ?? { sentinel: 1 })).toHaveLength(0);
      const findings = await h.queryParquet(`${runId}/ref/findings.parquet`);
      for (const f of findings) expect(f.requires_enrichment).toBe(false);
    });
  });

  test("known aggregate values from the expectations file hold in the published planes", async () => {
    await withHarness("degraded-known-values", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      const latest = await h.latestPointer();
      const runId = String(latest?.run_id ?? "");
      const sessions = await h.queryParquet(`${runId}/ref/sessions.parquet`);
      const ids = sessions.map((s) => String(s.session_id)).sort();
      expect(ids).toEqual(expectation(expectations, "slice.session_ids").value as string[]);
      for (const sid of ["49d43953", "7ab6b10b", "9b58b0bc", "327038b2", "eaec5bef"]) {
        const row = sessions.find((s) => String(s.session_id).startsWith(sid));
        expect(Number(row?.turn_count)).toBe(
          expectation(expectations, "session.turn_count", sid).value as number,
        );
      }
      const resumed = sessions.find((s) => String(s.session_id).startsWith("49d43953"));
      expect(resumed?.resumed_fragment).toBe(true);
      // Fact plane: total turn rows across partitions = slice trace count.
      const days = expectation(expectations, "slice.event_days").value as string[];
      let turnRows = 0;
      let toolEventRows = 0;
      for (const day of days) {
        turnRows += (await h.queryParquet(`${runId}/facts/turns/day=${day}.parquet`)).length;
        toolEventRows += (await h.queryParquet(`${runId}/facts/tool_events/day=${day}.parquet`))
          .length;
      }
      expect(turnRows).toBe(expectation(expectations, "slice.trace_count").value as number);
      expect(toolEventRows).toBe(
        expectation(expectations, "slice.tool_event_count").value as number,
      );
      // Estimated signature blast radius (TODO-implementation: reconcile exact
      // anchored semantics; the estimate is an upper bound from raw regex hits).
      const sigs = await h.queryParquet(`${runId}/ref/failure_signatures.parquet`);
      const portal = sigs.find((s) => String(s.pattern_id) === "portal-token-missing");
      const estimate = expectation(
        expectations,
        "slice.signature_event_estimate.portal-token-missing",
      ).value as number;
      expect(Number(portal?.event_count ?? 0)).toBeLessThanOrEqual(estimate);
      expect(Number(portal?.event_count ?? 0)).toBeGreaterThan(0);
    });
  });

  test("published manifest.json embeds the run manifest (rule hashes, coverage, partitions)", async () => {
    await withHarness("degraded-manifest-embed", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      const latest = await h.latestPointer();
      const runId = String(latest?.run_id ?? "");
      const embedded = (await Bun.file(
        `${h.dir}/build/serve/${runId}/manifest.json`,
      ).json()) as Record<string, unknown>;
      expect(embedded.run_id).toBe(runId);
      expect(Object.keys(embedded.rule_hashes ?? {})).toHaveLength(4);
      const manifests = await h.manifests();
      expect(manifests.map((m) => m.run_id)).toContain(runId);
    });
  });
});
