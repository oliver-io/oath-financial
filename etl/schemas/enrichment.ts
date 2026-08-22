// Enrichment output schemas — transcribed exactly from docs/architecture/llm.md
// (J1–J5 JSON blocks). These are the structured-output contracts sent to the
// model (via JSON Schema) and re-validated on return. Abstention is first-class:
// every schema carries an insufficient verdict + machine-readable reason
// (docs/architecture/llm.md principles 3 and the escape-hatch table).

import { z } from "zod";

/** Machine-readable abstention reasons, per the llm.md escape-hatch table.
 * `schema_failure` rows are written by the runner (enrich_error), not the model. */
export const InsufficientReasonSchema = z.enum([
  "missing_source_field",
  "packet_overflow",
  "schema_failure",
  "unreadable_context",
  "other",
]);

// -- J1: gray-zone failure adjudication --------------------------------------

export const J1OutputSchema = z.object({
  verdict: z.enum(["failure", "non_failure", "insufficient"]),
  reason: z
    .enum(["user_declined", "recovered_immediately", "benign_message", "genuine_failure", "other"])
    .nullable(),
  insufficient_reason: InsufficientReasonSchema.nullable(),
  confidence: z.enum(["high", "low"]),
  evidence: z.string(), // one sentence citing the packet
});

// -- J2: turn classification (friction, correction) --------------------------

export const J2OutputSchema = z.object({
  turn_friction: z.number().min(0).max(1),
  friction_cause: z.enum([
    "system_failure",
    "capability_gap",
    "agent_behavior",
    "user_request",
    "none",
  ]),
  /** Must name a signature that actually matched in this turn — validated
   * post-hoc against stage 2; a dangling reference downgrades friction_cause
   * to `none` + flag. The model cannot invent failures. */
  linked_signature_pattern: z.string().nullable(),
  is_correction: z.boolean(),
  verdict: z.enum(["ok", "insufficient"]),
  insufficient_reason: InsufficientReasonSchema.nullable(),
  evidence: z.string(), // one sentence
});

// -- J3: session classification ----------------------------------------------

/** derivations.md §3 job_type taxonomy (expected to be revised post-first-run). */
export const JobTypeSchema = z.enum([
  "doc_receipt_check",
  "doc_location",
  "doc_inventory",
  "tie_out",
  "portal_auth",
  "extraction_supervision",
  "drafting",
  "capability_probe",
  "other",
]);

export const J3OutputSchema = z.object({
  job_type: JobTypeSchema,
  job_type_secondary: JobTypeSchema.nullable(),
  /** `undetermined` is a judgment ("read it, can't tell"), distinct from the
   * `insufficient` verdict ("couldn't read it") — docs/architecture/llm.md J3. */
  outcome: z.enum(["completed", "abandoned", "undetermined"]),
  outcome_evidence: z.string(), // one sentence + pointer turn numbers
  ended_mid_work: z.boolean(),
  verdict: z.enum(["ok", "insufficient"]),
  insufficient_reason: InsufficientReasonSchema.nullable(),
});

// -- J4: capability-gap naming & grouping ------------------------------------

export const J4OutputSchema = z.object({
  display_name: z.string(),
  description: z.string(), // one line
  /** Must be ⊆ the input packet's session ids — validated; a violation is an
   * enrich_error (the model invented data). Counts come from stage 2 only. */
  exemplar_session_ids: z.array(z.string()),
  verdict: z.enum(["ok", "insufficient"]),
  insufficient_reason: InsufficientReasonSchema.nullable(),
});

// -- J5: heuristic audit ------------------------------------------------------

export const J5OutputSchema = z.object({
  assessment: z.enum(["missed_failure", "correct", "false_positive", "insufficient"]),
  insufficient_reason: InsufficientReasonSchema.nullable(),
  evidence: z.string(),
});

export type J1Output = z.infer<typeof J1OutputSchema>;
export type J2Output = z.infer<typeof J2OutputSchema>;
export type J3Output = z.infer<typeof J3OutputSchema>;
export type J4Output = z.infer<typeof J4OutputSchema>;
export type J5Output = z.infer<typeof J5OutputSchema>;
export type InsufficientReason = z.infer<typeof InsufficientReasonSchema>;
