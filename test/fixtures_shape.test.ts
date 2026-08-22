// Structural fixture checks (legitimately green): the checked-in fixtures are
// themselves inputs to every red test, so their shape is validated
// independently — a fixture regression must fail here, loudly, not as a
// mysterious stage failure (docs/plans/etl_testing.md §6).

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRules } from "../etl/context.ts";
import { RawObservationSchema, RawTraceSchema } from "../etl/schemas/raw.ts";
import {
  expectation,
  loadExpectations,
  loadFixtureJsonl,
  loadGoldenSnippets,
} from "./helpers/fixtures.ts";

const rules = await loadRules(join(import.meta.dir, "..", "etl", "rules"));
const patternIds = new Set(rules.signatures.signatures.map((s) => s.pattern_id));

describe("golden snippet fixtures", () => {
  test("every named trap case is present, non-empty, and points at a real rule", async () => {
    const cases = await loadGoldenSnippets();
    const names = cases.map((c) => c.name);
    for (const required of [
      "amount_403_must_not_match",
      "askuserquestion_exit1_uncertain",
      "agent_generic_error",
      "platform_limit_marker",
      "portal_auth_403_matches",
      "portal_token_missing",
      "cli_command_not_found",
      "missing_file_read",
    ]) {
      expect(names).toContain(required);
    }
    for (const c of cases) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.note.length).toBeGreaterThan(0);
      if (c.expected.pattern_id !== null) {
        expect(patternIds.has(c.expected.pattern_id)).toBe(true);
        const rule = rules.signatures.signatures.find(
          (s) => s.pattern_id === c.expected.pattern_id,
        );
        expect(rule?.counts_as_failure).toBe(c.expected.counts_as_failure as boolean | "uncertain");
      }
    }
  });

  test("the amount trap really contains a 403 digit-run inside an amount and no HTTP 403", async () => {
    const cases = await loadGoldenSnippets();
    const amount = cases.find((c) => c.name === "amount_403_must_not_match");
    expect(amount?.text).toMatch(/,403,/);
    expect(amount?.text).not.toMatch(/HTTP\s*403/);
    expect(amount?.expected.pattern_id).toBeNull();
  });

  test("golden observation rows exist inside the staged JSONL fixture", async () => {
    const cases = await loadGoldenSnippets();
    const staged = await loadFixtureJsonl("golden/staged/observations.jsonl");
    const stagedIds = new Set(staged.map((o) => o.id));
    const stagedTraces = await loadFixtureJsonl("golden/staged/traces.jsonl");
    const stagedTraceIds = new Set(stagedTraces.map((t) => t.id));
    for (const c of cases) {
      if (c.source.kind === "observation") expect(stagedIds.has(c.source.id)).toBe(true);
      if (c.source.kind === "trace_output") expect(stagedTraceIds.has(c.source.id)).toBe(true);
    }
  });
});

