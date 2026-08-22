// ALL SQL lives here (app.md §3) — one named query per UI construct, each
// typed by a contracts row schema or a local result schema. Components never
// query; they receive typed rows. Window predicates come from window.ts so
// ops/product semantics cannot drift per-view.

import { z } from "zod";
import type { FilterState } from "../state/urlState.ts";
import {
  eventMembership,
  sessionContainment,
  sessionOverlapNotContained,
  type TimeWindow,
} from "./window.ts";

const esc = (v: string): string => v.replaceAll("'", "''");

/** Shared filter-bar predicate over denormalized fact rows (and ref/sessions,
 * which carries the same dimension columns). Demo traffic is EXCLUDED unless
 * the toggle is on (ui.md §2). */
export function dimensionPredicate(f: FilterState, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  const clauses: string[] = [];
  if (!f.includeDemo) clauses.push(`${p}is_demo_traffic = false`);
  if (f.client) clauses.push(`${p}client = '${esc(f.client)}'`);
  if (f.entity) clauses.push(`${p}entity = '${esc(f.entity)}'`);
  if (f.auditor) clauses.push(`${p}auditor = '${esc(f.auditor)}'`);
  if (f.jobTypes.length > 0)
    clauses.push(`${p}job_type IN (${f.jobTypes.map((j) => `'${esc(j)}'`).join(", ")})`);
  return clauses.length > 0 ? clauses.join(" AND ") : "1 = 1";
}

// ---------------------------------------------------------------- shell/meta

export const CountSchema = z.object({ n: z.number() });

/** Boot-spike + shell smoke: one aggregated query over a windowed fact view. */
export function qTurnCount(w: TimeWindow, f: FilterState): string {
  return `SELECT count(*)::INT AS n FROM turns WHERE ${eventMembership(w)} AND ${dimensionPredicate(f)}`;
}

/** The excluded-count caption + clickable list share one predicate source. */
export function qExcludedSessionCount(w: TimeWindow, f: FilterState): string {
  return `SELECT count(*)::INT AS n FROM sessions
    WHERE ${sessionOverlapNotContained(w)} AND ${dimensionPredicate(f)}`;
}

