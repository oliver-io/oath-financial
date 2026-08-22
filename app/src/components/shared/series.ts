// Fixed series-color assignment (theme + app/PALETTE_REPORT.md): hues bind to
// entities in fixed dimension order and are never cycled or repainted when
// filters change the series count.

import { SignatureClassSchema } from "@trace-insights/contracts";

export const SERIES_TOKENS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
] as const;

const GREY = "var(--color-undetermined)";

/** signature_class → fixed slot (7 classes, 7 slots, schema order). */
export function signatureClassColor(cls: string): string {
  const i = (SignatureClassSchema.options as readonly string[]).indexOf(cls);
  return i >= 0 ? (SERIES_TOKENS[i] ?? GREY) : GREY;
}

/** tool_family → fixed slot. Deliberate binding, not enum order: the brick
 * slot goes to `subagent` (whose outputs are near-uniform failure templates)
 * so high-volume browser strips don't read as failure walls. `other` renders
 * neutral grey — a catch-all is not an identity, never a generated 8th hue. */
const FAMILY_SLOT: Record<string, number> = {
  shell: 0, // slate blue
  file: 1, // olive
  subagent: 2, // brick
  docstore: 3, // teal
  task: 4, // amber
  browser: 5, // steel cyan
  search: 6, // copper
};
export function toolFamilyColor(family: string): string {
  const i = FAMILY_SLOT[family];
  return i === undefined ? GREY : (SERIES_TOKENS[i] ?? GREY);
}

/** client → fixed slot by ref/dims order (stable across the app). */
export function clientColor(client: string, clientsInDimOrder: string[]): string {
  const i = clientsInDimOrder.indexOf(client);
  return i >= 0 ? (SERIES_TOKENS[i] ?? GREY) : GREY;
}
