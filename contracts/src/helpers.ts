// Shared parse helpers for the JSON-encoded TEXT columns (see rows.ts
// convention). Both tracks use these so the encoding cannot drift.

import { z } from "zod";

const IntArray = z.array(z.number().int());
const StringArray = z.array(z.string());
const ParamsObject = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/** JSON int[] columns: daily_series, sparkline, missing_turns. */
export function parseIntArray(jsonText: string): number[] {
  return IntArray.parse(JSON.parse(jsonText));
}

/** JSON string[] columns: incidents.signature_ids. */
export function parseStringArray(jsonText: string): string[] {
  return StringArray.parse(JSON.parse(jsonText));
}

/** findings.target_params: flat object of URL query params. */
export function parseTargetParams(jsonText: string): Record<string, string | number | boolean> {
  return ParamsObject.parse(JSON.parse(jsonText));
}

export const encodeIntArray = (v: number[]): string => JSON.stringify(v);
export const encodeStringArray = (v: string[]): string => JSON.stringify(v);
export const encodeTargetParams = (v: Record<string, string | number | boolean>): string =>
  JSON.stringify(v);
