// J1 — gray-zone failure adjudication.
// Iterates over: tool_events where the rule table is explicitly unsure
// (signature matched with counts_as_failure = uncertain, or curated
// per-instance exceptions). NOT every match; NOT unmatched calls (J5's problem).
// Output: enrich.j1_verdicts (schema: etl/schemas/enrichment.ts J1OutputSchema).
// Contract: docs/architecture/llm.md "J1".

import { J1OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ1Packet } from "../packets.ts";
import type { JobSpec, RecordOutcome } from "../runner.ts";

const PROMPT = `You adjudicate ONE ambiguous tool-call outcome from an AI-agent audit session.
The rule table matched a failure signature but is unsure whether it counts as a real failure
(e.g. "exit 1" on an interactive tool is plausibly the user declining, not an error).
Judge from the packet only: the output snippet, the call's position, what the agent did next,
and the assistant's closing text. Never infer beyond the packet.
Verdicts: "failure" (a genuine tool/system failure as experienced), "non_failure" (benign —
user declined, informational message, immediately recovered), or "insufficient" (you cannot
read enough to judge; set insufficient_reason to "unreadable_context" or "other" and reason to null).
Cite one sentence of packet evidence.`;

function toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown> {
  const output = outcome.kind === "error" ? {} : outcome.output;
  return {
    tool_event_id: record.tool_event_id ?? record.observation_id ?? null,
    observation_id: record.observation_id ?? null,
    trace_id: record.trace_id ?? null,
    session_id: record.session_id ?? null,
    verdict: outcome.kind === "error" ? "error" : (output.verdict ?? null),
    reason: output.reason ?? null,
    insufficient_reason:
      outcome.kind === "error" ? outcome.reason : (output.insufficient_reason ?? null),
    confidence: output.confidence ?? null,
    evidence: output.evidence ?? null,
  };
}

export const j1Failure: JobSpec = {
  id: "J1",
  selectorSqlFile: "s3_j1_selector",
  buildPacket: buildJ1Packet,
  outputSchema: J1OutputSchema,
  promptTemplate: PROMPT,
  promptVersion: "j1-v2",
  modelTier: "fast",
  writerSqlFile: "s3_j1_writer",
  outputTable: "enrich.j1_verdicts",
  batching: "per_record",
  isAbstention: (output) => output.verdict === "insufficient",
  toRow,
};
