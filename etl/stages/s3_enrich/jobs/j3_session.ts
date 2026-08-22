// J3 — session classification (job type, outcome, ended-mid-work).
// Iterates over: sessions, one per call. Depends on J2 (consumes its turn
// labels in the session digest). `undetermined` is a JUDGMENT ("read it, can't
// tell — no marker distinguishes kill from abandonment"), distinct from the
// `insufficient` abstention ("couldn't read it"). resumed_fragment sessions
// still run, judged from the tail only — never infer the missing turns.
// Output: enrich.j3_verdicts (schema: etl/schemas/enrichment.ts J3OutputSchema).
// Contract: docs/architecture/llm.md "J3".

import { J3OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ3Packet } from "../packets.ts";
import type { JobSpec, RecordOutcome } from "../runner.ts";

const PROMPT = `You classify ONE audit session of an AI coding agent from its digest: per-turn
one-liners (typed prefix, tool families, signature matches, friction labels), integrity flags,
final-turn facts and the closing assistant text.
Output: job_type — the line of business of the work (doc_receipt_check | doc_location |
doc_inventory | tie_out | portal_auth | extraction_supervision | drafting | capability_probe |
other) with an optional job_type_secondary; outcome — completed | abandoned | undetermined
("undetermined" is a real judgment: you read it and no marker distinguishes a platform kill
from abandonment); outcome_evidence — one sentence plus pointer turn numbers; ended_mid_work —
whether the final turn stops inside unfinished work (judge from the final-turn facts, the
platform-limit marker, and the closing text — tool-heavy finals often END complete).
If resumed_fragment is true the session head is missing: judge from the tail only and prefer
"undetermined" for job_type when the tail alone cannot say; NEVER infer what missing turns
contained. verdict "insufficient" + insufficient_reason only when the digest is unreadable.`;

function toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown> {
  const output = outcome.kind === "error" ? {} : outcome.output;
  return {
    session_id: record.session_id ?? null,
    job_type: output.job_type ?? null,
    job_type_secondary: output.job_type_secondary ?? null,
    outcome: output.outcome ?? null,
    outcome_evidence: output.outcome_evidence ?? null,
    ended_mid_work: output.ended_mid_work ?? null,
    verdict: outcome.kind === "error" ? "error" : (output.verdict ?? null),
    insufficient_reason:
      outcome.kind === "error" ? outcome.reason : (output.insufficient_reason ?? null),
  };
}

export const j3Session: JobSpec = {
  id: "J3",
  selectorSqlFile: "s3_j3_selector",
  buildPacket: buildJ3Packet,
  outputSchema: J3OutputSchema,
  promptTemplate: PROMPT,
  promptVersion: "j3-v1",
  modelTier: "strong",
  writerSqlFile: "s3_j3_writer",
  outputTable: "enrich.j3_verdicts",
  batching: "per_record",
  isAbstention: (output) => output.verdict === "insufficient",
  toRow,
};
