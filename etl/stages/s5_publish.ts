// Stage 5 — PUBLISH: time-partitioned Parquet delivered statically. No query API.
// Inputs: derive.* + agg.* + enrich.* + run manifest (+ transcript text passed
// through from clean.turns — see s5_facts_turns.sql). SQL files shape
// publish.* tables; finalize() exports them under build/serve/<run_id>/:
//   facts/turns/day=<date>.parquet, facts/tool_events/day=<date>.parquet
//   ref/{sessions,failure_signatures,incidents,capability_gaps,gap_sessions,
//        findings,auditor_timeline,dims}.parquet
//   manifest.json (contracts ServeManifestSchema fields — rule_versions are
//     the YAML version strings; sha256 rule hashes live in the embedded
//     internal run-manifest content, per docs/architecture/etl.md "embeds the
//     same content") — then the latest.json pointer swap LAST (write
//     everything, fsync, then swap — atomicity by ordering).
// Every published row is zod-validated against contracts row schemas before
// export (contracts/src/rows.ts header contract).
// Contract: docs/architecture/etl.md "Stage 5 — PUBLISH".

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import {
  AuditorTimelineRowSchema,
  CapabilityGapRowSchema,
  FailureSignatureRowSchema,
  FindingRowSchema,
  GapSessionRowSchema,
  IncidentRowSchema,
  ServeManifestSchema,
  SessionRowSchema,
  ToolEventRowSchema,
  TurnRowSchema,
} from "@trace-insights/contracts";
import type { RunContext } from "../context.ts";
import { countRows, exec, queryRows, sqlString } from "../lib/duckdb.ts";
import {
  ensureEnrichTables,
  installFindingRules,
  installJobTypes,
  installSignatureRules,
  installToolFamilies,
} from "../lib/rule_tables.ts";
import type { Stage } from "./types.ts";

const REF_TABLES = [
  { table: "sessions", source: "publish.ref_sessions", schema: SessionRowSchema },
  {
    table: "failure_signatures",
    source: "publish.ref_failure_signatures",
    schema: FailureSignatureRowSchema,
  },
  { table: "incidents", source: "publish.ref_incidents", schema: IncidentRowSchema },
  {
    table: "capability_gaps",
    source: "publish.ref_capability_gaps",
    schema: CapabilityGapRowSchema,
  },
  { table: "gap_sessions", source: "publish.ref_gap_sessions", schema: GapSessionRowSchema },
  { table: "findings", source: "publish.ref_findings", schema: FindingRowSchema },
  {
    table: "auditor_timeline",
    source: "publish.ref_auditor_timeline",
    schema: AuditorTimelineRowSchema,
  },
  { table: "dims", source: "publish.ref_dims", schema: null },
] as const;

/** DuckDB row → plain JSON row (BIGINT arrives as BigInt). */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "bigint" ? Number(v) : v;
  return out;
}

/** Validates every row of a publish table against its contracts schema.
 * A mismatch aborts the stage — never publish contract-violating rows. */
async function validateRows(
  ctx: RunContext,
  source: string,
  schema: { safeParse(v: unknown): { success: boolean; error?: unknown } } | null,
): Promise<void> {
  if (schema === null) return;
  const rows = await queryRows(ctx.db, `SELECT * FROM ${source}`);
  for (const row of rows) {
    const r = schema.safeParse(plain(row));
    if (!r.success) {
      throw new Error(`contract violation in ${source}: ${String(r.error)}`);
    }
  }
}

