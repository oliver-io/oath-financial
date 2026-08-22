// J2 — turn classification (friction, correction).
// Iterates over: ALL turns for turn_friction/friction_cause; only
// short_typed_after_short_gap candidates for is_correction. Batched many turns
// of the SAME session per call. linked_signature_pattern is validated post-hoc
// against stage-2 matches (dangling → friction_cause downgraded to none + flag
// — the model cannot invent failures).
// Output: enrich.j2_verdicts (schema: etl/schemas/enrichment.ts J2OutputSchema).
// Contract: docs/architecture/llm.md "J2".

import { J2OutputSchema } from "../../../schemas/enrichment.ts";
import { buildJ2Packet } from "../packets.ts";
import type { JobSpec, PostHocResult, RecordOutcome } from "../runner.ts";

const PROMPT = `You classify turns of an AI-agent audit session for FRICTION — the degree to
which the exchange was wrestling (auth firefighting, workarounds, re-explaining) rather than
progress — using the stage-2 facts embedded in each turn's packet. Never re-derive structure;
reason on top of the given facts.
Per turn output: turn_friction in [0,1]; friction_cause (system_failure | capability_gap |
agent_behavior | user_request | none); linked_signature_pattern — ONLY a signature pattern id
listed in that turn's matched_signature_patterns, else null; is_correction — true only when the
user is re-steering the agent (judge only turns flagged is_correction_candidate; plain new asks
are not corrections); verdict "ok", or "insufficient" with insufficient_reason when the turn
cannot be read. One sentence of evidence.
Each packet's "position" block is authoritative about the session boundary: is_first_turn=true
means NOTHING precedes this turn (prev_assistant_tail is null because none exists — unless
session_resumed_fragment is true, in which case earlier turns were lost by telemetry, not
absent); is_final_turn=true means this is the session's LAST exchange — no turn follows
anywhere in the data, so what happened afterwards is unknowable, not implied.`;

function toRow(record: Record<string, unknown>, outcome: RecordOutcome): Record<string, unknown> {
  const output = outcome.kind === "error" ? {} : outcome.output;
  return {
    trace_id: record.trace_id ?? null,
    session_id: record.session_id ?? null,
    turn_number: record.turn_number ?? null,
    turn_friction: output.turn_friction ?? null,
    friction_cause: output.friction_cause ?? null,
    linked_signature_pattern: output.linked_signature_pattern ?? null,
    dangling_signature_flag: outcome.kind !== "error" && outcome.dangling === true,
    is_correction: output.is_correction ?? null,
    verdict: outcome.kind === "error" ? "error" : (output.verdict ?? null),
    insufficient_reason:
      outcome.kind === "error" ? outcome.reason : (output.insufficient_reason ?? null),
    evidence: output.evidence ?? null,
  };
}

function postHoc(record: Record<string, unknown>, output: Record<string, unknown>): PostHocResult {
  const pattern = output.linked_signature_pattern;
  if (pattern === null || pattern === undefined) return { kind: "ok", output };
  const matched = Array.isArray(record.matched_patterns) ? record.matched_patterns : [];
  if (matched.includes(pattern)) return { kind: "ok", output };
  // Dangling reference: the model named a failure stage 2 never matched in
  // this turn — downgrade, flag, keep the row (llm.md J2).
  return {
    kind: "ok",
    output: { ...output, friction_cause: "none", linked_signature_pattern: null },
    dangling: true,
  };
}

export const j2Turn: JobSpec = {
  id: "J2",
  selectorSqlFile: "s3_j2_selector",
  buildPacket: buildJ2Packet,
  outputSchema: J2OutputSchema,
  promptTemplate: PROMPT,
  promptVersion: "j2-v4",
  modelTier: "strong",
  writerSqlFile: "s3_j2_writer",
  outputTable: "enrich.j2_verdicts",
  batching: "per_session_batch",
  isAbstention: (output) => output.verdict === "insufficient",
  postHoc,
  toRow,
};
