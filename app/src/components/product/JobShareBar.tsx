// Job-type share horizontal bars (ui.md §3 /product/usage) — shared between
// the Usage tab and the dashboard's compact headline (same component, compact
// prop). Session grain (containment); bar click → outcomes filtered.

import { JobTypeSchema } from "@trace-insights/contracts";
import { Link } from "react-router";
import type { z } from "zod";
import { useFilters } from "../../data/DataContext.tsx";
import type { JobShareSchema } from "../../data/queries.ts";
import { count, pct } from "../../fmt.ts";
import { filtersToSearch } from "../../state/urlState.ts";

type Row = z.infer<typeof JobShareSchema>;

export function JobShareBar({ rows, compact = false }: { rows: Row[]; compact?: boolean }) {
  const filters = useFilters();
  const shown = compact ? rows.slice(0, 5) : rows;
  const totalSessions = rows.reduce((a, r) => a + r.n, 0);
  const top3 = rows.slice(0, 3).reduce((a, r) => a + r.n, 0);
  const maxShare = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div>
      <p className="mb-2 text-xs text-ink-2">
        Top 3 job types ={" "}
        <span className="font-medium tabular">
          {totalSessions > 0 ? pct(top3 / totalSessions) : "—"}
        </span>{" "}
        of {count(totalSessions)} contained sessions.
      </p>
      {shown.map((r) => {
        const job = r.job_type ?? "(not classified)";
        return (
          <div key={job} className="mb-1 flex items-center gap-2 text-xs">
            <span className={`${compact ? "w-32" : "w-40"} truncate text-right text-ink-2`}>
              {job}
            </span>
            <Link
              to={{
                pathname: "/product/outcomes",
                search: filtersToSearch({
                  ...filters,
                  jobTypes:
                    r.job_type && JobTypeSchema.options.includes(r.job_type as never)
                      ? [r.job_type as never]
                      : [],
                }),
              }}
              className="block h-3.5 rounded-r-sm"
              style={{
                width: `${(r.n / maxShare) * (compact ? 45 : 55)}%`,
                background: r.job_type ? "var(--color-product)" : "var(--color-grid)",
                minWidth: 3,
              }}
              title={`${job}: ${count(r.n)} sessions — click for outcomes`}
            />
            <span className="tabular text-ink-3">{count(r.n)}</span>
          </div>
        );
      })}
      {compact && rows.length > shown.length && (
        <p className="text-[10px] text-ink-3">+{rows.length - shown.length} more in Usage</p>
      )}
    </div>
  );
}
