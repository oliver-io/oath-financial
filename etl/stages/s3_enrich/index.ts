// Stage 3 — ENRICH: LLM jobs J1…J5, cached, optional, resumable.
// Unlike the SQL stages, stage 3 is executed by the runner over JobSpecs
// (selector SQL → packets → cache → call → writer SQL); its outputs land in
// quarantined enrich.* side-tables. Run order: J1 → J2 → J3 → J4; J5 any time.
// Skippable via --no-enrich; stage 4 aggregates over rule-only verdicts then.
// Contract: docs/architecture/etl.md "Stage 3 — ENRICH"; docs/architecture/llm.md.

import { j1Failure } from "./jobs/j1_failure.ts";
import { j2Turn } from "./jobs/j2_turn.ts";
import { j3Session } from "./jobs/j3_session.ts";
import { j4Gaps } from "./jobs/j4_gaps.ts";
import { j5Audit } from "./jobs/j5_audit.ts";
import type { JobSpec } from "./runner.ts";

/** In dependency order (J5 is independent, appended last by convention). */
export const enrichmentJobs: readonly JobSpec[] = [j1Failure, j2Turn, j3Session, j4Gaps, j5Audit];

export function getJob(id: string): JobSpec | undefined {
  return enrichmentJobs.find((j) => j.id === id.toUpperCase());
}
