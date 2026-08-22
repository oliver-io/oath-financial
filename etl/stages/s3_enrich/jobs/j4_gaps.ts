// J4 — capability-gap naming & grouping.
// Iterates over: the curated stage-2 pattern clusters (findings.yaml
// capability_gaps) — one call per cluster with exemplar session digests;
// < 10 calls. Gap IDENTITY (gap_id) is curated rule data; J4 produces display
// text only. exemplar ids must be ⊆ input ids (validated post-hoc; a violation
// is an enrich_error — the model invented data). Names and groups, NEVER counts.
// Output: enrich.j4_gaps (schema: etl/schemas/enrichment.ts J4OutputSchema).
// Contract: docs/architecture/llm.md "J4". Depends on J3.

import { J4OutputSchema } from "../../../schemas/enrichment.ts";
import type { RunContext } from "../../../context.ts";
import { installGapRules } from "../../../lib/rule_tables.ts";
import { buildJ4Packet } from "../packets.ts";
import type { JobSpec, PostHocResult, RecordOutcome } from "../runner.ts";

const PROMPT = `You NAME one recurring workaround pattern (a capability gap) observed across audit
sessions of an AI agent. The packet gives the curated cluster id, its deterministic evidence
pattern, and the member sessions. Produce a short human-readable display_name (product-backlog
style, e.g. "Browser grind for portal work"), a one-line description of the workaround and the
capability whose absence causes it, and exemplar_session_ids — 1 to 3 ids chosen FROM
candidate_session_ids only (never any other id; counts are computed elsewhere, you only name
and pick exemplars). verdict "insufficient" + insufficient_reason if the cluster is unreadable.`;

function toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown> {
  const output = outcome.kind === "error" ? {} : outcome.output;
  const exemplars = Array.isArray(output.exemplar_session_ids)
    ? output.exemplar_session_ids.join(",")
    : null;
  return {
    gap_id: record.gap_id ?? null,
    display_name: output.display_name ?? null,
    description: output.description ?? null,
    exemplar_session_ids: exemplars,
    verdict: outcome.kind === "error" ? "error" : (output.verdict ?? null),
    insufficient_reason:
      outcome.kind === "error" ? outcome.reason : (output.insufficient_reason ?? null),
  };
}

function postHoc(record: Record<string, unknown>, output: Record<string, unknown>): PostHocResult {
  const candidates = Array.isArray(record.candidate_session_ids)
    ? record.candidate_session_ids
    : [];
  const exemplars = Array.isArray(output.exemplar_session_ids) ? output.exemplar_session_ids : [];
  const invented = exemplars.filter((id) => !candidates.includes(id));
  if (invented.length > 0) {
    return { kind: "invented", detail: `exemplar ids not in the input: ${invented.join(", ")}` };
  }
  return { kind: "ok", output };
}

export const j4Gaps: JobSpec = {
  id: "J4",
  selectorSqlFile: "s3_j4_selector",
  buildPacket: buildJ4Packet,
  outputSchema: J4OutputSchema,
  promptTemplate: PROMPT,
  promptVersion: "j4-v1",
  modelTier: "strong",
  writerSqlFile: "s3_j4_writer",
  outputTable: "enrich.j4_gaps",
  batching: "per_record",
  prepare: (ctx: RunContext) => installGapRules(ctx),
  isAbstention: (output) => output.verdict === "insufficient",
  postHoc,
  toRow,
};
