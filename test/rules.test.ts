// Rule-file skeletons must parse and zod-validate (docs/plans/etl.md §3
// RuleSet: a rule file failing validation is a startup error). Phase-1 scope:
// shape only — golden signature behavior is phase 2.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRules } from "../etl/context.ts";

describe("etl/rules/*.yaml", () => {
  test("all four rule files parse and validate", async () => {
    const rules = await loadRules(join(import.meta.dir, "..", "etl", "rules"));
    expect(rules.signatures.signatures.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(rules.toolFamilies.families).length).toBe(69);
    expect(rules.thresholds.quick_restart_window_s).toBe(3600);
    expect(rules.thresholds.j5.unmatched_sample_n).toBe(150);
    expect(rules.thresholds.j5.matched_sample_m).toBe(100);
    expect(rules.findings.findings.length).toBeGreaterThan(0);
    expect(Object.keys(rules.hashes)).toHaveLength(4);
  });

  test("known gray-zone cases are curated as uncertain", async () => {
    const rules = await loadRules(join(import.meta.dir, "..", "etl", "rules"));
    const byId = new Map(rules.signatures.signatures.map((s) => [s.pattern_id, s]));
    expect(byId.get("askuserquestion-exit-1")?.counts_as_failure).toBe("uncertain");
    expect(byId.get("portal-auth-403")?.counts_as_failure).toBe(true);
    expect(byId.get("platform-limit")?.signature_class).toBe("platform_limit");
  });
});
