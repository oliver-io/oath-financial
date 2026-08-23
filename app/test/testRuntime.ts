// Test doubles for the render-smoke suite: a DbRuntime backed by
// @duckdb/node-api reading the checked-in fixture pack from disk, and a fetch
// stub serving /runs/* from the same directory. No network (app.md §7).
// The suite deliberately validates the checked-in fixture pack, not real build/serve runs.

import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DbRuntime } from "../src/data/runtime.ts";

export const FIXTURE_STATIC = join(import.meta.dir, "..", "..", "contracts", "fixtures", "static");

const posix = (p: string): string => p.replaceAll("\\", "/");

export async function createTestRuntime(runId: string): Promise<DbRuntime> {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  // loader SQL references partition paths relative to the run root
  await con.run(`SET file_search_path = '${posix(join(FIXTURE_STATIC, "runs", runId))}'`);
  return {
    async query(sql) {
      const reader = await con.runAndReadAll(sql);
      return reader.getRowObjects().map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) out[k] = typeof v === "bigint" ? Number(v) : v;
        return out;
      });
    },
    async run(sql) {
      await con.run(sql);
    },
    async registerBuffer() {
      // files resolve from disk via file_search_path; nothing to register
    },
    async dispose() {
      con.closeSync();
      instance.closeSync();
    },
  };
}

/** Routes /runs/* to the fixture pack on disk; everything else 404s. */
export function installFetchStub(): void {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.startsWith("/runs/")) {
      const file = Bun.file(join(FIXTURE_STATIC, path.slice(1)));
      if (await file.exists()) return new Response(await file.arrayBuffer(), { status: 200 });
      return new Response("not found", { status: 404 });
    }
    return orig(input as never, init);
  }) as typeof fetch;
}
