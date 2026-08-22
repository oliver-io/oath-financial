// Category cards on the room dashboards: room-colored accent, the page's
// named question as the description, one live summary stat, whole card links.
// Ghost cards share the grid, greyed with their one-line explanations.

import { Link } from "react-router";
import { useLocation } from "react-router";

export function CategoryCard({
  to,
  side,
  title,
  question,
  stat,
  statLabel,
}: {
  to: string;
  side: "ops" | "product";
  title: string;
  question: string;
  stat: string | null;
  statLabel: string;
}) {
  const color = side === "ops" ? "var(--color-ops)" : "var(--color-product)";
  const location = useLocation();
  return (
    <Link
      to={{ pathname: to, search: location.search }}
      className="block rounded border border-hairline bg-surface p-3 hover:border-ink-3"
      style={{ borderTop: `3px solid ${color}` }}
    >
      <div className="text-sm font-medium text-ink">{title}</div>
      <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-ink-3">{question}</p>
      <div className="mt-2">
        <span className="text-lg font-semibold tabular text-ink">{stat ?? "—"}</span>
        <span className="ml-1.5 text-[10px] text-ink-3">{statLabel}</span>
      </div>
    </Link>
  );
}

export function GhostCategoryCard({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded border border-dashed border-hairline bg-paper p-3 text-ink-3 select-none">
      <div className="text-sm font-medium">{title}</div>
      <p className="mt-0.5 text-[11px] leading-snug">{reason}</p>
    </div>
  );
}