export const ExcludedSessionSchema = z.object({
  session_id: z.string(),
  auditor: z.string(),
  client: z.string(),
  first_ts: z.string(),
  last_ts: z.string(),
  turn_count: z.number(),
});
export function qExcludedSessions(w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, auditor, client, first_ts, last_ts, turn_count::INT AS turn_count
    FROM sessions WHERE ${sessionOverlapNotContained(w)} AND ${dimensionPredicate(f)}
    ORDER BY first_ts`;
}

export const DimValueSchema = z.object({
  kind: z.string(),
  value: z.string(),
  parent: z.string().nullable(),
});
export function qDims(): string {
  return `SELECT kind, value, parent FROM dims ORDER BY kind, value`;
}

// ---------------------------------------------------------------- /session/:id

import {
  FailureSignatureRowSchema,
  SessionRowSchema,
  ToolEventRowSchema,
  TurnRowSchema,
} from "@trace-insights/contracts";

export const SessionRowQ = SessionRowSchema;
export function qSession(sessionId: string): string {
  return `SELECT * FROM sessions WHERE session_id = '${esc(sessionId)}'`;
}

export const TurnRowQ = TurnRowSchema;
/** The viewer scopes the fact window to the session's own day span, so the
 * whole transcript is available regardless of the global window. */
export function qSessionTurns(sessionId: string): string {
  return `SELECT * FROM turns WHERE session_id = '${esc(sessionId)}' ORDER BY turn_number`;
}

export const ToolEventRowQ = ToolEventRowSchema;
export function qSessionToolEvents(sessionId: string): string {
  return `SELECT * FROM tool_events WHERE session_id = '${esc(sessionId)}'
    ORDER BY turn_number, seq_index`;
}

export const FailureSignatureRowQ = FailureSignatureRowSchema;
export function qFailureSignatures(): string {
  return `SELECT * FROM failure_signatures ORDER BY session_count DESC, event_count DESC`;
}

// ---------------------------------------------------------------- /ops

/** Counting failures: rule verdicts plus J1 model-added; Agent-tool events
 * excluded by default (poisoned subagent outputs — signatures.yaml notes). */
function failurePredicate(f: FilterState, alias = "e"): string {
  const agent = f.includeAgent ? "" : ` AND ${alias}.is_agent_tool = false`;
  return `${alias}.failure_verdict IN ('rule', 'model_added')${agent}`;
}

export const FailureSeriesPointSchema = z.object({
  day: z.string(),
  signature_class: z.string(),
  n: z.number(),
});
export function qFailureSeries(w: TimeWindow, f: FilterState): string {
  return `SELECT e.day, s.signature_class, count(*)::INT AS n
    FROM tool_events e JOIN failure_signatures s ON e.matched_signature_id = s.pattern_id
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")} AND ${failurePredicate(f)}
    GROUP BY 1, 2 ORDER BY 1`;
}

export const IncidentRowQ = z.object({
  incident_id: z.string(),
  signature_ids: z.string(),
  start_ts: z.string(),
  end_ts: z.string(),
  blast_sessions: z.number(),
  blast_auditors: z.number(),
  blast_clients: z.number(),
  linked_friction_cost: z.number().nullable(),
});
export function qIncidents(): string {
  return `SELECT * FROM incidents ORDER BY start_ts`;
}

/** Windowed per-signature aggregate (event semantics); curated metadata,
 * terminal rate, and J5 error bars join in from the global reference plane in
 * the component. groupBy adds the pivot column. */
export const SignatureAggSchema = z.object({
  pattern_id: z.string(),
  group_value: z.string().nullable(),
  events: z.number(),
  sessions: z.number(),
  auditors: z.number(),
  first_seen_w: z.string().nullable(),
  last_seen_w: z.string().nullable(),
  shape_a: z.number(),
  shape_b: z.number(),
  shape_c: z.number(),
});
export function qSignatureAgg(
  w: TimeWindow,
  f: FilterState,
  groupBy: "none" | "client" | "auditor",
): string {
  const groupCol = groupBy === "none" ? "NULL" : `e.${groupBy}`;
  const groupClause = groupBy === "none" ? "" : `, e.${groupBy}`;
  return `SELECT e.matched_signature_id AS pattern_id, ${groupCol} AS group_value,
      count(*)::INT AS events,
      count(DISTINCT e.session_id)::INT AS sessions,
      count(DISTINCT e.auditor)::INT AS auditors,
      min(e.ts) AS first_seen_w, max(e.ts) AS last_seen_w,
      sum(CASE WHEN e.post_failure_shape = 'same_tool_clean_later' THEN 1 ELSE 0 END)::INT AS shape_a,
      sum(CASE WHEN e.post_failure_shape = 'other_calls_after' THEN 1 ELSE 0 END)::INT AS shape_b,
      sum(CASE WHEN e.post_failure_shape = 'turn_ends_on_failure' THEN 1 ELSE 0 END)::INT AS shape_c
    FROM tool_events e
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
      AND e.matched_signature_id IS NOT NULL
      AND (${f.includeAgent ? "1 = 1" : "e.is_agent_tool = false"})
    GROUP BY 1, 2${groupClause ? "" : ""}
    ORDER BY sessions DESC, events DESC`;
}

export const DailyCountSchema = z.object({ day: z.string(), n: z.number() });
export function qSignatureDaily(patternId: string, w: TimeWindow, f: FilterState): string {
  return `SELECT day, count(*)::INT AS n FROM tool_events e
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
      AND matched_signature_id = '${esc(patternId)}' GROUP BY 1 ORDER BY 1`;
}

export const SampleSnippetSchema = z.object({
  matched_snippet: z.string().nullable(),
  rule_version: z.string().nullable(),
});
export function qSignatureSamples(patternId: string, w: TimeWindow, f: FilterState): string {
  return `SELECT DISTINCT matched_snippet, rule_version FROM tool_events e
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
      AND matched_signature_id = '${esc(patternId)}' AND matched_snippet IS NOT NULL LIMIT 3`;
}

export const SessionLinkSchema = z.object({
  session_id: z.string(),
  auditor: z.string(),
  client: z.string(),
  n: z.number(),
});
export function qSignatureSessions(patternId: string, w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, any_value(auditor) AS auditor, any_value(client) AS client,
      count(*)::INT AS n
    FROM tool_events e
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
      AND matched_signature_id = '${esc(patternId)}'
    GROUP BY 1 ORDER BY n DESC LIMIT 12`;
}

// ---------------------------------------------------------------- /product/outcomes

/** Session-grain: containment semantics. outcome NULL = J3 not run; job_type
 * NULL likewise — both are rendered states, never dropped. */
