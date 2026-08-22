// Pinned-widget state for the room dashboards. Pins are a per-viewer
// convenience, not shareable view state, so they live in localStorage (the
// URL stays the only store for filters/window). Reads and writes are
// try/catch-wrapped; a missing/broken store falls back to the room defaults.

import { useCallback, useState } from "react";

export type Side = "ops" | "product";

export const DEFAULT_PINS: Record<Side, string[]> = {
  ops: ["ops-findings", "failure-series", "activity-strips", "stat-failure-events"],
  product: ["product-findings", "job-share", "stat-turns", "stat-determined"],
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
