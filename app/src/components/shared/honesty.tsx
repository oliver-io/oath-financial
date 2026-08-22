// Shared honesty affordances (app.md §5): ProvenanceChip, StatedParam ⚙,
// CaptionBar, GhostCard, hatch defs. These are components, not per-chart
// styling — constructs cannot deviate because they never restyle these.

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { trackCapture } from "../../data/captureState.ts";

/** Reports a mounted honesty state into the capture-state contract. */
function useCaptureKind(kind: "error" | "empty"): void {
  useEffect(() => {
    trackCapture(kind, 1);
    return () => trackCapture(kind, -1);
  }, [kind]);
}

const CHIP: Record<string, { letter: string; color: string; label: string }> = {
  heuristic: { letter: "H", color: "var(--color-chip-heuristic)", label: "heuristic" },
  curated: { letter: "C", color: "var(--color-chip-curated)", label: "curated" },
  model: { letter: "M", color: "var(--color-chip-model)", label: "model" },
};

/** Outline-letter provenance chip. Unchipped = structural (the app-header
 * legend states the convention); never render a chip for structural values. */
export function ProvenanceChip({
  kind,
  method,
}: {
  kind: "heuristic" | "curated" | "model";
  method?: string;
}) {
  const c = CHIP[kind];
  if (!c) return null;
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] font-semibold leading-none align-middle select-none"
      style={{ color: c.color, borderColor: c.color }}
      title={`${c.label}${method ? ` — ${method}` : ""}`}
    >
      {c.letter}
    </span>
  );
}

/** ⚙ stated parameter: value + one-line rationale, display-only (ui.md §5). */
export function StatedParam({
  label,
  value,
  rationale,
}: {
  label: string;
  value: string;
  rationale: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        className="text-ink-3 hover:text-ink-2 text-xs cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        title={`${label}: ${value}`}
      >
        ⚙<span className="ml-0.5 tabular">{value}</span>
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-20 w-64 rounded border border-hairline bg-surface p-2 text-xs text-ink-2 shadow-sm">
          <span className="font-medium text-ink">
            {label} = {value}
          </span>
          <br />
          {rationale}
        </span>
      )}
    </span>
  );
}

/** Data-driven caption bar ("N of M determined", "N excluded") — captions are
 * props from query results, never hardcoded. */
export function CaptionBar({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 text-xs text-ink-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      {children}
    </div>
  );
}

/** Disabled ghost card for views the data cannot support (ui.md §5). Quiet:
 * grey ramp, one sentence, no illustrations. */
export function GhostCard({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded border border-dashed border-hairline bg-paper p-4 text-ink-3 select-none">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-1 text-xs">{reason}</p>
    </div>
  );
}

/** Mounted once in the shell: the 45° hatch defs (the uncertainty texture) and
 * the dotted small-n pattern. Referenced as url(#hatch-undetermined) etc. */
export function HatchDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <pattern
          id="hatch-undetermined"
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="var(--color-undetermined)" opacity="0.35" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-undetermined)" strokeWidth="2" />
        </pattern>
        <pattern
          id="hatch-demo"
          patternUnits="userSpaceOnUse"
          width="6"
          height="6"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="transparent" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--color-ops)"
            strokeWidth="1.5"
            opacity="0.6"
          />
        </pattern>
        <pattern id="dot-small-n" patternUnits="userSpaceOnUse" width="5" height="5">
          <circle cx="2" cy="2" r="1" fill="var(--color-ink-3)" opacity="0.7" />
        </pattern>
      </defs>
    </svg>
  );
}

/** First-class empty state (infrastructure.md "presents as REAL"). */
export function EmptyState({ children }: { children: ReactNode }) {
  useCaptureKind("empty");
  return (
    <div className="rounded border border-hairline bg-paper p-6 text-sm text-ink-3">{children}</div>
  );
}

/** Per-construct error state with retry — never a blank page (app.md §4). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  useCaptureKind("error");
  return (
    <div className="rounded border border-hairline bg-failure-soft p-4 text-sm text-ink-2">
      <span className="font-medium text-failure">Couldn't load this view.</span> {message}
      {onRetry && (
        <button type="button" className="ml-2 underline cursor-pointer" onClick={onRetry}>
          retry
        </button>
      )}
    </div>
  );
}

/** Per-partition loading skeleton. */
export function Skeleton({
  lines = 3,
  progress,
}: {
  lines?: number;
  progress?: { done: number; total: number } | null;
}) {
  return (
    <div className="animate-pulse space-y-2 py-2">
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static decorative rows with no identity
        <div key={i} className="h-3 rounded bg-grid" style={{ width: `${90 - i * 15}%` }} />
      ))}
      {progress && progress.total > 0 && (
        <div className="text-xs text-ink-3">
          loading partitions {progress.done}/{progress.total}
        </div>
      )}
    </div>
  );
}
