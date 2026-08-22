// Rule/temp-table injection shared by stage prepare() hooks. Rules reach the
// static .sql files as DuckDB temp tables and session variables — never
// string-spliced (docs/plans/etl.md §3 RuleSet). Each stage re-installs what
// its SQL joins against, because temp tables live per connection and a stage
// may run standalone (`etl run --stage N` opens a fresh session).

import { JobTypeSchema } from "@trace-insights/contracts";
import type { RunContext } from "../context.ts";
import { exec, sqlString } from "./duckdb.ts";

export async function batchInsert(ctx: RunContext, table: string, rows: string[]): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await exec(ctx.db, `INSERT INTO ${table} VALUES ${rows.slice(i, i + CHUNK).join(",")}`);
  }
}

/** _signature_rules: curated metadata for every pattern (joined by s2/s4/s5;
 * zero-match patterns still get aggregate rows). */
export async function installSignatureRules(ctx: RunContext): Promise<void> {
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _signature_rules (
       pattern_id VARCHAR, display_name VARCHAR, signature_class VARCHAR,
       counts_as_failure VARCHAR, rule_order INTEGER)`,
  );
  await batchInsert(
    ctx,
    "_signature_rules",
    ctx.rules.signatures.signatures.map(
      (r, i) =>
        `(${sqlString(r.pattern_id)}, ${sqlString(r.display_name)}, ${sqlString(
          r.signature_class,
        )}, ${sqlString(String(r.counts_as_failure))}, ${i})`,
    ),
  );
}

/** _tool_families: tool_name → family rollup (s2 joins; s5 dims). */
export async function installToolFamilies(ctx: RunContext): Promise<void> {
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _tool_families (tool_name VARCHAR, family VARCHAR)`,
  );
  await batchInsert(
    ctx,
    "_tool_families",
    Object.entries(ctx.rules.toolFamilies.families).map(
      ([tool, family]) => `(${sqlString(tool)}, ${sqlString(family)})`,
    ),
  );
}

/** _gap_rules: curated capability-gap clusters (findings.yaml; s4 detectors). */
export async function installGapRules(ctx: RunContext): Promise<void> {
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _gap_rules (
       gap_id VARCHAR, evidence_pattern VARCHAR, min_calls INTEGER, min_share DOUBLE)`,
  );
  const rows = ctx.rules.findings.capability_gaps.map(
    (g) =>
      `(${sqlString(g.gap_id)}, ${sqlString(g.evidence_pattern)}, ${g.min_calls}, ${
        g.min_share === null ? "NULL" : g.min_share
      })`,
  );
  if (rows.length > 0) await batchInsert(ctx, "_gap_rules", rows);
}

/** _finding_rules: findings-brief card rules (s5). Known claim-param gates
 * (min_sessions / min_auditors) become columns; other params are curated
 * annotations carried in target_params, not computed gates. */
export async function installFindingRules(ctx: RunContext): Promise<void> {
  await exec(
    ctx.db,
    `CREATE OR REPLACE TEMP TABLE _finding_rules (
       finding_id VARCHAR, rank INTEGER, audience VARCHAR, title VARCHAR,
       signature VARCHAR, metric VARCHAR, min_sessions INTEGER, min_auditors INTEGER,
       target_params_json VARCHAR, provenance VARCHAR, requires_enrichment BOOLEAN)`,
  );
  const rows = ctx.rules.findings.findings.map((f, i) => {
    const claim = f.claim_params as Record<string, unknown>;
    const sig = typeof claim.signature === "string" ? claim.signature : null;
    const minSessions = typeof claim.min_sessions === "number" ? claim.min_sessions : null;
    const minAuditors = typeof claim.min_auditors === "number" ? claim.min_auditors : null;
    return `(${sqlString(f.finding_id)}, ${i + 1}, ${sqlString(f.audience)}, ${sqlString(
      f.title,
    )}, ${sig === null ? "NULL" : sqlString(sig)}, ${sqlString(f.metric)}, ${
      minSessions ?? "NULL"
    }, ${minAuditors ?? "NULL"}, ${sqlString(JSON.stringify(f.target_params))}, ${sqlString(
      f.provenance,
    )}, ${f.requires_enrichment})`;
  });
  if (rows.length > 0) await batchInsert(ctx, "_finding_rules", rows);
}

/** _job_types: the published job_type taxonomy (contracts is the authority). */
export async function installJobTypes(ctx: RunContext): Promise<void> {
  await exec(ctx.db, `CREATE OR REPLACE TEMP TABLE _job_types (value VARCHAR)`);
  await batchInsert(
    ctx,
    "_job_types",
    JobTypeSchema.options.map((v) => `(${sqlString(v)})`),
  );
}

/** Guarantees the enrich.* side-tables exist (empty when stage 3 did not run)
 * so stage 4/5 SQL stays NULL-tolerant without dynamic SQL. Never drops —
 * the enrich schema is owned by stage 3 (docs/architecture/etl.md stage 4:
 * "runs identically with or without enrich.* rows"). */
export async function ensureEnrichTables(ctx: RunContext): Promise<void> {
  await exec(ctx.db, `CREATE SCHEMA IF NOT EXISTS enrich`);
  const tables = [
    `enrich.j1_verdicts (
       tool_event_id VARCHAR, observation_id VARCHAR, trace_id VARCHAR,
       session_id VARCHAR, verdict VARCHAR, reason VARCHAR,
       insufficient_reason VARCHAR, confidence VARCHAR, evidence VARCHAR)`,
    `enrich.j2_verdicts (
       trace_id VARCHAR, session_id VARCHAR, turn_number INTEGER,
       turn_friction DOUBLE, friction_cause VARCHAR,
       linked_signature_pattern VARCHAR, dangling_signature_flag BOOLEAN,
       is_correction BOOLEAN, verdict VARCHAR, insufficient_reason VARCHAR,
       evidence VARCHAR)`,
    `enrich.j3_verdicts (
       session_id VARCHAR, job_type VARCHAR, job_type_secondary VARCHAR,
       outcome VARCHAR, outcome_evidence VARCHAR, ended_mid_work BOOLEAN,
       verdict VARCHAR, insufficient_reason VARCHAR)`,
    `enrich.j4_gaps (gap_id VARCHAR, display_name VARCHAR, description VARCHAR,
       exemplar_session_ids VARCHAR, verdict VARCHAR, insufficient_reason VARCHAR)`,
    `enrich.j5_audit (observation_id VARCHAR, bucket VARCHAR, assessment VARCHAR,
       insufficient_reason VARCHAR, evidence VARCHAR, verdict VARCHAR)`,
  ];
  for (const t of tables) await exec(ctx.db, `CREATE TABLE IF NOT EXISTS ${t}`);
}
