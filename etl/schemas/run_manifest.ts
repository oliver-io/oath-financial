// Run-manifest shape — INTERNAL pipeline telemetry (build/manifest/<run_id>.json).
// The published serving manifest.json and latest.json schemas are owned by
// contracts/src/manifest.ts (app track); stage 5 adopts them at M2 — never author
// serving/published-table schemas here (docs/_HANDOFF.md phase-1 scope boundary).
// Contract: docs/architecture/etl.md "Run manifest" — input file SHA-256s, git rev,
// rule-file hashes, threshold values, per-stage row counts, gate outcomes,
// enrichment coverage, model ids + prompt versions, wall times.

import { z } from "zod";

export const GateResultSchema = z.object({
  gate: z.string(),
  passed: z.boolean(),
  detail: z.string().nullable(),
});

export const StageManifestEntrySchema = z.object({
  stage: z.string(),
  row_counts: z.record(z.string(), z.number().int().nonnegative()),
  gates: z.array(GateResultSchema),
  wall_ms: z.number().nonnegative(),
});

/** Per-job coverage: judged / abstained / error / cached-hit counts. */
export const EnrichmentCoverageSchema = z.object({
  judged: z.number().int().nonnegative(),
  abstained: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  cached_hit: z.number().int().nonnegative(),
});

export const RunManifestSchema = z.object({
  run_id: z.string(),
  created_at: z.string(),
  git_rev: z.string().nullable(),
  input_hashes: z.record(z.string(), z.string()),
  rule_hashes: z.record(z.string(), z.string()),
  thresholds: z.record(z.string(), z.unknown()),
  stages: z.array(StageManifestEntrySchema),
  /** Keyed J1…J5; a job absent from the map was not run (degraded mode). */
  enrichment: z.record(z.string(), EnrichmentCoverageSchema),
  model_ids: z.record(z.string(), z.string()),
  prompt_versions: z.record(z.string(), z.string()),
});

export type GateResult = z.infer<typeof GateResultSchema>;
export type StageManifestEntry = z.infer<typeof StageManifestEntrySchema>;
export type EnrichmentCoverage = z.infer<typeof EnrichmentCoverageSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
