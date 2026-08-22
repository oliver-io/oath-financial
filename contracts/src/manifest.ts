// Serving-layer manifest shapes — docs/architecture/etl.md stage 5 and
// docs/architecture/infrastructure.md §1 (object-store layout).
// `latest.json` is the ONLY mutable object; everything under a run id is immutable.

import { z } from "zod";
import { DaySchema } from "./rows.ts";

export const LatestPointerSchema = z.object({
  run_id: z.string(),
  published_at: z.string(),
});

/** One fact-plane partition file. Paths are relative to the run root. */
export const FactPartitionSchema = z.object({
  table: z.enum(["turns", "tool_events"]),
  day: DaySchema,
  path: z.string(), // e.g. "facts/turns/day=2026-03-29.parquet"
  rows: z.number().int().nonnegative(),
});

/** One reference-plane file (always fetched whole). */
export const RefFileSchema = z.object({
  table: z.enum([
    "sessions",
    "failure_signatures",
    "incidents",
    "capability_gaps",
    "gap_sessions",
    "findings",
    "auditor_timeline",
    "dims",
  ]),
  path: z.string(), // e.g. "ref/sessions.parquet"
  rows: z.number().int().nonnegative(),
});

/** Per-job enrichment coverage. A job absent from the map was not run — the
 * UI's degraded-mode signal. (The ETL's internal run manifest is a separate
 * artifact; this serving manifest is owned here in contracts/.) */
export const ServeEnrichmentCoverageSchema = z.object({
  judged: z.number().int().nonnegative(),
  abstained: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
});

/** ⚙ stated parameters the UI displays (value + one-line rationale popovers).
 * Values come from rules/thresholds.yaml via the run manifest. */
export const StatedParamsSchema = z.object({
  gap_cap_s: z.number().positive(),
  quick_restart_window_s: z.number().positive(),
  matched_snippet_radius_chars: z.number().int().positive(),
  incident_excursion_multiplier: z.number().positive(),
  small_n_call_threshold: z.number().int().positive(), // heatmap dotted-cell cutoff
  grind_run_threshold: z.number().int().positive(), // /product/agent grind table cutoff
});

export const ServeManifestSchema = z.object({
  run_id: z.string(),
  published_at: z.string(),
  /** Manifest-derived dataset coverage — the default full-range window. */
  date_coverage: z.object({ start_day: DaySchema, end_day: DaySchema }),
  partitions: z.array(FactPartitionSchema),
  ref: z.array(RefFileSchema),
  /** Keyed J1…J5; empty/missing keys ⇒ degraded captions on M-chipped constructs. */
  enrichment: z.record(z.string(), ServeEnrichmentCoverageSchema),
  rule_versions: z.record(z.string(), z.string()), // e.g. {signatures: "sig-v0", …}
  stated_params: StatedParamsSchema,
});

export type LatestPointer = z.infer<typeof LatestPointerSchema>;
export type FactPartition = z.infer<typeof FactPartitionSchema>;
export type RefFile = z.infer<typeof RefFileSchema>;
export type ServeEnrichmentCoverage = z.infer<typeof ServeEnrichmentCoverageSchema>;
export type StatedParams = z.infer<typeof StatedParamsSchema>;
export type ServeManifest = z.infer<typeof ServeManifestSchema>;