describe("the 5-session slice", () => {
  test("rows validate against the raw zod schemas", async () => {
    const traces = await loadFixtureJsonl("slice/traces.jsonl");
    const observations = await loadFixtureJsonl("slice/observations.jsonl");
    for (const t of traces) RawTraceSchema.parse(t);
    for (const o of observations) RawObservationSchema.parse(o);
    // Referentially closed: every observation's trace is in the slice.
    const traceIds = new Set(traces.map((t) => t.id));
    for (const o of observations) expect(traceIds.has(o.traceId)).toBe(true);
  });

  test("contains exactly the five designed sessions, incl. the resumed fragment", async () => {
    const traces = await loadFixtureJsonl("slice/traces.jsonl");
    const sessions = [
      ...new Set(traces.map((t) => (t.metadata as { session_id: string }).session_id)),
    ].sort();
    expect(sessions).toHaveLength(5);
    const prefixes = sessions.map((s) => s.slice(0, 8)).sort();
    expect(prefixes).toEqual(["327038b2", "49d43953", "7ab6b10b", "9b58b0bc", "eaec5bef"].sort());
    // The resumed fragment starts above turn 1 (derivations.md §3).
    const resumed = traces
      .filter((t) => (t.metadata as { session_id: string }).session_id.startsWith("49d43953"))
      .map((t) => (t.metadata as { turn_number: number }).turn_number);
    expect(Math.min(...resumed)).toBeGreaterThan(1);
  });

  test("expectations file: every entry carries provenance and a verified/estimated status", async () => {
    const all = await loadExpectations();
    expect(all.length).toBeGreaterThan(20);
    for (const e of all) {
      expect(["verified", "estimated"]).toContain(e.status);
      expect(e.provenance.length).toBeGreaterThan(10);
    }
    // Spot-check internal consistency against the fixture files themselves.
    const traces = await loadFixtureJsonl("slice/traces.jsonl");
    const observations = await loadFixtureJsonl("slice/observations.jsonl");
    expect(expectation(all, "slice.trace_count").value).toBe(traces.length);
    expect(expectation(all, "slice.observation_count").value).toBe(observations.length);
    expect(expectation(all, "session.resumed_fragment", "49d43953").value).toBe(true);
    expect(expectation(all, "session.turn_count", "327038b2").value).toBe(1);
  });
});

describe("violation fixtures", () => {
  test("fork fixture has overlapping turn ranges for one auditor+client", async () => {
    const traces = await loadFixtureJsonl("violations/fork/traces.jsonl");
    const bySession = new Map<string, { turns: number[]; ts: string[] }>();
    for (const t of traces) {
      const m = t.metadata as { session_id: string; turn_number: number; linux_user: string };
      const e = bySession.get(m.session_id) ?? { turns: [], ts: [] };
      e.turns.push(m.turn_number);
      e.ts.push(t.timestamp as string);
      bySession.set(m.session_id, e);
    }
    expect(bySession.size).toBe(2);
    const [a, b] = [...bySession.values()];
    if (!a || !b) throw new Error("fork fixture malformed");
    // Turn-number ranges overlap AND wall-clock windows overlap — the fork shape.
    expect(Math.min(...a.turns)).toBeLessThanOrEqual(Math.max(...b.turns));
    expect(Math.min(...b.turns)).toBeLessThanOrEqual(Math.max(...a.turns));
    const min = (xs: string[]) => xs.slice().sort()[0] ?? "";
    const max = (xs: string[]) => xs.slice().sort().at(-1) ?? "";
    expect(min(b.ts) < max(a.ts) && min(a.ts) < max(b.ts)).toBe(true);
  });

  test("referential fixture has exactly one dangling traceId", async () => {
    const traces = await loadFixtureJsonl("violations/referential/traces.jsonl");
    const observations = await loadFixtureJsonl("violations/referential/observations.jsonl");
    const traceIds = new Set(traces.map((t) => t.id));
    const dangling = observations.filter((o) => !traceIds.has(o.traceId));
    expect(dangling).toHaveLength(1);
  });

  test("timestamp fixture covers equal, out-of-order, cap-boundary and single-turn cases", async () => {
    const traces = await loadFixtureJsonl("violations/timestamps/traces.jsonl");
    const s1 = traces.filter((t) =>
      (t.metadata as { session_id: string }).session_id.startsWith("dddddddd"),
    );
    const ts = s1.map((t) => t.timestamp as string);
    expect(new Set(ts).size).toBeLessThan(ts.length); // an equal-timestamp pair
    const ordered = s1
      .sort(
        (a, b) =>
          (a.metadata as { turn_number: number }).turn_number -
          (b.metadata as { turn_number: number }).turn_number,
      )
      .map((t) => t.timestamp as string);
    expect(ordered.slice().sort().join()).not.toBe(ordered.join()); // order disagreement
    const singles = traces.filter((t) =>
      (t.metadata as { session_id: string }).session_id.startsWith("eeeeeeee"),
    );
    expect(singles).toHaveLength(1);
  });
});
