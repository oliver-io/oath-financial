// The shared integration-test harness (docs/plans/etl_testing.md §2).
// One factory per test: fresh temp workspace (DuckDB file, publish root, cache
// sqlite, manifest dir), real RunContext via the real CLI path, fixture
// staging, the scripted-client seam, spies, and state probes. Tests stay
// declarative: stage data → run entrypoint → assert final state.
//
// Lifecycle: `withHarness(name, fn)` — creates the workspace, scrubs env, runs
// the test body, deletes the workspace on success, KEEPS it (path printed) on
// failure for autopsy.

import { Database } from "bun:sqlite";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type CliOverrides, exitCodeForError, runCli } from "../etl/cli.ts";
import { createRunContext, type EnrichmentEnv, type FaultPoint } from "../etl/context.ts";
import { openDuckDb, queryRows } from "../etl/lib/duckdb.ts";
import type { RunManifest } from "../etl/schemas/run_manifest.ts";
import { LlmCache } from "../etl/stages/s3_enrich/cache.ts";
import { OpenAiClient, type Sleep } from "../etl/stages/s3_enrich/client.ts";
import { getJob } from "../etl/stages/s3_enrich/index.ts";
import { type JobId, runJob } from "../etl/stages/s3_enrich/runner.ts";
import { ScriptedClient, type ScriptSpec } from "./helpers/responses.ts";

const repoRoot = join(import.meta.dir, "..");
const fixturesRoot = join(import.meta.dir, "fixtures");

export type FixtureSet =
  | "slice"
  | "golden/staged"
  | "violations/fork"
  | "violations/referential"
  | "violations/timestamps";

export interface RunResult {
  exitCode: number;
  /** Structured log lines captured from the run (parsed). */
  logs: Record<string, unknown>[];
  /** Every Unimplemented mention in the captured logs — used by expectReal. */
  unimplemented: string[];
}

export interface JobRunResult extends RunResult {
  coverage: { judged: number; abstained: number; error: number; cached_hit: number } | null;
  error: Error | null;
}

/** Deleted before every harness use AND at module load — non-optional
 * (docs/plans/etl_testing.md §2 env scrubbing). */
export function scrubEnv(): void {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("ETL_MODEL_")) delete process.env[key];
  }
}
scrubEnv();

/** Thrown by harness fault injection to simulate a mid-run kill. */
export class InjectedFault extends Error {
  constructor(point: FaultPoint) {
    super(`injected fault at ${point}`);
    this.name = "InjectedFault";
  }
}

export class Harness {
  readonly dir: string;
  readonly logLines: string[] = [];
  readonly sleeps: number[] = [];
  readonly cacheSpy = { gets: [] as string[], puts: [] as string[] };
  private script: ScriptedClient | null = null;
  private faultPoint: FaultPoint | null = null;
  private runCounter = 0;

