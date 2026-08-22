// latest.json → manifest → window-selected partition fetch — app.md §3/§4.
// Partitions are content-addressed by run id and cached immutably by the
// browser; in-session we additionally keep a registered-file registry so a
// partition is fetched at most once. A malformed manifest is a surfaced error
// state, not a crash.

import {
  type FactPartition,
  LatestPointerSchema,
  type ServeManifest,
  ServeManifestSchema,
} from "@trace-insights/contracts";
import type { DbRuntime } from "./runtime.ts";

/** Path-relative base per infrastructure.md §2 — the M2 flip is this one value
 * (dev: the fixture pack under /runs; production: the object-store prefix). */
export const DATA_BASE_URL = "/runs";

export interface DegradedContext {
  /** True when a job is absent from manifest.enrichment — M-chipped constructs
   * read these to render their degraded captions. */
  j1: boolean;
  j2: boolean;
  j3: boolean;
  j4: boolean;
  j5: boolean;
  any: boolean;
}

export class LoaderError extends Error {
  constructor(
    message: string,
    readonly kind: "latest" | "manifest" | "partition" | "ref",
  ) {
    super(message);
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new LoaderError(`${url}: HTTP ${res.status}`, "partition");
  return new Uint8Array(await res.arrayBuffer());
}

export class DataStore {
  manifest!: ServeManifest;
  degraded!: DegradedContext;
  private registered = new Set<string>();
  private currentWindowKey = "";

  constructor(
    private readonly db: DbRuntime,
    private readonly baseUrl: string = DATA_BASE_URL,
  ) {}

  /** Boot: latest.json → manifest (zod-validated) → reference plane. */
  async init(runId?: string): Promise<void> {
    let id = runId;
    if (!id) {
      const latestRes = await fetch(`${this.baseUrl}/latest.json`);
      if (!latestRes.ok) throw new LoaderError(`latest.json: HTTP ${latestRes.status}`, "latest");
      const latest = LatestPointerSchema.safeParse(await latestRes.json().catch(() => null));
      if (!latest.success) throw new LoaderError("latest.json is malformed", "latest");
      id = latest.data.run_id;
    }
    const manifestRes = await fetch(`${this.baseUrl}/${id}/manifest.json`);
    if (!manifestRes.ok)
      throw new LoaderError(`manifest.json: HTTP ${manifestRes.status}`, "manifest");
    const parsed = ServeManifestSchema.safeParse(await manifestRes.json().catch(() => null));
    if (!parsed.success)
      throw new LoaderError(
        `manifest.json failed contract validation: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        "manifest",
      );
    this.manifest = parsed.data;
    const jobs = new Set(Object.keys(this.manifest.enrichment));
    const missing = (j: string) => !jobs.has(j);
    this.degraded = {
      j1: missing("J1"),
      j2: missing("J2"),
      j3: missing("J3"),
      j4: missing("J4"),
      j5: missing("J5"),
      any: ["J1", "J2", "J3", "J4", "J5"].some(missing),
    };
    // reference plane: always fetched whole; one DuckDB view per table
    for (const ref of this.manifest.ref) {
      // registered under the run-relative path so any runtime that resolves
      // paths from the run root (e.g. the disk-backed test runtime) matches
      const bytes = await fetchBytes(`${this.baseUrl}/${id}/${ref.path}`);
      await this.db.registerBuffer(ref.path, bytes);
      await this.db.run(
        `CREATE OR REPLACE VIEW ${ref.table} AS SELECT * FROM read_parquet('${ref.path}')`,
      );
    }
  }

  partitionsForWindow(fromDay: string, toDay: string): FactPartition[] {
    return this.manifest.partitions.filter((p) => p.day >= fromDay && p.day <= toDay);
  }

  /** Window change: fetch only missing partitions, rebuild the fact views.
   * `onProgress` drives per-partition loading skeletons. */
  async ensureWindow(
    fromDay: string,
    toDay: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const key = `${fromDay}..${toDay}`;
    const needed = this.partitionsForWindow(fromDay, toDay);
    const toFetch = needed.filter((p) => !this.registered.has(p.path));
    let done = 0;
    onProgress?.(0, toFetch.length);
    const runId = this.manifest.run_id;
    await Promise.all(
      toFetch.map(async (p) => {
        const bytes = await fetchBytes(`${this.baseUrl}/${runId}/${p.path}`);
        await this.db.registerBuffer(p.path, bytes);
        this.registered.add(p.path);
        done += 1;
        onProgress?.(done, toFetch.length);
      }),
    );
    if (key === this.currentWindowKey) return;
    for (const table of ["turns", "tool_events"] as const) {
      const files = needed.filter((p) => p.table === table).map((p) => `'${p.path}'`);
      if (files.length > 0) {
        await this.db.run(
          `CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet([${files.join(", ")}])`,
        );
      } else {
        // empty window: keep the schema by reading any partition with a false filter
        const any = this.manifest.partitions.find((p) => p.table === table);
        if (any) {
          if (!this.registered.has(any.path)) {
            const bytes = await fetchBytes(`${this.baseUrl}/${runId}/${any.path}`);
            await this.db.registerBuffer(any.path, bytes);
            this.registered.add(any.path);
          }
          await this.db.run(
            `CREATE OR REPLACE VIEW ${table} AS SELECT * FROM read_parquet('${any.path}') WHERE 1 = 0`,
          );
        }
      }
    }
    this.currentWindowKey = key;
  }

  query(sql: string): Promise<Record<string, unknown>[]> {
    return this.db.query(sql);
  }

  // Window changes swap the shared fact views, so window-scoped work is
  // serialized on one chain: a query can never see another window's views.
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** ensureWindow + query, atomically with respect to other windowed queries. */
  queryInWindow(
    fromDay: string,
    toDay: string,
    sql: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<string, unknown>[]> {
    return this.enqueue(async () => {
      await this.ensureWindow(fromDay, toDay, onProgress);
      return this.db.query(sql);
    });
  }
}
