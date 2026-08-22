// Optional local-inspection artifact (`etl run --sqlite`): copies the
// pipeline's derive/agg/enrich tables into build/inspect.sqlite so anyone with
// stock sqlite tooling can poke at intermediate state. NEVER served — the
// serving artifact is the stage-5 Parquet tree (docs/architecture/etl.md).
// Rows travel as DuckDB-side to_json() so exotic value types (timestamps,
// lists) arrive as plain JSON; scalars keep native sqlite types, nested values
// are stored as JSON text (same convention as the published contracts).

import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "../context.ts";
import { queryRows } from "./duckdb.ts";

const INSPECT_SCHEMAS = ["derive", "agg", "enrich"];

function columnAffinity(values: unknown[]): string {
  const sample = values.find((v) => v !== null && v !== undefined);
  if (typeof sample === "boolean") return "INTEGER";
  if (typeof sample === "number") return Number.isInteger(sample) ? "INTEGER" : "REAL";
  return "TEXT";
}

function toSqliteValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Writes build/inspect.sqlite from the current pipeline database. Replaces
 * any previous artifact (inspection is a point-in-time copy, not a log). */
export async function writeInspectArtifact(ctx: RunContext): Promise<void> {
  const outPath = join(ctx.paths.build, "inspect.sqlite");
  rmSync(outPath, { force: true });
  const out = new Database(outPath, { create: true });
  try {
    const tables = await queryRows(
      ctx.db,
      `SELECT table_schema AS s, table_name AS t
       FROM information_schema.tables
       WHERE table_schema IN (${INSPECT_SCHEMAS.map((s) => `'${s}'`).join(", ")})
       ORDER BY table_schema, table_name`,
    );
    let tableCount = 0;
    for (const row of tables) {
      const schema = String(row.s);
      const table = String(row.t);
      const rows = await queryRows(
        ctx.db,
        `SELECT CAST(to_json(x) AS VARCHAR) AS j FROM "${schema}"."${table}" x`,
      );
      const parsed = rows.map((r) => JSON.parse(String(r.j)) as Record<string, unknown>);
      const colRows = await queryRows(
        ctx.db,
        `SELECT column_name AS c FROM information_schema.columns
         WHERE table_schema = '${schema}' AND table_name = '${table}'
         ORDER BY ordinal_position`,
      );
      const cols = colRows.map((c) => String(c.c));
      const defs = cols.map((c) => `"${c}" ${columnAffinity(parsed.map((p) => p[c]))}`).join(", ");
      const target = `${schema}_${table}`;
      out.run(`CREATE TABLE "${target}" (${defs})`);
      const insert = out.prepare(
        `INSERT INTO "${target}" VALUES (${cols.map(() => "?").join(", ")})`,
      );
      const insertAll = out.transaction((batch: Record<string, unknown>[]) => {
        for (const p of batch) insert.run(...cols.map((c) => toSqliteValue(p[c])));
      });
      insertAll(parsed);
      tableCount += 1;
    }
    ctx.log.info("s5_publish", "inspect_artifact", { path: outPath, tables: tableCount });
  } finally {
    out.close();
  }
}
