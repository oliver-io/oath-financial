// DuckDB-under-Bun smoke test — the one stack risk, verified first
// (docs/plans/etl.md §1 and §7 M0). If this fails on this platform, the
// pre-authorized fallback is swapping the executor to the duckdb CLI —
// a recorded decision, never a silent one.

import { describe, expect, test } from "bun:test";
import { openDuckDb, queryRows } from "../etl/lib/duckdb.ts";

describe("@duckdb/node-api under Bun", () => {
  test("opens a database, runs a query, returns rows, closes", async () => {
    const session = await openDuckDb(":memory:");
    try {
      const rows = await queryRows(session, "SELECT 21 * 2 AS answer, 'ok' AS status");
      expect(rows).toEqual([{ answer: 42, status: "ok" }]);
    } finally {
      session.close();
    }
  });
});
