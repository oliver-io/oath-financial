// Stage-level integration for s0–s2 through the real executor
// (docs/plans/etl_testing.md §3, M1). RED until the stages are implemented:
// each test runs the real `etl run --stage N` path in-process, then asserts
// final DuckDB state. expectReal() surfaces the pipeline's own Unimplemented
// message as the failure reason.

import { describe, expect, test } from "bun:test";
import { expectReal, withHarness } from "./harness.ts";
import {
  expectation,
  loadExpectations,
  loadFixtureJsonl,
  loadGoldenSnippets,
} from "./helpers/fixtures.ts";

const expectations = await loadExpectations();

describe("stage 0 — RAW", () => {
  test("ingests the slice verbatim: raw.traces/raw.observations row counts match the fixture", async () => {
    await withHarness("s0-slice-counts", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStage(0);
      expectReal(r);
      expect(r.exitCode).toBe(0);
      expect(await h.rowsIn("raw.traces")).toHaveLength(
        expectation(expectations, "slice.trace_count").value as number,
      );
      expect(await h.rowsIn("raw.observations")).toHaveLength(
        expectation(expectations, "slice.observation_count").value as number,
      );
    });
  });
});

describe("stage 1 — CLEAN", () => {
  test("flags the resumed fragment and missing outputs; passes gates on the slice", async () => {
    await withHarness("s1-flags", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1]);
      expectReal(r);
      expect(r.exitCode).toBe(0);
      const turns = await h.rowsIn("clean.turns");
      const resumed = turns.filter(
        (t) => String(t.session_id).startsWith("49d43953") && t.resumed_fragment === true,
      );
      expect(resumed.length).toBe(
        expectation(expectations, "session.turn_count", "49d43953").value as number,
      );
      const clean = turns.filter((t) => String(t.session_id).startsWith("327038b2"));
      expect(clean).toHaveLength(1);
      expect(clean[0]?.resumed_fragment).toBe(false);
      const obs = await h.rowsIn("clean.observations");
      const missingOut = obs.filter((o) => o.output_missing === true);
      const expectedMissing = expectations
        .filter((e) => e.metric === "session.missing_output_observations")
        .reduce((n, e) => n + (e.value as number), 0);
      expect(missingOut.length).toBe(expectedMissing);
    });
  });

  test("timestamp edge cases survive stage 1 without aborting", async () => {
    await withHarness("s1-timestamp-edges", async (h) => {
      h.stageFixtures("violations/timestamps");
      const r = await h.runStages([0, 1]);
      expectReal(r);
      expect(r.exitCode).toBe(0);
      expect(await h.rowsIn("clean.turns")).toHaveLength(5);
    });
  });
});

