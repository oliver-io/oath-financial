// One row schema per published table — the executable form of
// docs/architecture/derivations.md and docs/architecture/etl.md stage 5.
// ETL stage 5 validates output rows against these before publish; the app's
// query layer types every result row with them.
//
// Convention: nested values (series, id lists, URL params) are published as
// JSON-encoded TEXT columns — portable across Parquet writers and DuckDB-WASM.
// Use the `parse*` helpers in helpers.ts; both tracks share them.

import { z } from "zod";
import {
  CountsAsFailureSchema,
  DimKindSchema,
  FailureVerdictSchema,
  FindingAudienceSchema,
  FrictionCauseSchema,
  JobTypeSchema,
  PostFailureShapeSchema,
  ProvenanceClassSchema,
  SessionOutcomeSchema,
  SignatureClassSchema,
  ToolFamilySchema,
} from "./enums.ts";

/** ISO-8601 UTC timestamp string as published (e.g. "2026-03-29T14:02:11.000Z"). */
export const TimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
/** Partition day key, "YYYY-MM-DD". */
export const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** JSON-encoded TEXT column (see convention above). */
const JsonText = z.string();

const int = z.number().int();
const count = int.nonnegative();

/** Filter dimensions denormalized onto every fact row — etl.md stage 5
 * (job_type pushed down from the session: a deliberate cross-half dependency). */
const factDims = {
  session_id: z.string(),
  day: DaySchema,
  client: z.string(),
  entity: z.string(),
  auditor: z.string(),
  is_demo_traffic: z.boolean(),
  job_type: JobTypeSchema.nullable(), // model-class; NULL when J3 not run
};

// -- facts/turns (partitioned by day) -----------------------------------------

export const TurnRowSchema = z.object({
  ...factDims,
  turn_number: count,
  ts: TimestampSchema,
  gap_before_s: z.number().nonnegative().nullable(), // structural; null on first turns
  // independent structural-marker flags (heuristic) — NOT an exclusive origin enum
  has_task_notification: z.boolean(),
  has_skill_body: z.boolean(),
  has_extract_paste: z.boolean(),
  typed_prefix_chars: count, // heuristic
  user_chars: count,
  assistant_chars: count,
  tool_count: count,
  error_count: count, // heuristic; Agent tool excluded by default
  max_same_tool_run: count, // structural neutral count
  identical_input_chain_count: count, // structural neutral count
  platform_limit_marker: z.boolean(), // heuristic marker
  short_typed_after_short_gap: z.boolean(), // heuristic candidate flag
  is_correction: z.boolean().nullable(), // model; NULL when J2 not run / not selected
  turn_friction: z.number().min(0).max(1).nullable(), // model
  friction_cause: FrictionCauseSchema.nullable(), // model
  linked_failure_signature_id: z.string().nullable(), // heuristic FK → pattern_id
  // transcript (session viewer)
  user_text: z.string(),
  assistant_text: z.string(),
});

// -- facts/tool_events (partitioned by day) -----------------------------------

export const ToolEventRowSchema = z.object({
  ...factDims,
  turn_number: count,
  ts: TimestampSchema,
  seq_index: count, // position within the turn's tool sequence
  tool_name: z.string(),
  tool_family: ToolFamilySchema,
  is_agent_tool: z.boolean(),
  matched_signature_id: z.string().nullable(), // heuristic FK → pattern_id
  matched_snippet: z.string().nullable(), // ±300 chars around the match (evidence popovers)
  rule_version: z.string().nullable(), // signatures.yaml version that matched
  failure_verdict: FailureVerdictSchema, // merged provenance verdict, stage 4
  post_failure_shape: PostFailureShapeSchema.nullable(), // structural
  repeat_of_seq_index: count.nullable(), // structural: byte-identical earlier call this turn
});

// -- ref/sessions (reference plane, fetched whole) ----------------------------

export const SessionRowSchema = z.object({
  session_id: z.string(),
  client: z.string(),
  entity: z.string(),
  auditor: z.string(),
  is_demo_traffic: z.boolean(),
  turn_count: count,
  first_ts: TimestampSchema, // containment predicate input
  last_ts: TimestampSchema, // containment predicate input
  wall_span_s: z.number().nonnegative(), // display-only, never summed
  capped_gap_span_s: z.number().nonnegative(), // heuristic, under stated gap cap
  bout_count: count, // heuristic
  final_turn_tool_count: count,
  final_turn_error_count: count,
  resumed_fragment: z.boolean(),
  missing_turns: JsonText, // JSON int[] — internal turn-number gaps
  interaction_cost: count, // heuristic: turns with non-empty human-authored segment
  quick_restart_after_s: z.number().nonnegative().nullable(), // structural; NOT a linkage
  job_type: JobTypeSchema.nullable(), // model
  job_type_secondary: JobTypeSchema.nullable(), // model (J3); usually NULL
  outcome: SessionOutcomeSchema.nullable(), // NULL = J3 not run (degraded)
  outcome_evidence: z.string().nullable(), // model justification + pointer turns
  ended_mid_work: z.boolean().nullable(), // model
  friction_share: z.number().min(0).max(1).nullable(), // model rollup
  dominant_friction_cause: FrictionCauseSchema.nullable(), // model rollup
  dominant_linked_signature: z.string().nullable(), // session-grain crossover chip FK
});

