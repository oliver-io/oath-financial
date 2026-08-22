// The SQL-stage executor + session setup, shared by cli.ts (the stage
// sequence) and the enrichment runner (stage 0–2 bootstrap for standalone
// `etl enrich` / runJob invocations). Extracted from cli.ts so the runner can
// execute stages without importing the CLI (dependency direction stays one-way:
// cli → runner → executor; docs/plans/etl.md §2).

import { join } from "node:path";
import type { RunContext } from "../context.ts";
import { exec, runSqlFile, sqlString } from "../lib/duckdb.ts";
import { GateFailure } from "../lib/errors.ts";
import type { GateResult } from "../schemas/run_manifest.ts";
import type { Stage } from "./types.ts";

/** Session-level setup shared by every stage: UTC rendering (timestamps in the
 * data are UTC; day partitioning and ISO formatting must not follow the host
 * timezone) and the static-SQL variables (paths + thresholds). */
export async function installSessionVariables(ctx: RunContext): Promise<void> {
  const dataDir = join(ctx.paths.root, "data").replaceAll("\\", "/");
  const thr = ctx.rules.thresholds;
  const statements = [
    `SET TimeZone = 'UTC'`,
    `SET VARIABLE traces_path = ${sqlString(`${dataDir}/traces.jsonl`)}`,
    `SET VARIABLE observations_path = ${sqlString(`${dataDir}/observations.jsonl`)}`,
    `SET VARIABLE gap_cap_s = ${thr.gap_cap_s}`,
    `SET VARIABLE quick_restart_window_s = ${thr.quick_restart_window_s}`,
    `SET VARIABLE matched_snippet_radius_chars = ${thr.matched_snippet_radius_chars}`,
    `SET VARIABLE incident_excursion_multiplier = ${thr.incident_excursion_multiplier}`,
    `SET VARIABLE j5_unmatched_n = ${thr.j5.unmatched_sample_n}`,
    `SET VARIABLE j5_matched_m = ${thr.j5.matched_sample_m}`,
    `SET VARIABLE j5_seed = ${thr.j5.seed}`,
    `SET VARIABLE cc_max_typed_chars = ${thr.correction_candidate.max_typed_chars}`,
    `SET VARIABLE cc_max_gap_s = ${thr.correction_candidate.max_gap_s}`,
    `SET VARIABLE signatures_version = ${sqlString(ctx.rules.signatures.version)}`,
    `SET VARIABLE enrichment_ran = ${ctx.enrichment !== null}`,
  ];
  for (const s of statements) await exec(ctx.db, s);
}

/** Executes one SQL stage through the Stage contract:
 * pre-gates → drop-and-rebuild stage schema → prepare hook → run SQL files →
 * post-gates → record manifest — abort the sequence on any gate failure
 * (docs/plans/etl.md §3 Stage). The stage entry is recorded even on failure so
 * the manifest carries the gate report (docs/plans/etl_testing.md §3). */
export async function executeStage(ctx: RunContext, stage: Stage): Promise<void> {
  const t0 = performance.now();
  const gates: GateResult[] = [];
  let rowCounts: Record<string, number> = {};
  const record = () =>
    ctx.manifest.recordStage(stage.name, rowCounts, gates, performance.now() - t0);
  try {
    await installSessionVariables(ctx);
    for (const gate of stage.preGates) {
      const result = await gate.evaluate(ctx);
      gates.push(result);
      if (!result.passed) throw new GateFailure(gate.name, result.detail ?? "");
    }
    await exec(ctx.db, `DROP SCHEMA IF EXISTS ${stage.schema} CASCADE`);
    await exec(ctx.db, `CREATE SCHEMA ${stage.schema}`);
    await stage.prepare?.(ctx);
    for (const file of stage.sqlFiles) await runSqlFile(ctx.db, file);
    for (const gate of stage.postGates) {
      const result = await gate.evaluate(ctx);
      gates.push(result);
      if (!result.passed) throw new GateFailure(gate.name, result.detail ?? "");
    }
    await stage.finalize?.(ctx);
    rowCounts = await stage.rowCounts(ctx);
    record();
    ctx.log.info(stage.name, "stage_complete", {
      tables: Object.keys(rowCounts).length,
      rows: Object.values(rowCounts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    record();
    throw err;
  }
}
