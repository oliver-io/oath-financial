// Shared page chrome: the construct-question title with the side-identity
// underline, and the per-side window-rule caption every view states.

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { CaptionBar } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import { CountSchema, qExcludedSessionCount } from "../data/queries.ts";
import { count } from "../fmt.ts";
import { filtersToSearch } from "../state/urlState.ts";

export function PageTitle({
  side,
  title,
  question,
}: {
  side: "ops" | "product" | null;
  title: string;
  question: string;
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

export function Section({
  title,
  chip,
  right,
  children,
}: {
  title: string;
  chip?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">
          {title} {chip}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}