export const OutcomeCountSchema = z.object({
  job_type: z.string().nullable(),
  outcome: z.string().nullable(),
  n: z.number(),
});
export function qOutcomesByJob(w: TimeWindow, f: FilterState): string {
  return `SELECT job_type, outcome, count(*)::INT AS n FROM sessions
    WHERE ${sessionContainment(w)} AND ${dimensionPredicate(f)}
    GROUP BY 1, 2 ORDER BY 1, 2`;
}

export const InteractionCostDotSchema = z.object({
  session_id: z.string(),
  job_type: z.string().nullable(),
  interaction_cost: z.number(),
});
/** Dot per COMPLETED session (marker-flag interaction-cost definition). */
export function qInteractionCostDots(w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, job_type, interaction_cost::INT AS interaction_cost FROM sessions
    WHERE ${sessionContainment(w)} AND ${dimensionPredicate(f)} AND outcome = 'completed'
    ORDER BY interaction_cost DESC`;
}

export const FrictionRowSchema = z.object({
  session_id: z.string(),
  auditor: z.string(),
  friction_share: z.number().nullable(),
  dominant_friction_cause: z.string().nullable(),
  dominant_linked_signature: z.string().nullable(),
  job_type: z.string().nullable(),
  outcome: z.string().nullable(),
  outcome_evidence: z.string().nullable(),
});
export function qFrictionTable(w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, auditor, friction_share, dominant_friction_cause,
      dominant_linked_signature, job_type, outcome, outcome_evidence
    FROM sessions
    WHERE ${sessionContainment(w)} AND ${dimensionPredicate(f)} AND friction_share IS NOT NULL
    ORDER BY friction_share DESC LIMIT 30`;
}

