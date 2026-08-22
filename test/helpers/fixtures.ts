// Typed loaders for the checked-in fixture assets (test/fixtures/), so tests
// share one shape definition and the fixture-shape tests can validate it.

import { join } from "node:path";

const fixturesRoot = join(import.meta.dir, "..", "fixtures");

export interface GoldenCase {
  name: string;
  source: { kind: "observation" | "trace_output" | "synthetic"; id: string | null };
  tool_name: string | null;
  text: string;
  expected: { pattern_id: string | null; counts_as_failure: boolean | "uncertain" | null };
  note: string;
}

export interface Expectation {
  metric: string;
  session: string | null;
  value: unknown;
  status: "verified" | "estimated";
  provenance: string;
}

export async function loadGoldenSnippets(): Promise<GoldenCase[]> {
  return (await Bun.file(join(fixturesRoot, "golden", "snippets.json")).json()) as GoldenCase[];
}

export async function loadExpectations(): Promise<Expectation[]> {
  return (await Bun.file(join(fixturesRoot, "slice", "expectations.json")).json()) as Expectation[];
}

/** Looks up one expectation value; throws if absent (a fixture bug, not a
 * pipeline bug). */
export function expectation(all: Expectation[], metric: string, session?: string): Expectation {
  const hit = all.find(
    (e) => e.metric === metric && (session === undefined || e.session?.startsWith(session)),
  );
  if (!hit) throw new Error(`expectations.json has no entry for ${metric} / ${session ?? "-"}`);
  return hit;
}

export async function loadFixtureJsonl(rel: string): Promise<Record<string, unknown>[]> {
  const text = await Bun.file(join(fixturesRoot, rel)).text();
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
