// Navigation smoke: URL → state → URL is byte-stable for representative
// filter/window states (app.md §7).

import { describe, expect, test } from "bun:test";
import { parseFilters, serializeFilters } from "../src/state/urlState.ts";

const CASES = [
  "",
  "from=2026-03-28&to=2026-04-01&signature=portal-auth-403",
  "from=2026-03-05&to=2026-04-02&client=meridian&entity=meridian-us&auditor=a.chen&job=tie_out%2Cdrafting&demo=1&group=client",
  "gap=gap-browser-grind",
  "session=excluded&from=2026-03-10&to=2026-03-20",
];

describe("url codec", () => {
  for (const c of CASES) {
    test(`round-trips "${c}"`, () => {
      const parsed = parseFilters(new URLSearchParams(c));
      const out = serializeFilters(parsed).toString();
      const again = serializeFilters(parseFilters(new URLSearchParams(out))).toString();
      expect(again).toBe(out);
    });
  }

  test("invalid window and unknown group are dropped", () => {
    const f = parseFilters(new URLSearchParams("from=2026-04-02&to=2026-03-01&group=bogus"));
    expect(f.window).toBeNull();
    expect(f.groupBy).toBe("none");
  });
});
