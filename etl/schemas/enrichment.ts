// Enrichment output schemas — transcribed from docs/architecture/llm.md
// (J1–J5 JSON blocks). These are the structured-output contracts sent to the
// model (via JSON Schema) and re-validated on return. Every field carries a
// .describe() annotation stating its purpose and how to interpret its values —
// the descriptions ARE part of what the model sees (z.toJSONSchema forwards
// them into response_format), so changing one requires a prompt_version bump
// on every job that uses the schema (cache-poisoning rule, see packets.ts).
// Abstention is first-class: every schema carries an insufficient verdict +
// machine-readable reason (llm.md principle 3 and the escape-hatch table).

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

const insufficientReasonField = InsufficientReasonSchema.nullable().describe(
  "Machine-readable reason, set ONLY when your verdict is insufficient; null otherwise. " +
    'Use "unreadable_context" when the packet text is garbled/empty/uninterpretable; ' +
    '"other" for any different reason (state it in evidence).',
);

// -- J1: gray-zone failure adjudication --------------------------------------

export const J1OutputSchema = z.object({
  verdict: z
    .enum(["failure", "non_failure", "insufficient"])
    .describe(
      "Whether this matched tool output was a REAL failure as experienced in the session. " +
        '"failure": a genuine tool/system failure. "non_failure": benign — the match text is ' +
        "not an actual failure (user declined, informational message, immediate recovery). " +
        '"insufficient": you cannot read enough to judge (then set insufficient_reason).',
    ),
  reason: z
    .enum(["user_declined", "recovered_immediately", "benign_message", "genuine_failure", "other"])
    .nullable()
    .describe(
      "WHY you reached the verdict. For non_failure pick user_declined / recovered_immediately / " +
        "benign_message; for failure use genuine_failure; use other only when none fits. " +
        "recovered_immediately means the SAME operation visibly succeeded right after (a retry of " +
        "this call worked) — the agent merely CONTINUING with other tools or finishing the turn is " +
        "NOT recovery: an operation that failed and was worked around is verdict=failure / " +
        "genuine_failure. Must be null when verdict is insufficient.",
    ),
  insufficient_reason: insufficientReasonField,
  confidence: z
    .enum(["high", "low"])
    .describe(
      'Your confidence in the verdict. "high" ONLY when discriminating context beyond the matched ' +
        "error text itself supports it (what the agent did next, a visible retry, the closing " +
        'text, a user response). "low" when the verdict rests mostly on the error/template text ' +
        "alone — a bare generic error with no corroborating context is a low-confidence judgment. " +
        "Downstream aggregation surfaces this split; low is an honest, expected answer.",
    ),
  evidence: z
    .string()
    .describe("Exactly one sentence citing the packet (quote or point at the decisive text)."),
});

// -- J2: turn classification (friction, correction) --------------------------

export const J2OutputSchema = z.object({
  turn_friction: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Degree to which this exchange was WRESTLING rather than progress, 0.0–1.0. " +
        "0 = clean productive progress; ~0.3 = minor detour; ~0.6 = real struggle " +
        "(workarounds, re-explaining, auth firefighting); 1.0 = the whole turn was fighting " +
        "the system with no work advanced. Judge from the packet's stage-2 facts + text.",
    ),
  friction_cause: z
    .enum(["system_failure", "capability_gap", "agent_behavior", "user_request", "none"])
    .describe(
      "Root cause of the friction. Use none when turn_friction is low (≤0.2). " +
        '"system_failure": a tool/platform failure drove it (then set linked_signature_pattern). ' +
        '"capability_gap": the agent lacked a capability and worked around it. ' +
        '"agent_behavior": the agent itself misbehaved (wrong direction, ignored instructions). ' +
        '"user_request": the user asked for rework/changes — not a system problem.',
    ),
  linked_signature_pattern: z
    .string()
    .nullable()
    .describe(
      "ONLY when friction_cause is system_failure: the pattern id of the failure signature that " +
        "caused it, chosen FROM this turn's matched_signature_patterns list in the packet — " +
        "never any other id (dangling ids are rejected post-hoc). Null in every other case.",
    ),
  is_correction: z
    .boolean()
    .describe(
      "True ONLY when the user's message re-steers the agent — redirecting, undoing, or fixing " +
        "the agent's previous work (judge against the previous turn's assistant tail in the " +
        "packet). A plain NEW ask after a short gap is NOT a correction. Only turns flagged " +
        "is_correction_candidate should ever be true.",
    ),
  verdict: z
    .enum(["ok", "insufficient"])
    .describe(
      '"ok": you judged this turn (the fields above are meaningful). "insufficient": the turn ' +
        "could not be read well enough to judge (then set insufficient_reason and neutral values).",
    ),
  insufficient_reason: insufficientReasonField,
  evidence: z
    .string()
    .describe("Exactly one sentence citing what in the packet drove the friction/correction call."),
});

// -- J3: session classification ----------------------------------------------

/** derivations.md §3 job_type taxonomy (expected to be revised post-first-run). */
export const JobTypeSchema = z.enum([
  "doc_receipt_check",
  "doc_location",
  "doc_inventory",
  "tie_out",
  "extraction_supervision",
  "drafting",
  "capability_probe",
  "other",
]);