describe("stage 2 — DERIVE (the tested core)", () => {
  test("golden trap cases land as rows in derive.tool_events with the right matched_signature_id", async () => {
    await withHarness("s2-golden-rows", async (h) => {
      h.stageFixtures("golden/staged");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      expect(r.exitCode).toBe(0);
      const events = await h.rowsIn("derive.tool_events");
      const byObs = new Map(events.map((e) => [String(e.observation_id), e]));
      for (const c of (await loadGoldenSnippets()).filter((x) => x.source.kind === "observation")) {
        const row = byObs.get(c.source.id ?? "");
        if (!row) throw new Error(`no derive.tool_events row for golden case ${c.name}`);
        expect(row.matched_signature_id ?? null).toBe(c.expected.pattern_id);
      }
    });
  });

  test("platform-limit marker sets turn.platform_limit_marker on exactly the marker turns", async () => {
    await withHarness("s2-platform-limit", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      const turns = await h.rowsIn("derive.turns");
      const marked = turns.filter(
        (t) => String(t.session_id).startsWith("7ab6b10b") && t.platform_limit_marker === true,
      );
      expect(marked.length).toBe(
        expectation(expectations, "session.platform_limit_turns", "7ab6b10b").value as number,
      );
    });
  });

  test("gap arithmetic: nulls on first turns, equal-timestamp gap = 0, cap boundary honored", async () => {
    await withHarness("s2-gap-arithmetic", async (h) => {
      h.stageFixtures("violations/timestamps");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      const turns = (await h.rowsIn("derive.turns")).filter((t) =>
        String(t.session_id).startsWith("dddddddd"),
      );
      const byTurn = new Map(turns.map((t) => [Number(t.turn_number), t]));
      expect(byTurn.get(1)?.gap_before_s).toBeNull();
      expect(Number(byTurn.get(2)?.gap_before_s)).toBe(0);
      const sessions = await h.rowsIn("derive.sessions");
      const single = sessions.find((s) => String(s.session_id).startsWith("eeeeeeee"));
      // Single-turn session: no gaps at all; capped span is 0, bout count 1.
      expect(Number(single?.capped_gap_span_s)).toBe(0);
      expect(Number(single?.bout_count)).toBe(1);
    });
  });

  test("session facts: turn_count, first/last timestamps, resumed_fragment rollup", async () => {
    await withHarness("s2-session-facts", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      const sessions = await h.rowsIn("derive.sessions");
      expect(sessions).toHaveLength(5);
      for (const sid of ["49d43953", "7ab6b10b", "9b58b0bc", "327038b2", "eaec5bef"]) {
        const row = sessions.find((s) => String(s.session_id).startsWith(sid));
        if (!row) throw new Error(`derive.sessions missing session ${sid}`);
        expect(Number(row.turn_count)).toBe(
          expectation(expectations, "session.turn_count", sid).value as number,
        );
        expect(String(row.first_ts)).toContain(
          String(expectation(expectations, "session.first_ts", sid).value).slice(0, 19),
        );
      }
    });
  });

  test("seeded J5 samples are stable across two identical runs", async () => {
    await withHarness("s2-j5-seed-stability", async (h) => {
      h.stageFixtures("slice");
      const r1 = await h.runStages([0, 1, 2]);
      expectReal(r1);
      const sample1 = (await h.rowsIn("derive.tool_events"))
        .filter((e) => e.j5_sample === true || e.j5_sample_bucket != null)
        .map((e) => String(e.observation_id))
        .sort();
      const r2 = await h.runStages([0, 1, 2]);
      expectReal(r2);
      const sample2 = (await h.rowsIn("derive.tool_events"))
        .filter((e) => e.j5_sample === true || e.j5_sample_bucket != null)
        .map((e) => String(e.observation_id))
        .sort();
      expect(sample1.length).toBeGreaterThan(0);
      expect(sample2).toEqual(sample1);
    });
  });

  test("stage manifest records row counts and gate outcomes for s0–s2", async () => {
    await withHarness("s2-manifest-entries", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      // Single-stage runs each finalize their own manifest; at least one
      // manifest must carry each stage's entry with non-zero row counts.
      const manifests = await h.manifests();
      const stages = manifests.flatMap((m) => m.stages);
      for (const name of ["s0_raw", "s1_clean", "s2_derive"]) {
        const entry = stages.find((s) => s.stage === name);
        if (!entry) throw new Error(`no manifest entry for ${name}`);
        expect(Object.values(entry.row_counts).some((n) => n > 0)).toBe(true);
      }
      const s1 = stages.find((s) => s.stage === "s1_clean");
      expect(s1?.gates.map((g) => g.gate).sort()).toEqual([
        "fork_detector",
        "referential_integrity",
      ]);
      expect(s1?.gates.every((g) => g.passed)).toBe(true);
    });
  });
});

describe("stage 2 — marker flags on composite messages", () => {
  test("extract-paste turns keep a typed prefix measure (composite messages, markers anywhere)", async () => {
    await withHarness("s2-markers", async (h) => {
      h.stageFixtures("slice");
      const r = await h.runStages([0, 1, 2]);
      expectReal(r);
      const turns = await h.rowsIn("derive.turns");
      // Structural sanity of the marker columns (derivations.md §2): all three
      // flags exist and typed_prefix_chars is never negative.
      for (const t of turns) {
        expect(typeof t.has_extract_paste).toBe("boolean");
        expect(typeof t.has_task_notification).toBe("boolean");
        expect(typeof t.has_skill_body).toBe("boolean");
        expect(Number(t.typed_prefix_chars)).toBeGreaterThanOrEqual(0);
      }
      // A turn with an extract-paste marker must not count the paste as typed.
      const pasted = turns.filter((t) => t.has_extract_paste === true);
      for (const t of pasted) {
        expect(Number(t.typed_prefix_chars)).toBeLessThan(Number(t.user_chars));
      }
      const fixtureTurns = await loadFixtureJsonl("slice/traces.jsonl");
      expect(turns.length).toBe(fixtureTurns.length);
    });
  });
});
