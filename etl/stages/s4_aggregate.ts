// Stage 4 — AGGREGATE: signatures, incidents, timelines over MERGED verdicts.
// Inputs: derive.* + enrich.* (NULL-tolerant joins — prepare() guarantees the
// enrich side-tables exist, empty when stage 3 was skipped, so the run is
// identical with or without enrichment; degraded columns stay NULL). Outputs:
// agg.failure_verdicts (the merged per-tool_event verdict: rule → failure;
// rule-uncertain + J1 → J1's verdict; rule-uncertain, no J1 → uncertain —
// materialized as failure_verdict ∈ {rule, model_added, model_cleared,
// uncertain, none}), agg.failure_signatures, agg.incidents,
// agg.auditor_timeline, agg.gap_sessions, agg.capability_gaps.
// Contract: docs/architecture/etl.md "Stage 4 — AGGREGATE".

import type { RunContext } from "../context.ts";
import { countRows } from "../lib/duckdb.ts";
import { ensureEnrichTables, installGapRules, installSignatureRules } from "../lib/rule_tables.ts";
import type { Stage } from "./types.ts";

export const s4Aggregate: Stage = {
  name: "s4_aggregate",
  schema: "agg",
  sqlFiles: [
    "s4_failure_verdicts",
    "s4_failure_signatures",
    "s4_incidents",
    "s4_auditor_timeline",
    "s4_gap_sessions",
    "s4_capability_gaps",
  ],
  preGates: [],
  postGates: [],
  async prepare(ctx: RunContext) {
    await ensureEnrichTables(ctx);
    await installSignatureRules(ctx);
    await installGapRules(ctx);
  },
  async rowCounts(ctx: RunContext) {
    const tables = [
      "agg.failure_verdicts",
      "agg.failure_signatures",
      "agg.incidents",
      "agg.auditor_timeline",
      "agg.gap_sessions",
      "agg.capability_gaps",
    ];
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = await countRows(ctx.db, t);
    return out;
  },
};
