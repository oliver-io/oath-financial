// The room dashboard: a tiled board of pinned widgets (user directive). Tiles
// are pinned from the sub-pages (or via the picker here) and each tile links
// back to its focused report. Pin state is per-viewer (localStorage).

import { useState } from "react";
import { Link, useLocation } from "react-router";
import { type Side, usePins } from "../../state/pins.ts";
import { widgetById, widgetsFor } from "./widgets.tsx";

const sideColor = (side: Side): string =>
  side === "ops" ? "var(--color-ops)" : "var(--color-product)";

export function WidgetBoard({ side }: { side: Side }) {
  const { pins, pin, unpin } = usePins(side);
  const [pickerOpen, setPickerOpen] = useState(false);
  const location = useLocation();
  const available = widgetsFor(side).filter((w) => !pins.includes(w.id));
  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        <div className="relative">
          <button
            type="button"
            className="cursor-pointer rounded border border-hairline bg-surface px-2 py-1 text-xs text-ink-2 hover:border-ink-3"
            onClick={() => setPickerOpen((v) => !v)}
          >
            ⊕ add widget
          </button>
          {pickerOpen && (
            <div className="absolute right-0 top-8 z-20 w-64 rounded border border-hairline bg-surface p-1.5 shadow-md">
              {available.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-ink-3">
                  Everything pinnable is already on the board.
                </div>
              )}
              {available.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-paper"
                  onClick={() => {
                    pin(w.id);
                    setPickerOpen(false);
                  }}
                >
                  <span className="font-medium text-ink">{w.title}</span>
                  <span className="ml-1.5 text-[10px] text-ink-3">from {w.source}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {pins.length === 0 && (
        <div className="rounded border border-dashed border-hairline bg-paper p-8 text-center text-sm text-ink-3">
          Nothing pinned. Use ⊕ add widget, or pin a construct from any{" "}
          {side === "ops" ? "Ops" : "Product"} page with its 📌 control.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {pins.map((id) => {
          const w = widgetById(id);
          if (!w) return null; // a stale pin from an older widget set
          return (
            <section
              key={w.id}
              className={`min-w-0 rounded border border-hairline bg-surface p-3 ${
                w.span === 2 ? "xl:col-span-2" : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <Link
                  to={{ pathname: w.source, search: location.search }}
                  className="inline-block border-b-2 pb-0.5 text-xs font-medium text-ink hover:text-ink-2"
                  style={{ borderColor: sideColor(side) }}
                  title={`open the full report at ${w.source}`}
                >
                  {w.title} →
                </Link>
                <button
                  type="button"
                  className="cursor-pointer text-xs text-ink-3 hover:text-ink"
                  title="unpin from this dashboard"
                  onClick={() => unpin(w.id)}
                >
                  ✕
                </button>
              </div>
              {w.render()}
            </section>
          );
        })}
      </div>
    </div>
  );
}
