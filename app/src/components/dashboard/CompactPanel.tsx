// Titled dashboard panel with a room-colored title underline; the title links
// to the full page, carrying the current URL state.

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

export function CompactPanel({
  title,
  to,
  side,
  children,
}: {
  title: string;
  to: string;
  side: "ops" | "product";
  children: ReactNode;
}) {
  const location = useLocation();
  return (
    <div className="min-w-0 rounded border border-hairline bg-surface p-3">
      <Link
        to={{ pathname: to, search: location.search }}
        className="mb-2 inline-block border-b-2 pb-0.5 text-xs font-medium text-ink hover:text-ink-2"
        style={{
          borderColor: side === "ops" ? "var(--color-ops)" : "var(--color-product)",
        }}
      >
        {title} →
      </Link>
      {children}
    </div>
  );
}
