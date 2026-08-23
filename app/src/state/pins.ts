// Pinned-widget state for the room dashboards. Pins are a per-viewer
// convenience, not shareable view state, so they live in localStorage (the
// URL stays the only store for filters/window). Reads and writes are
// try/catch-wrapped; a missing/broken store falls back to the room defaults.

import { useCallback, useState } from "react";

export type Side = "ops" | "product";

// Curated so a fresh board reads top-down: a stat row, the room's headline
// chart, then two supporting panels — enough for a health read at a glance,
// small enough that nothing scrolls off unnoticed.
export const DEFAULT_PINS: Record<Side, string[]> = {
  ops: [
    "stat-failure-events",
    "stat-active-clients",
    "stat-active-auditors",
    "failure-series",
    "signature-table",
    "activity-strips",
  ],
  product: [
    "stat-sessions",
    "stat-turns",
    "stat-determined",
    "outcome-bars",
    "job-share",
    "friction-table",
  ],
};

const key = (side: Side): string => `trace-insights:pins:${side}`;

export function loadPins(side: Side): string[] {
  try {
    const raw = localStorage.getItem(key(side));
    if (!raw) return DEFAULT_PINS[side];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) return parsed;
  } catch {
    // storage unavailable or corrupt — fall through to defaults
  }
  return DEFAULT_PINS[side];
}

function savePins(side: Side, pins: string[]): void {
  try {
    localStorage.setItem(key(side), JSON.stringify(pins));
  } catch {
    // storage unavailable — pins simply don't persist
  }
}

export function usePins(side: Side): {
  pins: string[];
  isPinned: (id: string) => boolean;
  pin: (id: string) => void;
  unpin: (id: string) => void;
} {
  const [pins, setPins] = useState<string[]>(() => loadPins(side));
  const pin = useCallback(
    (id: string) => {
      setPins((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        savePins(side, next);
        return next;
      });
    },
    [side],
  );
  const unpin = useCallback(
    (id: string) => {
      setPins((prev) => {
        const next = prev.filter((p) => p !== id);
        savePins(side, next);
        return next;
      });
    },
    [side],
  );
  const isPinned = useCallback((id: string) => pins.includes(id), [pins]);
  return { pins, isPinned, pin, unpin };
}