// -- ref/failure_signatures ---------------------------------------------------

export const FailureSignatureRowSchema = z.object({
  pattern_id: z.string(), // stable public key from rules/signatures.yaml
  display_name: z.string(), // curated
  signature_class: SignatureClassSchema, // curated
  counts_as_failure: CountsAsFailureSchema, // curated tri-state
  rule_version: z.string(),
  event_count: count,
  session_count: count,
  auditor_count: count,
  client_count: count,
  first_seen: TimestampSchema.nullable(),
  last_seen: TimestampSchema.nullable(),
  series_start_day: DaySchema.nullable(),
  daily_series: JsonText, // JSON int[] from series_start_day, one entry per day
  terminal_rate: z.number().min(0).max(1).nullable(), // heuristic co-occurrence rate
  // structural post_failure_shape distribution (counts, not labels)
  shape_same_tool_clean_later: count,
  shape_other_calls_after: count,
  shape_turn_ends_on_failure: count,
  // J5 audit error bars — NULL when J5 not run
  j5_false_positive_rate: z.number().min(0).max(1).nullable(),
  j5_missed_rate: z.number().min(0).max(1).nullable(),
});

// -- ref/incidents ------------------------------------------------------------

export const IncidentRowSchema = z.object({
  incident_id: z.string(),
  signature_ids: JsonText, // JSON string[] of pattern_ids
  start_ts: TimestampSchema, // heuristic rate-excursion window
  end_ts: TimestampSchema,
  blast_sessions: count,
  blast_auditors: count,
  blast_clients: count,
  linked_friction_cost: z.number().nonnegative().nullable(), // model rollup; NULL degraded
});

// -- ref/capability_gaps + ref/gap_sessions -----------------------------------

export const CapabilityGapRowSchema = z.object({
  gap_id: z.string(), // stable public key from the versioned rule files
  display_name: z.string().nullable(), // model (J4); NULL when degraded
  description: z.string().nullable(), // model (J4)
  evidence_pattern: z.string(), // heuristic structural shape, computed in derive
  session_count: count,
  auditor_count: count,
  interaction_cost_estimate: count, // rollup; the backlog ranking key
  series_start_day: DaySchema.nullable(),
  daily_series: JsonText, // JSON int[] — sessions/day sparkline
});

export const GapSessionRowSchema = z.object({
  gap_id: z.string(),
  session_id: z.string(),
  is_exemplar: z.boolean(), // J4 exemplar links (⊆ stage-2 candidates)
});

// -- ref/findings (landing-page cards, from rules/findings.yaml) --------------

export const FindingRowSchema = z.object({
  finding_id: z.string(),
  rank: count, // actionability rank, ascending
  audience: FindingAudienceSchema,
  title: z.string(), // one-sentence claim, rule-templated (never model prose)
  metric_value: z.number().nullable(),
  metric_label: z.string().nullable(), // e.g. "events", "sessions touched"
  sparkline: JsonText, // JSON int[] (may be empty array)
  series_start_day: DaySchema.nullable(),
  target_params: JsonText, // JSON object → URL query params for "open →"
  provenance: ProvenanceClassSchema,
  requires_enrichment: z.boolean(), // false-rows are exactly the degraded card set
});

// -- ref/auditor_timeline -----------------------------------------------------

export const AuditorTimelineRowSchema = z.object({
  auditor: z.string(),
  day: DaySchema,
  turns: count, // structural: activity strip intensity
  sessions_touched: count,
  clients_touched: count,
  capped_gap_span_s: z.number().nonnegative(), // heuristic, per stated cap
  bout_count: count, // heuristic
});

// -- ref/dims -----------------------------------------------------------------

export const DimRowSchema = z.object({
  kind: DimKindSchema,
  value: z.string(),
  parent: z.string().nullable(), // entity rows carry their client here
});

export type TurnRow = z.infer<typeof TurnRowSchema>;
export type ToolEventRow = z.infer<typeof ToolEventRowSchema>;
export type SessionRow = z.infer<typeof SessionRowSchema>;
export type FailureSignatureRow = z.infer<typeof FailureSignatureRowSchema>;
export type IncidentRow = z.infer<typeof IncidentRowSchema>;
export type CapabilityGapRow = z.infer<typeof CapabilityGapRowSchema>;
export type GapSessionRow = z.infer<typeof GapSessionRowSchema>;
export type FindingRow = z.infer<typeof FindingRowSchema>;
export type AuditorTimelineRow = z.infer<typeof AuditorTimelineRowSchema>;
export type DimRow = z.infer<typeof DimRowSchema>;
