// Time-window semantics — the ONE place both membership rules live (app.md §4).
// Ops constructs = event-timestamp membership; product session-grain constructs
// = whole-session containment + the excluded-count caption. The caption's
// number comes from the same predicate that applies containment.

import type { ServeManifest } from "@trace-insights/contracts";

export interface TimeWindow {
  fromDay: string; // inclusive, "YYYY-MM-DD"
  toDay: string; // inclusive
}

export function fullRange(manifest: ServeManifest): TimeWindow {
  return { fromDay: manifest.date_coverage.start_day, toDay: manifest.date_coverage.end_day };
}

const esc = (v: string): string => v.replaceAll("'", "''");

/** Ops/event semantics: an event is in the window iff its timestamp is.
 * Fact rows carry the partition `day`, which is exactly the event date. */
export function eventMembership(w: TimeWindow, alias = ""): string {
  const col = alias ? `${alias}.day` : "day";
  return `${col} >= '${esc(w.fromDay)}' AND ${col} <= '${esc(w.toDay)}'`;
}

const windowStart = (w: TimeWindow): string => `${w.fromDay}T00:00:00.000Z`;
const windowEnd = (w: TimeWindow): string => `${w.toDay}T23:59:59.999Z`;

/** Product/session semantics: whole containment — began AND ended inside. */
export function sessionContainment(w: TimeWindow, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}first_ts >= '${windowStart(w)}' AND ${p}last_ts <= '${windowEnd(w)}'`;
}

/** Sessions that OVERLAP the window but are not contained — the excluded set
 * behind the "N sessions overlap this window but aren't fully contained"
 * caption (and its clickable list). */
export function sessionOverlapNotContained(w: TimeWindow, alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `${p}first_ts <= '${windowEnd(w)}' AND ${p}last_ts >= '${windowStart(w)}' AND NOT (${sessionContainment(w, alias)})`;
}

export type WindowPreset = "24h" | "7d" | "30d" | "full";

/** Presets anchor to the manifest's coverage end (a static dataset must not
 * open on an empty last-24h view — infrastructure.md "presents as REAL"). */
export function presetWindow(preset: WindowPreset, manifest: ServeManifest): TimeWindow {
  const full = fullRange(manifest);
  if (preset === "full") return full;
  const days = preset === "24h" ? 1 : preset === "7d" ? 7 : 30;
  const endMs = Date.parse(`${full.toDay}T00:00:00Z`);
  const startMs = endMs - (days - 1) * 86400000;
  const clampMs = Math.max(startMs, Date.parse(`${full.fromDay}T00:00:00Z`));
  return { fromDay: new Date(clampMs).toISOString().slice(0, 10), toDay: full.toDay };
}