export const J3OutputSchema = z.object({
  job_type: JobTypeSchema.describe(
    "The session's PRIMARY line of business — what the auditor was trying to get done overall, " +
      "not the incidental tools used. doc_receipt_check: verifying documents were received; " +
      "doc_location: finding where documents live; doc_inventory: listing what is on file; " +
      "tie_out: agreeing figures across documents/workpapers; " +
      "extraction_supervision: overseeing data extraction; " +
      "drafting: producing/updating a document or workpaper; capability_probe: the user testing " +
      "what the agent can do; other: none of these fits. " +
      "Portal/auth activity (logins, token checks, 403 fighting, browser grinds to reach the " +
      "portal) is INFRASTRUCTURE FRICTION, never a job_type — classify an auth-heavy session by " +
      "the document work it was trying to get done; auth noise does not change the line of business.",
  ),
  job_type_secondary: JobTypeSchema.nullable().describe(
    "A clearly-present SECONDARY line of business, or null. Only set when a second work stream " +
      "genuinely runs through the session — not for a single incidental turn.",
  ),
  outcome: z
    .enum(["completed", "abandoned", "undetermined"])
    .describe(
      'How the session\'s work ended. "completed": the final exchanges show the asked-for work ' +
        'delivered or explicitly closed out (a user acknowledgement like "thanks" supports this). ' +
        '"abandoned": the work visibly stops unfinished (e.g. blocked by a spend limit or failure ' +
        'with no resolution, or the user walks away mid-task). "undetermined" is a REAL judgment, ' +
        "not an abstention: you read the whole digest and no marker distinguishes a platform kill " +
        "from abandonment or quiet success — prefer it over guessing.",
    ),
  outcome_evidence: z
    .string()
    .describe(
      'One sentence justifying the outcome, with pointer turn numbers (e.g. "t3, t7") a human ' +
        "can use to audit the label.",
    ),
  ended_mid_work: z
    .boolean()
    .describe(
      "True ONLY when the transcript stops INSIDE unfinished work: the final turn is mid-task " +
        "(work promised or started but not delivered, a failure with no wrap-up, a hard cutoff). " +
        "False when the session reaches ANY natural stopping point — work delivered, a question " +
        "answered, a user sign-off/thanks — even if open items or follow-ups remain. " +
        "Coherence rule: outcome=completed implies ended_mid_work=false unless the completion " +
        "itself is cut off mid-delivery; outcome=abandoned usually (not always) implies true. " +
        "Tool-heavy final turns often END complete — judge the closing text, the final-turn " +
        "facts, and the platform-limit marker, not the tool count.",
    ),
  verdict: z
    .enum(["ok", "insufficient"])
    .describe(
      '"ok": you classified the session. "insufficient": the digest is unreadable/unusable ' +
        "(then set insufficient_reason). Do NOT use insufficient for a readable-but-ambiguous " +
        "session — that is what outcome=undetermined is for.",
    ),
  insufficient_reason: insufficientReasonField,
});

// -- J4: capability-gap naming & grouping ------------------------------------

export const J4OutputSchema = z.object({
  display_name: z
    .string()
    .describe(
      "Short human-readable product-backlog-style name for the workaround pattern " +
        '(e.g. "Browser grind for portal work"). Display text only — identity is the curated ' +
        "gap_id, never this.",
    ),
  description: z
    .string()
    .describe(
      "ONE line describing the workaround and the missing capability that causes it " +
        "(what users do today → what feature would remove the need).",
    ),
  exemplar_session_ids: z
    .array(z.string())
    .describe(
      "1–3 session ids that best exemplify the pattern, chosen FROM the packet's " +
        "candidate_session_ids ONLY. Any id not in that list is rejected as invented data. " +
        "Counts/adoption are computed elsewhere — you only name and pick exemplars.",
    ),
  verdict: z
    .enum(["ok", "insufficient"])
    .describe('"ok": named. "insufficient": the cluster is unreadable (set insufficient_reason).'),
  insufficient_reason: insufficientReasonField,
});

// -- J5: heuristic audit ------------------------------------------------------

export const J5OutputSchema = z.object({
  assessment: z
    .enum(["missed_failure", "correct", "false_positive", "insufficient"])
    .describe(
      "Audit of the rule table on THIS one snippet, per the packet's bucket. " +
        'bucket=unmatched (rules saw no failure): "missed_failure" if the snippet indicates a ' +
        'real failure the rules missed, else "correct". ' +
        'bucket=matched (rules flagged a failure): "false_positive" if the text is not actually ' +
        'a failure, else "correct". ' +
        '"insufficient": the snippet is unreadable (set insufficient_reason). ' +
        "Judge ONLY the given snippet; these sample rates become the published error bars.",
    ),
  insufficient_reason: insufficientReasonField,
  evidence: z.string().describe("Exactly one sentence citing the decisive text in the snippet."),
});

export type J1Output = z.infer<typeof J1OutputSchema>;
export type J2Output = z.infer<typeof J2OutputSchema>;
export type J3Output = z.infer<typeof J3OutputSchema>;
export type J4Output = z.infer<typeof J4OutputSchema>;
export type J5Output = z.infer<typeof J5OutputSchema>;
export type InsufficientReason = z.infer<typeof InsufficientReasonSchema>;
