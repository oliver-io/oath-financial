// ManifestRecorder: accumulates per-stage entries during a run; finalize()
// writes manifest/<run_id>.json.
// Contract: docs/plans/etl.md §3 ManifestRecorder; shape in etl/schemas/run_manifest.ts.
// Stage-5 embedding into the published manifest.json + latest.json pointer swap
// is stage work, not scaffold.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  EnrichmentCoverage,
  GateResult,
  RunManifest,
  StageManifestEntry,
} from "../schemas/run_manifest.ts";
import { RunManifestSchema } from "../schemas/run_manifest.ts";

export class ManifestRecorder {
  private readonly stages: StageManifestEntry[] = [];
  private readonly enrichment: Record<string, EnrichmentCoverage> = {};
  private readonly modelIds: Record<string, string> = {};
  private readonly promptVersions: Record<string, string> = {};

  constructor(
    private readonly runId: string,
    private readonly createdAt: string,
    private readonly inputHashes: Record<string, string>,
    private readonly ruleHashes: Record<string, string>,
    private readonly thresholds: Record<string, unknown>,
    private readonly manifestDir: string,
    private readonly gitRev: string | null,
  ) {}

  recordStage(
    stage: string,
    rowCounts: Record<string, number>,
    gates: GateResult[],
    wallMs: number,
  ): void {
    this.stages.push({ stage, row_counts: rowCounts, gates, wall_ms: wallMs });
  }

  recordEnrichment(
    job: string,
    coverage: EnrichmentCoverage,
    modelId: string,
    promptVersion: string,
  ): void {
    this.enrichment[job] = coverage;
    this.modelIds[job] = modelId;
    this.promptVersions[job] = promptVersion;
  }

  /** The manifest assembled so far (validated). Used by stage 5 and tests. */
  snapshot(): RunManifest {
    return RunManifestSchema.parse({
      run_id: this.runId,
      created_at: this.createdAt,
      git_rev: this.gitRev,
      input_hashes: this.inputHashes,
      rule_hashes: this.ruleHashes,
      thresholds: this.thresholds,
      stages: this.stages,
      enrichment: this.enrichment,
      model_ids: this.modelIds,
      prompt_versions: this.promptVersions,
    });
  }

  /** Writes manifest/<run_id>.json. Publish-side embedding and the
   * latest.json pointer swap belong to stage 5 (write-everything-then-swap
   * atomicity by ordering). */
  async finalize(): Promise<string> {
    const path = join(this.manifestDir, `${this.runId}.json`);
    mkdirSync(this.manifestDir, { recursive: true });
    await Bun.write(path, `${JSON.stringify(this.snapshot(), null, 2)}\n`);
    return path;
  }
}