/** Write a file and fsync it (publish ordering depends on durability). */
function writeFileSynced(path: string, content: string): void {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

async function copyParquet(ctx: RunContext, select: string, outPath: string): Promise<void> {
  const p = outPath.replaceAll("\\", "/");
  await exec(ctx.db, `COPY (${select}) TO ${sqlString(p)} (FORMAT PARQUET)`);
}

async function finalize(ctx: RunContext): Promise<void> {
  const runDir = join(ctx.paths.serveDir, ctx.runId);
  mkdirSync(join(runDir, "facts", "turns"), { recursive: true });
  mkdirSync(join(runDir, "facts", "tool_events"), { recursive: true });
  mkdirSync(join(runDir, "ref"), { recursive: true });

  // Contract validation before anything is written.
  await validateRows(ctx, "publish.facts_turns", TurnRowSchema);
  await validateRows(ctx, "publish.facts_tool_events", ToolEventRowSchema);
  for (const ref of REF_TABLES) await validateRows(ctx, ref.source, ref.schema);

  // Fact plane: one file per event day, hive-style day=<date>.parquet.
  const partitions = (await queryRows(
    ctx.db,
    `SELECT tbl, day, n FROM publish.manifest_partitions ORDER BY tbl, day`,
  )) as { tbl: string; day: string; n: bigint | number }[];
  for (const p of partitions) {
    const source = p.tbl === "turns" ? "publish.facts_turns" : "publish.facts_tool_events";
    await copyParquet(
      ctx,
      `SELECT * FROM ${source} WHERE day = ${sqlString(p.day)}`,
      join(runDir, "facts", p.tbl, `day=${p.day}.parquet`),
    );
  }

  // Reference plane: whole files.
  const refCounts: Record<string, number> = {};
  for (const ref of REF_TABLES) {
    refCounts[ref.table] = await countRows(ctx.db, ref.source);
    await copyParquet(
      ctx,
      `SELECT * FROM ${ref.source}`,
      join(runDir, "ref", `${ref.table}.parquet`),
    );
  }

  // Published manifest.json: contracts ServeManifestSchema fields + the
  // internal run-manifest content embedded (rule hashes, stage counts —
  // docs/architecture/etl.md "embeds the same content in the published
  // manifest.json"; the degraded-publish test reads rule_hashes from it).
  const days = [...new Set(partitions.map((p) => p.day))].sort();
  const snapshot = ctx.manifest.snapshot();
  const thr = ctx.rules.thresholds;
  const serveManifest = {
    run_id: ctx.runId,
    published_at: snapshot.created_at,
    date_coverage: { start_day: days[0] ?? null, end_day: days.at(-1) ?? null },
    partitions: partitions.map((p) => ({
      table: p.tbl,
      day: p.day,
      path: `facts/${p.tbl}/day=${p.day}.parquet`,
      rows: Number(p.n),
    })),
    ref: REF_TABLES.map((r) => ({
      table: r.table,
      path: `ref/${r.table}.parquet`,
      rows: refCounts[r.table] ?? 0,
    })),
    enrichment: Object.fromEntries(
      Object.entries(snapshot.enrichment).map(([job, c]) => [
        job,
        { judged: c.judged, abstained: c.abstained, error: c.error },
      ]),
    ),
    rule_versions: {
      signatures: ctx.rules.signatures.version,
      tool_families: ctx.rules.toolFamilies.version,
      thresholds: ctx.rules.thresholds.version,
      findings: ctx.rules.findings.version,
    },
    stated_params: {
      gap_cap_s: thr.gap_cap_s,
      quick_restart_window_s: thr.quick_restart_window_s,
      matched_snippet_radius_chars: thr.matched_snippet_radius_chars,
      incident_excursion_multiplier: thr.incident_excursion_multiplier,
      small_n_call_threshold: thr.small_n_call_threshold,
      grind_run_threshold: thr.grind_run_threshold,
    },
    // Embedded internal run-manifest content (git rev, input/rule sha256
    // hashes, per-stage counts, model ids) — provenance chain for any number.
    created_at: snapshot.created_at,
    git_rev: snapshot.git_rev,
    input_hashes: snapshot.input_hashes,
    rule_hashes: snapshot.rule_hashes,
    thresholds: snapshot.thresholds,
    stages: snapshot.stages,
    model_ids: snapshot.model_ids,
    prompt_versions: snapshot.prompt_versions,
  };
  // Contract check before writing (mirrors validateRows). Note: a run with
  // zero partitions fails here (date_coverage days are null) — acceptable, a
  // no-data run should never publish. The original object is written, not the
  // parse result: zod strips the embedded run-manifest keys above.
  ServeManifestSchema.parse(serveManifest);
  writeFileSynced(join(runDir, "manifest.json"), `${JSON.stringify(serveManifest, null, 2)}\n`);

  // The named kill point: everything under the run dir is written; the
  // pointer has NOT moved (docs/plans/etl_testing.md §3 publish atomicity).
  ctx.injectFault?.("s5_after_partition_writes");

  // Pointer swap LAST: write-temp → fsync → rename over latest.json.
  const pointer = { run_id: ctx.runId, published_at: snapshot.created_at };
  const tmp = join(ctx.paths.serveDir, `latest.json.tmp-${ctx.runId}`);
  writeFileSynced(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
  renameSync(tmp, join(ctx.paths.serveDir, "latest.json"));
  ctx.log.info("s5_publish", "published", {
    run_id: ctx.runId,
    partitions: partitions.length,
    days: days.length,
  });
}

export const s5Publish: Stage = {
  name: "s5_publish",
  schema: "publish",
  sqlFiles: [
    "s5_facts_turns",
    "s5_facts_tool_events",
    "s5_ref_sessions",
    "s5_ref_failure_signatures",
    "s5_ref_incidents",
    "s5_ref_capability_gaps",
    "s5_ref_gap_sessions",
    "s5_ref_findings",
    "s5_ref_auditor_timeline",
    "s5_ref_dims",
    "s5_manifest",
  ],
  preGates: [],
  postGates: [],
  async prepare(ctx: RunContext) {
    await ensureEnrichTables(ctx);
    await installSignatureRules(ctx);
    await installToolFamilies(ctx);
    await installJobTypes(ctx);
    await installFindingRules(ctx);
  },
  finalize,
  async rowCounts(ctx: RunContext) {
    const out: Record<string, number> = {
      "publish.facts_turns": await countRows(ctx.db, "publish.facts_turns"),
      "publish.facts_tool_events": await countRows(ctx.db, "publish.facts_tool_events"),
    };
    for (const ref of REF_TABLES) {
      out[ref.source] = await countRows(ctx.db, ref.source);
    }
    return out;
  },
};
