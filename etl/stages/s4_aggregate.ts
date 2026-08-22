// Stage 4 — AGGREGATE: signatures, incidents, timelines over MERGED verdicts.
// Inputs: derive.* + enrich.* (NULL-tolerant joins — runs identically without
// enrichment; degraded columns flagged). Outputs: agg.failure_verdicts (the
// merged per-tool_event verdict: rule → failure; rule-uncertain + J1 → J1's
// verdict; rule-uncertain, no J1 → uncertain — materialized as
// failure_verdict ∈ {rule, model_added, model_cleared, uncertain, none}),
// agg.failure_signatures, agg.incidents, agg.auditor_timeline,
// agg.capability_gaps.
// Contract: docs/architecture/etl.md "Stage 4 — AGGREGATE".

import type { RunContext } from "../context.ts";
import { Unimplemented } from "../lib/errors.ts";
import type { Stage } from "./types.ts";

export const s4Aggregate: Stage = {
  name: "s4_aggregate",
  schema: "agg",
  sqlFiles: [
    "s4_failure_verdicts",
    "s4_failure_signatures",
    "s4_incidents",
    "s4_auditor_timeline",
    "s4_capability_gaps",
  ],
  preGates: [],
  postGates: [],
  rowCounts(_ctx: RunContext) {
    throw new Unimplemented("s4_aggregate.rowCounts", "docs/plans/etl.md §3 Stage");
  },
};