  constructor(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    this.dir = join(
      tmpdir(),
      "trace-insights-tests",
      `${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    mkdirSync(join(this.dir, "data"), { recursive: true });
    mkdirSync(join(this.dir, "etl", "rules"), { recursive: true });
    // Real production rules by default; overridable per test via overrideRule.
    for (const f of readdirSync(join(repoRoot, "etl", "rules"))) {
      cpSync(join(repoRoot, "etl", "rules", f), join(this.dir, "etl", "rules", f));
    }
  }

  // -- fixtures ---------------------------------------------------------------

  /** Copies a checked-in fixture set into the workspace as data/*.jsonl. */
  stageFixtures(set: FixtureSet): void {
    for (const f of ["traces.jsonl", "observations.jsonl"]) {
      const src = join(fixturesRoot, set, f);
      if (!existsSync(src)) throw new Error(`fixture set ${set} is missing ${f}`);
      cpSync(src, join(this.dir, "data", f));
    }
  }

  /** Replaces one rule file with test-variant content (gate/threshold cases). */
  async overrideRule(
    name: "signatures" | "tool_families" | "thresholds" | "findings",
    text: string,
  ): Promise<void> {
    await Bun.write(join(this.dir, "etl", "rules", `${name}.yaml`), text);
  }

  // -- seams ------------------------------------------------------------------

  /** Installs the scripted client at the client.ts seam. Default when NOT
   * called: the no-credentials trap — the real OpenAiClient construction path,
   * which throws MissingCredentialsError (docs/plans/etl_testing.md §5). */
  injectResponses(spec: ScriptSpec): ScriptedClient {
    this.script = new ScriptedClient(spec);
    return this.script;
  }

  /** Arms a simulated mid-run kill at a named point. */
  failAt(point: FaultPoint): void {
    this.faultPoint = point;
  }

  /** Disarms fault injection (recovery re-runs). */
  clearFault(): void {
    this.faultPoint = null;
  }

  // -- entrypoints ------------------------------------------------------------

  private overrides(): CliOverrides {
    const runIndex = this.runCounter;
    this.runCounter += 1;
    const sleepSpy: Sleep = (ms) => {
      this.sleeps.push(ms);
      return Promise.resolve();
    };
    const script = this.script;
    return {
      rootDir: this.dir,
      // Scripted runs get placebo credentials so enrichment-mode "auto"/"required"
      // resolves; the base URL points at a closed local port so an escaped real
      // client could never reach a network service even if constructed.
      env: script
        ? {
            OPENAI_API_KEY: "scripted-test-key",
            OPENAI_BASE_URL: "http://127.0.0.1:9",
            ETL_MODEL_FAST: "scripted-fast",
            ETL_MODEL_STRONG: "scripted-strong",
          }
        : {},
      now: () => new Date(Date.UTC(2026, 3, 1, 0, runIndex, 0)),
      logSink: (line) => this.logLines.push(line),
      ...(script ? { clientFactory: () => script } : {}),
      sleep: sleepSpy,
      // Determinism seam (like the injected clock/sleep): the scripted client's
      // shared per-call cursor requires in-order consumption, so tests always
      // run the enrichment loop sequentially.
      enrichmentConcurrency: 1,
      injectFault: (point) => {
        if (point === this.faultPoint) throw new InjectedFault(point);
      },
    };
  }

  private result(exitCode: number, firstLog: number): RunResult {
    const logs = this.logLines.slice(firstLog).map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return { raw: l };
      }
    });
    const unimplemented = logs
      .map((l) => String(l.message ?? l.raw ?? ""))
      .filter((m) => m.includes("Unimplemented"));
    return { exitCode, logs, unimplemented };
  }

  /** The real CLI `etl run` path, in-process. */
  async runPipeline(
    flags: { noEnrich?: boolean; stage?: number; sqlite?: boolean } = {},
  ): Promise<RunResult> {
    scrubEnv();
    const argv = ["run"];
    if (flags.noEnrich) argv.push("--no-enrich");
    if (flags.stage !== undefined) argv.push("--stage", String(flags.stage));
    if (flags.sqlite) argv.push("--sqlite");
    const first = this.logLines.length;
    const exitCode = await runCli(argv, this.overrides());
    return this.result(exitCode, first);
  }

  /** One SQL stage through the real executor (`etl run --stage N`). */
  runStage(n: number): Promise<RunResult> {
    return this.runPipeline({ stage: n });
  }

  /** Consecutive stages, each through the real executor. Stops early if a
   * stage exits non-zero and returns that stage's result. */
  async runStages(ns: number[]): Promise<RunResult> {
    let last: RunResult = { exitCode: 0, logs: [], unimplemented: [] };
    for (const n of ns) {
      last = await this.runStage(n);
      if (last.exitCode !== 0) return last;
    }
    return last;
  }

  /** The real CLI `etl enrich` path, in-process. */
  async runEnrichCli(flags: { job?: string; recache?: boolean } = {}): Promise<RunResult> {
    scrubEnv();
    const argv = ["enrich"];
    if (flags.job) argv.push("--job", flags.job);
    if (flags.recache) argv.push("--recache");
    const first = this.logLines.length;
    const exitCode = await runCli(argv, this.overrides());
    return this.result(exitCode, first);
  }

  /** One JobSpec through the real runner. Without injectResponses this takes
   * the real-client construction path — the no-credentials trap. */
  async runJob(jobId: JobId, opts: { recache?: boolean } = {}): Promise<JobRunResult> {
    scrubEnv();
    const job = getJob(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    const first = this.logLines.length;
    const overrides = this.overrides();
    const ctx = await createRunContext({ ...overrides, rootDir: this.dir, enrichmentMode: "off" });
    let cache: LlmCache | null = null;
    try {
      const trapEnv: EnrichmentEnv = {
        apiKey: process.env.OPENAI_API_KEY ?? "",
        baseUrl: "http://127.0.0.1:9",
        modelFast: "trap-fast",
        modelStrong: "trap-strong",
      };
      const sleep = overrides.sleep as Sleep;
      // Client first: an uninjected run must die on MissingCredentialsError
      // before anything else happens (canary a).
      const client = this.script ?? new OpenAiClient(trapEnv, sleep);
      cache = LlmCache.open(ctx.paths.llmCache);
      const spiedCache = this.spyCache(cache);
      const coverage = await runJob({
        ctx,
        job,
        client,
        cache: spiedCache,
        sleep,
        recache: opts.recache ?? false,
      });
      return { ...this.result(0, first), coverage, error: null };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const base = this.result(exitCodeForError(e), first);
      base.unimplemented.push(...(e.name === "Unimplemented" ? [`${e.name}: ${e.message}`] : []));
      return { ...base, coverage: null, error: e };
    } finally {
      try {
        cache?.close();
      } catch {
        // close is Unimplemented until stage-3 work lands; the underlying
        // sqlite handle (if any) is owned by LlmCache.open.
      }
      ctx.db.close();
    }
  }

  private spyCache(cache: LlmCache): LlmCache {
    const spy = this.cacheSpy;
    return new Proxy(cache, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return (key: string) => {
            spy.gets.push(key);
            return target.get(key);
          };
        }
        if (prop === "put") {
          return (entry: Parameters<LlmCache["put"]>[0]) => {
            spy.puts.push(entry.key);
            target.put(entry);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  // -- state probes -----------------------------------------------------------

  /** Rows of a pipeline table (e.g. "derive.tool_events") read from the real
   * DuckDB file after the run finished. */
  async rowsIn(table: string): Promise<Record<string, unknown>[]> {
    if (!/^[a-z_]+\.[a-z_0-9]+$/.test(table)) throw new Error(`bad table name: ${table}`);
    const session = await openDuckDb(join(this.dir, "build", "pipeline.duckdb"));
    try {
      return await queryRows(session, `SELECT * FROM ${table}`);
    } finally {
      session.close();
    }
  }

  async tableExists(table: string): Promise<boolean> {
    try {
      await this.rowsIn(table);
      return true;
    } catch {
      return false;
    }
  }

  /** Finalized run manifests written under build/manifest/, oldest first. */
  async manifests(): Promise<RunManifest[]> {
    const dir = join(this.dir, "build", "manifest");
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const out: RunManifest[] = [];
    for (const f of files) out.push((await Bun.file(join(dir, f)).json()) as RunManifest);
    return out;
  }

  /** All files under build/serve/, as sorted forward-slash relative paths. */
  publishedFiles(): string[] {
    const serve = join(this.dir, "build", "serve");
    if (!existsSync(serve)) return [];
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else out.push(relative(serve, p).replaceAll("\\", "/"));
      }
    };
    walk(serve);
    return out.sort();
  }

  /** Reads one published Parquet file (path relative to build/serve/). */
  async queryParquet(rel: string): Promise<Record<string, unknown>[]> {
    const p = join(this.dir, "build", "serve", rel).replaceAll("\\", "/").replaceAll("'", "''");
    const session = await openDuckDb(":memory:");
    try {
      return await queryRows(session, `SELECT * FROM read_parquet('${p}')`);
    } finally {
      session.close();
    }
  }

  async latestPointer(): Promise<Record<string, unknown> | null> {
    const p = join(this.dir, "build", "serve", "latest.json");
    if (!existsSync(p)) return null;
    return (await Bun.file(p).json()) as Record<string, unknown>;
  }

  /** Rows of the LLM cache sqlite (empty if the file doesn't exist yet). */
  cacheRows(): Record<string, unknown>[] {
    const p = join(this.dir, "build", "llm_cache.sqlite");
    if (!existsSync(p)) return [];
    const db = new Database(p, { readonly: true });
    try {
      return db.query("SELECT * FROM cache ORDER BY key").all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  }

  // -- lifecycle --------------------------------------------------------------

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

/** Standard lifecycle: workspace deleted on success, kept (path printed) on
 * failure. Env is scrubbed before the body runs — non-optional. */
export async function withHarness<T>(name: string, fn: (h: Harness) => Promise<T>): Promise<T> {
  scrubEnv();
  const h = new Harness(name);
  try {
    const out = await fn(h);
    h.cleanup();
    return out;
  } catch (err) {
    // Keep the workspace for autopsy; the path is part of the failure.
    const note = `[harness] workspace kept for autopsy: ${h.dir}`;
    if (err instanceof Error) err.message = `${err.message}\n${note}`;
    throw err;
  }
}

/** Red-state guard: fails the test with the pipeline's own Unimplemented
 * message, so unimplemented-stage failures are visibly Unimplemented failures
 * rather than opaque assertion diffs (phase-2 contract). */
export function expectReal(result: RunResult): void {
  if (result.unimplemented.length > 0) {
    throw new Error(`pipeline path not implemented yet: ${result.unimplemented.join(" | ")}`);
  }
}

/** Same guard for direct job runs: surfaces an Unimplemented error loudly. */
export function expectJobReal(result: JobRunResult): void {
  if (result.error && result.error.name === "Unimplemented") {
    throw new Error(`enrichment path not implemented yet: ${result.error.message}`);
  }
  expectReal(result);
}
