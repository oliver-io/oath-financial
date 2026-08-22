// Stage 5 — PUBLISH: time-partitioned Parquet delivered statically. No query API.
// Inputs: derive.* + agg.* + manifest. Outputs under build/serve/<run_id>/:
//   facts/turns/day=<date>.parquet, facts/tool_events/day=<date>.parquet   (fact plane,
//     partitioned by event date, every filter dimension denormalized incl.
//     job_type pushed down from sessions)
//   ref/sessions, ref/failure_signatures, ref/incidents, ref/capability_gaps,
//     ref/gap_sessions, ref/findings, ref/auditor_timeline, ref/dims  (reference
//     plane: global, small, fetched whole)
//   manifest.json (run id, partitions, coverage) + latest.json pointer swap LAST
//     (write everything, fsync, then swap — atomicity by ordering).
// Optional: serving.sqlite local-inspection artifact (--sqlite).
// Contract: docs/architecture/etl.md "Stage 5 — PUBLISH".

import type { RunContext } from "../context.ts";
import { Unimplemented } from "../lib/errors.ts";
import type { Stage } from "./types.ts";

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
  rowCounts(_ctx: RunContext) {
    throw new Unimplemented("s5_publish.rowCounts", "docs/plans/etl.md §3 Stage");
  },
};
