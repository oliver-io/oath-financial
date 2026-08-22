// DuckDB-WASM lifecycle — docs/plans/app.md §3 data/runtime.ts.
// The bundles are served from our own build (no CDN); all query results are
// normalized to plain JS objects (BigInt → Number) before they reach zod.

import * as duckdb from "@duckdb/duckdb-wasm";
// `?worker` lets Vite own the worker bootstrapping (the dist worker is a
// classic script the dev server would otherwise ESM-transform into a hang).
// The eh bundle is safe to pin: every supported browser has wasm exceptions.
import EhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";

export interface DbRuntime {
  query(sql: string): Promise<Record<string, unknown>[]>;
  run(sql: string): Promise<void>;
  registerBuffer(name: string, bytes: Uint8Array): Promise<void>;
  dispose(): Promise<void>;
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Uint8Array) return v;
  return v;
}

export async function createRuntime(): Promise<DbRuntime> {
  const worker = new EhWorker();
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(ehWasmUrl, null);
  const conn = await db.connect();

  return {
    async query(sql) {
      const table = await conn.query(sql);
      const rows: Record<string, unknown>[] = [];
      for (const row of table) {
        const obj = row.toJSON() as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = normalizeValue(v);
        rows.push(out);
      }
      return rows;
    },
    async run(sql) {
      await conn.query(sql);
    },
    async registerBuffer(name, bytes) {
      await db.registerFileBuffer(name, bytes);
    },
    async dispose() {
      await conn.close();
      await db.terminate();
      worker.terminate();
    },
  };
}
