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
Session boundaries are marked on the digests and are authoritative: the digest with
is_final_turn=true is the session's LAST exchange — no turn follows anywhere in the data, so
judge the ending from it (what happened afterwards is unknowable, not implied); the digest with
is_first_observed_turn=true is the earliest turn telemetry captured — the true session start
unless resumed_fragment is true (then the real beginning was lost, not absent).
Each digest's typed_prefix is the HUMAN-AUTHORED portion of the user message ONLY — when it is
empty the auditor typed nothing and the message was harness-injected (the digest's marker
booleans say what: a skill body, a background task notification, or a pasted extract). Do not
read injected content as the user's intent.
Each output field's meaning and its decision rules are given in that field's schema
description — follow them exactly; outcome and ended_mid_work are SEPARATE judgments that must
respect the coherence rule stated on ended_mid_work (a session that closes with delivered work
or a user sign-off did not end mid-work, even if open items remain).
If resumed_fragment is true the session head is missing: judge from the tail only and prefer
"undetermined" for job_type when the tail alone cannot say; NEVER infer what missing turns
contained. verdict "insufficient" + insufficient_reason only when the digest is unreadable —
a readable-but-ambiguous session is outcome "undetermined", not insufficient.`;

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
  promptVersion: "j3-v5",
  modelTier: "strong",
  writerSqlFile: "s3_j3_writer",
  outputTable: "enrich.j3_verdicts",
  batching: "per_record",
  isAbstention: (output) => output.verdict === "insufficient",
  toRow,
};
