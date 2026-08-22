// Gate/abort integration (docs/plans/etl_testing.md §3): gate behavior is only
// trusted as observed through the real executor. RED until stages + executor
// are implemented.

import { describe, expect, test } from "bun:test";
import { expectReal, withHarness } from "./harness.ts";

describe("fork gate", () => {
  test("overlapping turn-number ranges per auditor+client abort the run with exit 2", async () => {
    await withHarness("gate-fork-abort", async (h) => {
      h.stageFixtures("violations/fork");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      expect(r.exitCode).toBe(2);
      // Abort happens before the next stage's schema exists.
      expect(await h.tableExists("derive.tool_events")).toBe(false);
      expect(await h.tableExists("derive.turns")).toBe(false);
      // And nothing was published.
      expect(h.publishedFiles()).toEqual([]);
    });
  });

  test("the gate report lands in the manifest with passed=false and a detail", async () => {
    await withHarness("gate-fork-manifest", async (h) => {
      h.stageFixtures("violations/fork");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      expect(r.exitCode).toBe(2);
      const manifests = await h.manifests();
      const gates = manifests.flatMap((m) => m.stages).flatMap((s) => s.gates);
      const fork = gates.find((g) => g.gate === "fork_detector");
      if (!fork) throw new Error("fork_detector gate result missing from manifest");
      expect(fork.passed).toBe(false);
      expect(String(fork.detail)).not.toBe("");
    });
  });
});

describe("referential gate", () => {
  test("an observation with an unknown traceId aborts with exit 2 before derive exists", async () => {
    await withHarness("gate-referential-abort", async (h) => {
      h.stageFixtures("violations/referential");
      const r = await h.runPipeline({ noEnrich: true });
      expectReal(r);
      expect(r.exitCode).toBe(2);
      expect(await h.tableExists("derive.tool_events")).toBe(false);
      const manifests = await h.manifests();
      const gates = manifests.flatMap((m) => m.stages).flatMap((s) => s.gates);
      const ref = gates.find((g) => g.gate === "referential_integrity");
      expect(ref?.passed).toBe(false);
    });
  });
});

describe("gates on healthy data", () => {
  test("the slice passes both gates and the run continues", async () => {
    await withHarness("gate-healthy-slice", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1]);
      expectReal(r);
      expect(r.exitCode).toBe(0);
      expect(await h.tableExists("clean.turns")).toBe(true);
    });
  });
});
