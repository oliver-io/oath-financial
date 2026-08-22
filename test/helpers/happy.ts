// Canonical schema-valid responses per job — shared by the full-pipeline
// enriched run and the response matrix. Typed via valid() so schema drift
// fails at typecheck (docs/plans/etl_testing.md §6).

import {
  J1OutputSchema,
  J2OutputSchema,
  J3OutputSchema,
  J4OutputSchema,
  J5OutputSchema,
} from "../../etl/schemas/enrichment.ts";
import { type ScriptStep, valid } from "./responses.ts";

export const happyJ1 = (): ScriptStep =>
  valid(J1OutputSchema, {
    verdict: "non_failure",
    reason: "user_declined",
    insufficient_reason: null,
    confidence: "high",
    evidence: "the AskUserQuestion output shows the user declining, not a tool error",
  });

export const happyJ2 = (): ScriptStep =>
  valid(J2OutputSchema, {
    turn_friction: 0.1,
    friction_cause: "none",
    linked_signature_pattern: null,
    is_correction: false,
    verdict: "ok",
    insufficient_reason: null,
    evidence: "the turn proceeds without wrestling",
  });

export const happyJ3 = (): ScriptStep =>
  valid(J3OutputSchema, {
    job_type: "tie_out",
    job_type_secondary: null,
    outcome: "completed",
    outcome_evidence: "final turn summarizes an agreed tie-out (turns 2-3)",
    ended_mid_work: false,
    verdict: "ok",
    insufficient_reason: null,
  });

export const happyJ4 = (exemplars: string[]): ScriptStep =>
  valid(J4OutputSchema, {
    display_name: "Browser grind for portal work",
    description: "auditors hand-drive the browser where a connector should exist",
    exemplar_session_ids: exemplars,
    verdict: "ok",
    insufficient_reason: null,
  });

export const happyJ5 = (): ScriptStep =>
  valid(J5OutputSchema, {
    assessment: "correct",
    insufficient_reason: null,
    evidence: "the snippet is a genuine failure template",
  });
