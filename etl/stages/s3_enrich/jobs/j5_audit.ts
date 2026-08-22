// J5 — heuristic audit (error-bar estimation).
// Iterates over: two fixed seeded random samples computed in stage 2 —
// N unmatched tool outputs (missed failures?) and M matched ones (false
// positives?); seeds/sizes from etl/rules/thresholds.yaml. Stage 4 turns the
// sample rates into error bars on failure counts. The audit never modifies
// verdicts — it measures the instrument.
// Output: enrich.j5_audit (schema: etl/schemas/enrichment.ts J5OutputSchema).
// Contract: docs/architecture/llm.md "J5". Can run any time after stage 2.

import { J5OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ5Packet } from "../packets.ts";
import type { JobSpec, RecordOutcome } from "../runner.ts";

const PROMPT = `You audit ONE tool-output snippet from an AI-agent trace to estimate the failure
rule table's error bars. bucket tells you which question to answer:
- "unmatched": the rule table saw NO failure here. Does the snippet indicate a failure the
  rules missed? → "missed_failure", else "correct".
- "matched": the rule table flagged this as matching signature matched_signature_id. Is that a
  false positive (the text is not actually a failure)? → "false_positive", else "correct".
Judge only the given snippet; if it is unreadable answer "insufficient" with an
insufficient_reason. One sentence of evidence.`;

function toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown> {
  const output = outcome.kind === "error" ? {} : outcome.output;
  const assessment = output.assessment ?? null;
  return {
    observation_id: record.observation_id ?? null,
    bucket: record.bucket ?? null,
    assessment,
    insufficient_reason:
      outcome.kind === "error" ? outcome.reason : (output.insufficient_reason ?? null),
    evidence: output.evidence ?? null,
    verdict:
      outcome.kind === "error" ? "error" : assessment === "insufficient" ? "insufficient" : "ok",
  };
}

export const j5Audit: JobSpec = {
  id: "J5",
  selectorSqlFile: "s3_j5_selector",
  buildPacket: buildJ5Packet,
  outputSchema: J5OutputSchema,
  promptTemplate: PROMPT,
  promptVersion: "j5-v1",
  modelTier: "fast",
  writerSqlFile: "s3_j5_writer",
  outputTable: "enrich.j5_audit",
  batching: "per_record",
  isAbstention: (output) => output.assessment === "insufficient",
  toRow,
};
