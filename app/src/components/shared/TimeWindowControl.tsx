// First-class CloudWatch-style window control (ui.md §2): presets + explicit
// from/to, global to both sides, URL-encoded. Defaults to the manifest-derived
// full range. Each side's membership rule is stated by the pages, not here.

import { useLocation, useNavigate } from "react-router";
import { useData, useFilters, useWindow } from "../../data/DataContext.tsx";
import { fullRange, presetWindow, type WindowPreset } from "../../data/window.ts";
import { dayLabel } from "../../fmt.ts";
import { filtersToSearch } from "../../state/urlState.ts";

const PRESETS: WindowPreset[] = ["24h", "7d", "30d", "full"];

export function TimeWindowControl() {
  const { manifest } = useData();
  const filters = useFilters();
  const win = useWindow();
  const navigate = useNavigate();
  const location = useLocation();
  const full = fullRange(manifest);

  const apply = (fromDay: string, toDay: string, isFull: boolean) => {
    const next = { ...filters, window: isFull ? null : { fromDay, toDay } };
    navigate({ pathname: location.pathname, search: filtersToSearch(next) }, { replace: false });
  };

  const activePreset: WindowPreset | null = (() => {
    // check "full" first: a clamped preset can coincide with the full range
    for (const p of [...PRESETS].reverse()) {
      const w = presetWindow(p, manifest);
      if (w.fromDay === win.fromDay && w.toDay === win.toDay) return p;
    }
    return null;
  })();

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex overflow-hidden rounded border border-hairline">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="px-2 py-1 cursor-pointer border-r border-hairline last:border-r-0"
            style={
              activePreset === p
                ? { background: "var(--color-ink)", color: "var(--color-surface)" }
                : { background: "var(--color-surface)", color: "var(--color-ink-2)" }
            }
            onClick={() => {
              const w = presetWindow(p, manifest);
              apply(w.fromDay, w.toDay, p === "full");
            }}
          >
            {p === "full" ? "Full range" : p}
          </button>
        ))}
      </div>
      <input
        type="date"
        className="rounded border border-hairline bg-surface px-1.5 py-0.5 tabular"
        value={win.fromDay}
        min={full.fromDay}
        max={win.toDay}
        onChange={(e) => {
          if (e.target.value) apply(e.target.value, win.toDay, false);
        }}
      />
      <span className="text-ink-3">→</span>
      <input
        type="date"
        className="rounded border border-hairline bg-surface px-1.5 py-0.5 tabular"
        value={win.toDay}
        min={win.fromDay}
        max={full.toDay}
        onChange={(e) => {
          if (e.target.value) apply(win.fromDay, e.target.value, false);
        }}
      />
      <span className="text-ink-3">
        coverage {dayLabel(full.fromDay)} – {dayLabel(full.toDay)}
      </span>
    </div>
  );
}
