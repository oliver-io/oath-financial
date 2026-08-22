// Golden signature cases — the fast compiled-ruleset unit loop
// (docs/plans/etl.md §6; docs/plans/etl_testing.md §3: this loop stays as the
// fast inner check; the stage-level assertions in stages.test.ts are the
// authority). RED until etl/lib/signatures.ts is implemented.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRules } from "../etl/context.ts";
import { compileSignatures, matchSignatures } from "../etl/lib/signatures.ts";
import { loadGoldenSnippets } from "./helpers/fixtures.ts";

const rules = await loadRules(join(import.meta.dir, "..", "etl", "rules"));
const cases = await loadGoldenSnippets();

describe("compiled signature ruleset over golden snippets", () => {
  test("every signatures.yaml pattern compiles at startup", () => {
    const compiled = compileSignatures(rules.signatures);
    expect(compiled.signatures).toHaveLength(rules.signatures.signatures.length);
    expect(compiled.version).toBe(rules.signatures.version);
  });

  for (const c of cases.filter((x) => x.expected.pattern_id !== null)) {
    test(`${c.name}: matches ${c.expected.pattern_id} with counts_as_failure=${String(c.expected.counts_as_failure)}`, () => {
      const compiled = compileSignatures(rules.signatures);
      const matches = matchSignatures(compiled, c.text);
      const hit = matches.find((m) => m.patternId === c.expected.pattern_id);
      if (!hit) {
        throw new Error(
          `expected ${c.expected.pattern_id} to match; got [${matches.map((m) => m.patternId).join(", ")}] — ${c.note}`,
        );
      }
      expect(hit.countsAsFailure).toBe(c.expected.counts_as_failure as boolean | "uncertain");
      expect(c.text.slice(hit.matchIndex, hit.matchIndex + hit.matchedText.length)).toBe(
        hit.matchedText,
      );
    });
  }

  test("amount_403_must_not_match: monetary 403 digit-run matches NO failure signature", () => {
    const c = cases.find((x) => x.name === "amount_403_must_not_match");
    if (!c) throw new Error("golden case missing");
    const compiled = compileSignatures(rules.signatures);
    const matches = matchSignatures(compiled, c.text);
    expect(matches).toEqual([]);
  });

  test("http_5xx anchoring: the 5xx pattern never matches the amount on the same snippet", () => {
    const c = cases.find((x) => x.name === "http_5xx_synthetic");
    if (!c) throw new Error("golden case missing");
    const compiled = compileSignatures(rules.signatures);
    const matches = matchSignatures(compiled, c.text);
    expect(matches.map((m) => m.patternId)).toEqual(["tool-http-5xx"]);
    expect(c.text.slice(matches[0]?.matchIndex ?? 0)).toStartWith("HTTP 502");
  });
});
