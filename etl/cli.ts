// Entrypoint: parse args → construct RunContext → execute stage sequence.
// Contract: docs/plans/etl.md §2 cli.ts and §4 — the ONLY module that
// sequences stages. Subcommands:
//   etl run    [--no-enrich] [--stage N] [--sqlite]
//   etl enrich [--job J1..J5] [--recache] [--limit N]
// Exit codes (docs/plans/etl.md §4 step 9): 0 success · 2 gate failure ·
// 3 enrichment invariant failure · 1 any other error (incl. Unimplemented).

import { parseArgs } from "node:util";
import { createRunContext, type RunContextOptions } from "./context.ts";
import { EnrichmentInvariantViolation, GateFailure } from "./lib/errors.ts";
import { writeInspectArtifact } from "./lib/inspect.ts";
import { createLogger } from "./lib/log.ts";
import { executeStage } from "./stages/executor.ts";
import { s0Raw } from "./stages/s0_raw.ts";
import { s1Clean } from "./stages/s1_clean.ts";
import { s2Derive } from "./stages/s2_derive.ts";
import { enrichmentJobs, getJob } from "./stages/s3_enrich/index.ts";
import { runEnrichmentSequence } from "./stages/s3_enrich/runner.ts";
import { s4Aggregate } from "./stages/s4_aggregate.ts";
import { s5Publish } from "./stages/s5_publish.ts";
import type { Stage } from "./stages/types.ts";

/** SQL stages in run order; index = stage number (3 = enrichment, not SQL-staged). */
const SQL_STAGES: Record<number, Stage> = {
  0: s0Raw,
  1: s1Clean,
  2: s2Derive,
  4: s4Aggregate,
  5: s5Publish,
};

export interface RunFlags {
  noEnrich: boolean;
  stage: number | null;
  sqlite: boolean;
}

export interface EnrichFlags {
  job: string | null;
  recache: boolean;
  /** Caps each job's SELECTED record set (sanity/cost-gate runs). The
   * exactly-one-row invariant holds over the capped selection; a later
   * uncapped run reuses the cached calls. Absent = uncapped. */
  limit?: number;
}

/** Test-injectable RunContext options: everything except rootDir/enrichmentMode,
 * which the CLI derives from cwd and flags (docs/plans/etl_testing.md §2 —
 * the harness runs the real CLI path in-process with an isolated workspace). */
export type CliOverrides = Partial<Omit<RunContextOptions, "enrichmentMode">>;

/** `etl run`: full 0→5 sequence, or a single stage with --stage N. */
async function commandRun(flags: RunFlags, overrides?: CliOverrides): Promise<void> {
  // Full runs default to "auto" (enrich if credentials are available, else
  // degrade); an explicit `--stage 3` makes enrichment required.
  const enrichmentMode = flags.noEnrich ? "off" : flags.stage === 3 ? "required" : "auto";
  const ctx = await createRunContext({
    rootDir: process.cwd(),
    ...overrides,
    enrichmentMode,
  });
  try {
    const stageNumbers = flags.stage === null ? [0, 1, 2, 3, 4, 5] : [flags.stage];
    for (const n of stageNumbers) {
      if (n === 3) {
        if (ctx.enrichment === null) continue; // --no-enrich or no credentials: degrade
        await runEnrichmentSequence(ctx, enrichmentJobs, { recache: false });
        continue;
      }
      const stage = SQL_STAGES[n];
      if (!stage) throw new Error(`unknown stage number: ${n}`);
      await executeStage(ctx, stage);
    }
    // Optional local-inspection artifact (never served — etl.md stage 5).
    if (flags.sqlite) await writeInspectArtifact(ctx);
  } finally {
    // Finalize in all outcomes so gate failures still leave their report
    // (docs/plans/etl_testing.md §3 gate/abort integration).
    try {
      await ctx.manifest.finalize();
    } finally {
      ctx.db.close();
    }
  }
}

/** `etl enrich`: run/resume one job (--job) or all, honoring --recache.
 * Enrichment is REQUIRED here — a missing key is a startup error. The runner
 * bootstraps stages 0–2 when the derive tables are absent. */
async function commandEnrich(flags: EnrichFlags, overrides?: CliOverrides): Promise<void> {
  // Job-name validation comes first so `--job J9` reports the unknown job, not
  // a credentials error.
  const maybeJobs = flags.job === null ? [...enrichmentJobs] : [getJob(flags.job)];
  const jobs = maybeJobs.filter((j) => j !== undefined);
  if (jobs.length !== maybeJobs.length) {
    throw new Error(`unknown enrichment job: ${flags.job}`);
  }
  const ctx = await createRunContext({
    rootDir: process.cwd(),
    ...overrides,
    enrichmentMode: "required",
  });
  try {
    await runEnrichmentSequence(ctx, jobs, {
      recache: flags.recache,
      limit: flags.limit ?? null,
    });
  } finally {
    try {
      await ctx.manifest.finalize();
    } finally {
      ctx.db.close();
    }
  }
}

export function parseCliArgs(
  argv: string[],
): { command: "run"; flags: RunFlags } | { command: "enrich"; flags: EnrichFlags } {
  const [command, ...rest] = argv;
  if (command === "run") {
    const { values } = parseArgs({
      args: rest,
      options: {
        "no-enrich": { type: "boolean", default: false },
        stage: { type: "string" },
        sqlite: { type: "boolean", default: false },
      },
    });
    const stage = values.stage === undefined ? null : Number.parseInt(values.stage, 10);
    if (stage !== null && (Number.isNaN(stage) || stage < 0 || stage > 5)) {
      throw new Error(`--stage must be 0..5, got: ${values.stage}`);
    }
    return {
      command: "run",
      flags: { noEnrich: values["no-enrich"] ?? false, stage, sqlite: values.sqlite ?? false },
    };
  }
  if (command === "enrich") {
    const { values } = parseArgs({
      args: rest,
      options: {
        job: { type: "string" },
        recache: { type: "boolean", default: false },
        limit: { type: "string" },
      },
    });
    const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      throw new Error(`--limit must be a positive integer, got: ${values.limit}`);
    }
    return {
      command: "enrich",
      flags: {
        job: values.job ?? null,
        recache: values.recache ?? false,
        ...(limit === undefined ? {} : { limit }),
      },
    };
  }
  throw new Error(`usage: etl <run|enrich> [flags] — got: ${command ?? "(nothing)"}`);
}

/** The exit-code contract (docs/plans/etl.md §4 step 9):
 * 2 gate failure · 3 enrichment invariant failure · 1 anything else. */
export function exitCodeForError(err: unknown): number {
  if (err instanceof GateFailure) return 2;
  if (err instanceof EnrichmentInvariantViolation) return 3;
  return 1;
}

/** The real CLI path, callable in-process (docs/plans/etl_testing.md §2
 * entrypoints — no test-only forks; `main` below is exactly this). */
export async function runCli(argv: string[], overrides?: CliOverrides): Promise<number> {
  const log = createLogger(overrides?.logSink);
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.command === "run") await commandRun(parsed.flags, overrides);
    else await commandEnrich(parsed.flags, overrides);
    return 0;
  } catch (err) {
    const code = exitCodeForError(err);
    if (err instanceof GateFailure) {
      log.error("cli", "gate_failure", { gate: err.gate, message: err.message });
    } else if (err instanceof EnrichmentInvariantViolation) {
      log.error("cli", "enrichment_invariant_violation", { job: err.job, message: err.message });
    } else {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      log.error("cli", "fatal", { message });
    }
    return code;
  }
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