export const CapabilityGapRowQ = z.object({
  gap_id: z.string(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  evidence_pattern: z.string(),
  session_count: z.number(),
  auditor_count: z.number(),
  interaction_cost_estimate: z.number(),
  series_start_day: z.string().nullable(),
  daily_series: z.string(),
});
export function qCapabilityGaps(): string {
  return `SELECT * FROM capability_gaps ORDER BY interaction_cost_estimate DESC`;
}

export const GapExemplarSchema = z.object({ gap_id: z.string(), session_id: z.string() });
export function qGapExemplars(): string {
  return `SELECT gap_id, session_id FROM gap_sessions WHERE is_exemplar ORDER BY gap_id, session_id`;
}

// ---------------------------------------------------------------- /ops/environments

export const EnvCellSchema = z.object({
  client: z.string(),
  signature_class: z.string().nullable(),
  failures: z.number(),
  total_calls: z.number(),
});
/** Client × signature-class failures with per-client total calls (for the
 * per-100-calls normalization and the small-n dotted state). */
export function qEnvHeatmap(w: TimeWindow, f: FilterState): string {
  return `WITH totals AS (
      SELECT client, count(*)::INT AS total_calls FROM tool_events e
      WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")} GROUP BY 1
    ), fails AS (
      SELECT e.client, s.signature_class, count(*)::INT AS failures
      FROM tool_events e JOIN failure_signatures s ON e.matched_signature_id = s.pattern_id
      WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
        AND e.failure_verdict IN ('rule', 'model_added')
        AND (${f.includeAgent ? "1 = 1" : "e.is_agent_tool = false"})
      GROUP BY 1, 2
    )
    SELECT t.client, fl.signature_class, coalesce(fl.failures, 0)::INT AS failures,
      t.total_calls
    FROM totals t LEFT JOIN fails fl ON fl.client = t.client ORDER BY 1, 2`;
}

export const IntegritySchema = z.object({
  resumed_fragments: z.number(),
  sessions_missing_turns: z.number(),
  sessions_total: z.number(),
});
/** Telemetry-integrity signals the serving contract carries. ("Generation rows
 * missing usage" lives in the pipeline run manifest, not the serving plane —
 * flagged as a cross-track note, not invented here.) */
export function qIntegrity(f: FilterState): string {
  return `SELECT
      sum(CASE WHEN resumed_fragment THEN 1 ELSE 0 END)::INT AS resumed_fragments,
      sum(CASE WHEN missing_turns != '[]' THEN 1 ELSE 0 END)::INT AS sessions_missing_turns,
      count(*)::INT AS sessions_total
    FROM sessions WHERE ${dimensionPredicate(f)}`;
}

// ---------------------------------------------------------------- /ops/rhythm

export const AuditorDaySchema = z.object({
  auditor: z.string(),
  day: z.string(),
  turns: z.number(),
  demo_turns: z.number(),
});
export function qAuditorDaily(w: TimeWindow, f: FilterState): string {
  // demo turns kept separately so the strip can hatch them when shown
  const dims = dimensionPredicate({ ...f, includeDemo: true });
  const demoFilter = f.includeDemo ? "1 = 1" : "is_demo_traffic = false";
  return `SELECT auditor, day,
      sum(CASE WHEN ${demoFilter} THEN 1 ELSE 0 END)::INT AS turns,
      sum(CASE WHEN is_demo_traffic THEN 1 ELSE 0 END)::INT AS demo_turns
    FROM turns WHERE ${eventMembership(w)} AND ${dims} GROUP BY 1, 2 ORDER BY 1, 2`;
}

export const TimelineRowQ = z.object({
  auditor: z.string(),
  day: z.string(),
  turns: z.number(),
  sessions_touched: z.number(),
  clients_touched: z.number(),
  capped_gap_span_s: z.number(),
  bout_count: z.number(),
});
export function qAuditorTimeline(w: TimeWindow): string {
  return `SELECT auditor, day, turns::INT AS turns, sessions_touched::INT AS sessions_touched,
      clients_touched::INT AS clients_touched, capped_gap_span_s, bout_count::INT AS bout_count
    FROM auditor_timeline WHERE day >= '${w.fromDay}' AND day <= '${w.toDay}' ORDER BY auditor, day`;
}

export const SessionSpanSchema = z.object({
  session_id: z.string(),
  auditor: z.string(),
  wall_span_s: z.number(),
  capped_gap_span_s: z.number(),
});
export function qSessionSpans(w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, auditor, wall_span_s, capped_gap_span_s FROM sessions
    WHERE ${sessionOverlap(w)} AND ${dimensionPredicate(f)}`;
}

function sessionOverlap(w: TimeWindow): string {
  return `first_ts <= '${w.toDay}T23:59:59.999Z' AND last_ts >= '${w.fromDay}T00:00:00.000Z'`;
}

export const QuickRestartSchema = z.object({
  session_id: z.string(),
  auditor: z.string(),
  day: z.string(),
  quick_restart_after_s: z.number(),
});
export function qQuickRestarts(w: TimeWindow, f: FilterState): string {
  return `SELECT session_id, auditor, substr(last_ts, 1, 10) AS day, quick_restart_after_s
    FROM sessions
    WHERE quick_restart_after_s IS NOT NULL AND ${sessionOverlap(w)} AND ${dimensionPredicate(f)}
    ORDER BY day`;
}

// ---------------------------------------------------------------- /product/usage

export const JobShareSchema = z.object({ job_type: z.string().nullable(), n: z.number() });
export function qJobShare(w: TimeWindow, f: FilterState): string {
  return `SELECT job_type, count(*)::INT AS n FROM sessions
    WHERE ${sessionContainment(w)} AND ${dimensionPredicate(f)} GROUP BY 1 ORDER BY n DESC`;
}

export const ClientDaySchema = z.object({ client: z.string(), day: z.string(), n: z.number() });
export function qTurnsByClientDay(w: TimeWindow, f: FilterState): string {
  return `SELECT client, day, count(*)::INT AS n FROM turns
    WHERE ${eventMembership(w)} AND ${dimensionPredicate(f)} GROUP BY 1, 2 ORDER BY 2`;
}

export const AuditorClientCellSchema = z.object({
  auditor: z.string(),
  client: z.string(),
  active_days: z.number(),
});
export function qAuditorClientGrid(w: TimeWindow, f: FilterState): string {
  return `SELECT auditor, client, count(DISTINCT day)::INT AS active_days FROM turns
    WHERE ${eventMembership(w)} AND ${dimensionPredicate(f)} GROUP BY 1, 2`;
}

export const FamilyAdoptionSchema = z.object({
  tool_family: z.string(),
  auditors: z.number(),
  daily: z.string(), // JSON int[] built by the component from daily rows
});
export const FamilyDaySchema = z.object({
  tool_family: z.string(),
  day: z.string(),
  n: z.number(),
  auditors: z.number(),
});
export function qFamilyDaily(w: TimeWindow, f: FilterState): string {
  return `SELECT tool_family, day, count(*)::INT AS n, count(DISTINCT auditor)::INT AS auditors
    FROM tool_events WHERE ${eventMembership(w)} AND ${dimensionPredicate(f)}
    GROUP BY 1, 2 ORDER BY 1, 2`;
}

// ---------------------------------------------------------------- /product/agent

export const RepeatChainRowSchema = z.object({
  session_id: z.string(),
  turn_number: z.number(),
  day: z.string(),
  chain_count: z.number(),
  tools: z.string(),
  after_signature_match: z.boolean(),
});
/** Turns ranked by identical-input repeat chains; whether any repeat followed
 * a signature match in the same turn (structural facts; no "thrash" label). */
export function qRepeatChains(w: TimeWindow, f: FilterState): string {
  return `SELECT e.session_id, e.turn_number, any_value(e.day) AS day,
      count(*) FILTER (e.repeat_of_seq_index IS NOT NULL)::INT AS chain_count,
      string_agg(DISTINCT e.tool_name, ', ') FILTER (e.repeat_of_seq_index IS NOT NULL) AS tools,
      bool_or(e.repeat_of_seq_index IS NOT NULL AND e.seq_index > coalesce((
        SELECT min(m.seq_index) FROM tool_events m
        WHERE m.session_id = e.session_id AND m.turn_number = e.turn_number
          AND m.matched_signature_id IS NOT NULL), 1e9)) AS after_signature_match
    FROM tool_events e
    WHERE ${eventMembership(w, "e")} AND ${dimensionPredicate(f, "e")}
    GROUP BY 1, 2 HAVING chain_count > 0 ORDER BY chain_count DESC LIMIT 20`;
}

export const GrindRowSchema = z.object({
  session_id: z.string(),
  turn_number: z.number(),
  max_same_tool_run: z.number(),
  dominant_family: z.string().nullable(),
});
export function qGrindTurns(w: TimeWindow, f: FilterState, threshold: number): string {
  return `SELECT t.session_id, t.turn_number, t.max_same_tool_run::INT AS max_same_tool_run,
      (SELECT e.tool_family FROM tool_events e
        WHERE e.session_id = t.session_id AND e.turn_number = t.turn_number
        GROUP BY e.tool_family ORDER BY count(*) DESC LIMIT 1) AS dominant_family
    FROM turns t
    WHERE ${eventMembership(w, "t")} AND ${dimensionPredicate(f, "t")}
      AND t.max_same_tool_run >= ${Math.floor(threshold)}
    ORDER BY t.max_same_tool_run DESC LIMIT 20`;
}

export const CorrectionRowSchema = z.object({
  session_id: z.string(),
  turn_number: z.number(),
  day: z.string(),
  user_text_head: z.string(),
  prev_assistant_tail: z.string().nullable(),
});
export function qCorrections(w: TimeWindow, f: FilterState): string {
  return `SELECT t.session_id, t.turn_number, t.day,
      substr(t.user_text, 1, 240) AS user_text_head,
      (SELECT substr(p.assistant_text, greatest(1, length(p.assistant_text) - 300))
        FROM turns p WHERE p.session_id = t.session_id
          AND p.turn_number = (SELECT max(q.turn_number) FROM turns q
            WHERE q.session_id = t.session_id AND q.turn_number < t.turn_number)
      ) AS prev_assistant_tail
    FROM turns t
    WHERE ${eventMembership(w, "t")} AND ${dimensionPredicate(f, "t")} AND t.is_correction = true
    ORDER BY t.day, t.session_id, t.turn_number LIMIT 30`;
}

export const FamilyShapeSchema = z.object({
  tool_family: z.string(),
  shape_a: z.number(),
  shape_b: z.number(),
  shape_c: z.number(),
});
export function qPostFailureByFamily(w: TimeWindow, f: FilterState): string {
  return `SELECT tool_family,
      sum(CASE WHEN post_failure_shape = 'same_tool_clean_later' THEN 1 ELSE 0 END)::INT AS shape_a,
      sum(CASE WHEN post_failure_shape = 'other_calls_after' THEN 1 ELSE 0 END)::INT AS shape_b,
      sum(CASE WHEN post_failure_shape = 'turn_ends_on_failure' THEN 1 ELSE 0 END)::INT AS shape_c
    FROM tool_events WHERE ${eventMembership(w)} AND ${dimensionPredicate(f)}
      AND post_failure_shape IS NOT NULL
    GROUP BY 1 HAVING (shape_a + shape_b + shape_c) > 0 ORDER BY (shape_a + shape_b + shape_c) DESC`;
}

export { eventMembership, sessionContainment, type TimeWindow };
