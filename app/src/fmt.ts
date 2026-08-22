// The one number-formatting module (app.md §5). "~" marks heuristic-derived
// values wherever they render.

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

export function approx(n: number): string {
  return `~${count(Math.round(n))}`;
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function approxPct(fraction: number, digits = 0): string {
  return `~${pct(fraction, digits)}`;
}

/** Humane duration from seconds; heuristic-derived durations pass approx=true. */
export function duration(seconds: number, isApprox = false): string {
  const prefix = isApprox ? "~" : "";
  if (seconds < 60) return `${prefix}${Math.round(seconds)}s`;
  if (seconds < 3600) return `${prefix}${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${prefix}${(seconds / 3600).toFixed(1)}h`;
  return `${prefix}${(seconds / 86400).toFixed(1)}d`;
}

export function chars(n: number): string {
  if (n < 1024) return `${n} chars`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function tsLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}
