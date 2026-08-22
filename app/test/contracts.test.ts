// Contract conformance (app.md §7's one non-smoke exception): every file in
// the fixture pack zod-parses against contracts/ schemas — this protects the
// cross-track boundary. Runs on the checked-in pack; no network.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  AuditorTimelineRowSchema,
  CapabilityGapRowSchema,
  DimRowSchema,
  FailureSignatureRowSchema,
  FindingRowSchema,
  GapSessionRowSchema,
  IncidentRowSchema,
  LatestPointerSchema,
  ServeManifestSchema,
  SessionRowSchema,
  ToolEventRowSchema,
  TurnRowSchema,
} from "@trace-insights/contracts";

const RUNS = join(import.meta.dir, "..", "..", "contracts", "fixtures", "static", "runs");
const posix = (p: string): string => p.replaceAll("\\", "/");

const REF_SCHEMAS = {
  sessions: SessionRowSchema,
  failure_signatures: FailureSignatureRowSchema,
  incidents: IncidentRowSchema,
  capability_gaps: CapabilityGapRowSchema,
  gap_sessions: GapSessionRowSchema,
  findings: FindingRowSchema,
  auditor_timeline: AuditorTimelineRowSchema,
  dims: DimRowSchema,
} as const;

const instance = await DuckDBInstance.create(":memory:");
const con = await instance.connect();

async function parquetRows(path: string): Promise<unknown[]> {
  const reader = await con.runAndReadAll(
    `SELECT to_json(t) AS j FROM read_parquet('${posix(path)}') t`,
  );
  return reader.getRowObjects().map((r) => JSON.parse(String(r.j)));
}

const latest = LatestPointerSchema.parse(await Bun.file(join(RUNS, "latest.json")).json());

for (const runId of [latest.run_id, "fixture-run-degraded"]) {
  describe(`fixture run ${runId}`, () => {
    test("manifest validates and is internally consistent", async () => {
      const manifest = ServeManifestSchema.parse(
        await Bun.file(join(RUNS, runId, "manifest.json")).json(),
      );
      expect(manifest.run_id).toBe(runId);
      for (const p of manifest.partitions) {
        expect(p.day >= manifest.date_coverage.start_day).toBe(true);
        expect(p.day <= manifest.date_coverage.end_day).toBe(true);
      }
    });

    test("fact partitions conform row-by-row", async () => {
      const manifest = ServeManifestSchema.parse(
        await Bun.file(join(RUNS, runId, "manifest.json")).json(),
      );
      for (const p of manifest.partitions) {
        const rows = await parquetRows(join(RUNS, runId, p.path));
        expect(rows.length).toBe(p.rows);
        const schema = p.table === "turns" ? TurnRowSchema : ToolEventRowSchema;
        for (const row of rows) schema.parse(row);
      }
    });

    test("reference plane conforms row-by-row", async () => {
      const manifest = ServeManifestSchema.parse(
        await Bun.file(join(RUNS, runId, "manifest.json")).json(),
      );
      for (const ref of manifest.ref) {
        const rows = await parquetRows(join(RUNS, runId, ref.path));
        expect(rows.length).toBe(ref.rows);
        const schema = REF_SCHEMAS[ref.table];
        for (const row of rows) schema.parse(row);
      }
    });
  });
}

describe("degraded-mode variant", () => {
  test("has no enrichment coverage and only rule-only findings", async () => {
    const manifest = ServeManifestSchema.parse(
      await Bun.file(join(RUNS, "fixture-run-degraded", "manifest.json")).json(),
    );
    expect(Object.keys(manifest.enrichment)).toHaveLength(0);
    const findings = await parquetRows(join(RUNS, "fixture-run-degraded", "ref/findings.parquet"));
    for (const f of findings) expect(FindingRowSchema.parse(f).requires_enrichment).toBe(false);
    const sessions = await parquetRows(join(RUNS, "fixture-run-degraded", "ref/sessions.parquet"));
    for (const s of sessions) expect(SessionRowSchema.parse(s).outcome).toBeNull();
  });
});
