// Shared page chrome: page titles with inline stat tiles, the window-rule
// captions, and PanelSection — the page-side render of a registry panel
// (title + chips + pin control + anchored detail view).

import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { widgetById } from "../components/dashboard/widgets.tsx";
import { CaptionBar } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import { CountSchema, qExcludedSessionCount } from "../data/queries.ts";
import { count } from "../fmt.ts";
import { type Side as PinSide, usePins } from "../state/pins.ts";
import { filtersToSearch } from "../state/urlState.ts";

/** Pin toggle: pinning adds the panel's widget view to the room's board; the
 * page keeps the detail view. data-pin-id backs the pinnability invariant. */
export function PinControl({ id, side }: { id: string; side: PinSide }) {
  const { isPinned, pin, unpin } = usePins(side);
  const pinned = isPinned(id);
  const title = widgetById(id)?.title ?? id;
  return (
    <button
      type="button"
      data-pin-id={id}
      className="shrink-0 cursor-pointer text-xs"
      style={{
        color: pinned
          ? side === "ops"
            ? "var(--color-ops)"
            : "var(--color-product)"
          : "var(--color-ink-3)",
      }}
      title={
        pinned ? `unpin "${title}" from the room dashboard` : `pin "${title}" to the room dashboard`
      }
      onClick={() => (pinned ? unpin(id) : pin(id))}
    >
      📌 {pinned ? "pinned" : "pin"}
    </button>
  );
}

/** The page-side render of a registry panel: one shared title (identical to
 * the dashboard tile's), chips, the pin control, and the DETAIL view, at an
 * anchor the dashboard tile links to. */
export function PanelSection({ id }: { id: string }) {
  const def = widgetById(id);
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash !== `#panel-${id}`) return;
    // panels above may still be resolving queries at mount; keep re-anchoring
    // until the page reports settled (data-capture-state), then once more
    const scroll = () => ref.current?.scrollIntoView({ behavior: "auto", block: "start" });
    scroll();
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      scroll();
      const settled = document.documentElement.dataset.captureState === "ready";
      if ((settled && ticks >= 5) || ticks > 20) clearInterval(timer);
    }, 400);
    return () => clearInterval(timer);
  }, [location.hash, id]);
  if (!def) return null;
  return (
    <section id={`panel-${id}`} ref={ref} className="mb-8 scroll-mt-28">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">
          {def.title} {def.chip?.()}
        </h2>
        <PinControl id={id} side={def.side} />
      </div>
      {def.detail()}
    </section>
  );
}

export function PageTitle({
  side,
  title,
  question,
  stats,
}: {
  side: "ops" | "product" | null;
  title: string;
  question: string;
  /** The page's stat panels, rendered as visible inline tiles here (their
   * natural home) with their pin controls. */
  stats?: { id: string; side: PinSide }[];
}) {
  const color =
    side === "ops"
      ? "var(--color-ops)"
      : side === "product"
        ? "var(--color-product)"
        : "var(--color-ink)";
  return (
    <div className="mb-4">
      <h1
        className="inline-block border-b-2 pb-1 text-lg font-semibold"
        style={{ borderColor: color }}
      >
        {title}
      </h1>
      <p className="mt-1 text-sm text-ink-3">{question}</p>
      {stats && stats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {stats.map(({ id, side: statSide }) => {
            const w = widgetById(id);
            if (!w) return null;
            return (
              <div key={id} className="min-w-56 rounded border border-hairline bg-surface p-3">
                <div className="mb-1 flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-ink">{w.title}</span>
                  <PinControl id={id} side={statSide} />
                </div>
                {w.detail()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Ops pages: event-timestamp membership; nothing is excluded. */
export function EventSemanticsCaption() {
  return (
    <CaptionBar>
      <span>
        Window rule: an event counts iff its timestamp is in the window (event semantics).
      </span>
    </CaptionBar>
  );
}

/** Product session-grain views: whole containment + the visible excluded-count
 * caption, clickable to list the excluded sessions (ui.md §2). */
export function ContainmentCaption() {
  const win = useWindow();
  const filters = useFilters();
  const location = useLocation();
  const excluded = useRows(CountSchema, qExcludedSessionCount(win, filters), null);
  const n = excluded.rows?.[0]?.n ?? null;
  return (
    <CaptionBar>
      <span>Window rule: a session counts only if it began and ended inside the window.</span>
      {n !== null && n > 0 && (
        <Link
          to={{
            pathname: location.pathname,
            search: filtersToSearch({ ...filters, session: "excluded" }),
          }}
          className="underline decoration-dotted"
          title="Whole-session containment censors long sessions near window boundaries; the default full-range window avoids this. Click to list the excluded sessions."
        >
          {count(n)} session{n === 1 ? "" : "s"} overlap this window but aren't fully contained
          (excluded)
        </Link>
      )}
      {n === 0 && <span>No overlapping sessions excluded.</span>}
    </CaptionBar>
  );
}
