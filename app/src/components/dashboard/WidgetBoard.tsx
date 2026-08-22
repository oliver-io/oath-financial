// The room dashboard: a tiled board of pinned panels in their WIDGET view.
// Panels are pinned from their pages (📌 on each construct); the board only
// unpins. Tile titles link to the anchored detail view on the source page.
// Pin state is per-viewer (localStorage).

import { Link, useLocation } from "react-router";
import { type Side, usePins } from "../../state/pins.ts";
import { widgetById } from "./widgets.tsx";

const sideColor = (side: Side): string =>
  side === "ops" ? "var(--color-ops)" : "var(--color-product)";

const SIZE_CLASS: Record<"stat" | "half" | "full", string> = {
  stat: "grow basis-52 max-w-sm",
  half: "grow basis-[26rem]",
  full: "basis-full",
};

export function WidgetBoard({ side }: { side: Side }) {
  const { pins, unpin } = usePins(side);
  const location = useLocation();
  return (
    <div>
      {pins.length === 0 && (
        <div className="rounded border border-dashed border-hairline bg-paper p-8 text-center text-sm text-ink-3">
          Nothing pinned yet. Open any {side === "ops" ? "Ops" : "Product"} page and use a
          construct's 📌 control to pin it here.
        </div>
      )}
      <div className="flex flex-wrap items-stretch gap-4">
        {pins.map((id) => {
          const w = widgetById(id);
          if (!w) return null; // a stale pin from an older panel set
          return (
            <section
              key={w.id}
              className={`min-w-0 rounded border border-hairline bg-surface p-3 ${SIZE_CLASS[w.size]}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <Link
                  to={{
                    pathname: w.source,
                    search: location.search,
                    hash: `#panel-${w.id}`,
                  }}
                  className="inline-block border-b-2 pb-0.5 text-xs font-medium text-ink hover:text-ink-2"
                  style={{ borderColor: sideColor(side) }}
                  title={`open the detail view at ${w.source}`}
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
              {(w.widget ?? w.detail)()}
            </section>
          );
        })}
      </div>
    </div>
  );
}
