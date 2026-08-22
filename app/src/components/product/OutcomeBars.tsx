// Outcome bars per job type (ui.md §3 /product/outcomes): stacked horizontal
// bars — completed / abandoned / undetermined (first-class hatched grey,
// always in the legend with its count) / unclassified (abstention/error, its
// own slice) / not-classified (NULL: job not run). Custom SVG for the hatch.
// The view leads with "N of M determined"; its headline number is
// completion-rate-among-determined.

import type { JobType } from "@trace-insights/contracts";
import { Link } from "react-router";
import type { z } from "zod";
import { useData, useFilters } from "../../data/DataContext.tsx";
import type { OutcomeCountSchema } from "../../data/queries.ts";
import { count, pct } from "../../fmt.ts";
import { filtersToSearch } from "../../state/urlState.ts";
import { CaptionBar, ProvenanceChip } from "../shared/honesty.tsx";

type Row = z.infer<typeof OutcomeCountSchema>;

const SLICES = [
  { key: "completed", label: "completed", fill: "var(--color-series-4)", hatch: false },
  { key: "abandoned", label: "abandoned", fill: "var(--color-series-7)", hatch: false },
  { key: "undetermined", label: "undetermined", fill: "url(#hatch-undetermined)", hatch: true },
  {
    key: "unclassified",
    label: "unclassified (abstained/error)",
    fill: "var(--color-unclassified)",
    hatch: false,
  },
  { key: "__null", label: "not classified (job not run)", fill: "var(--color-grid)", hatch: false },
] as const;

export function OutcomeBars({ rows }: { rows: Row[] }) {
  const { degraded } = useData();
  const filters = useFilters();
  const byJob = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const job = r.job_type ?? "(job not classified)";
    const oc = r.outcome ?? "__null";
    const m = byJob.get(job) ?? new Map<string, number>();
    m.set(oc, (m.get(oc) ?? 0) + r.n);
    byJob.set(job, m);
  }
  let determined = 0;
  let completedN = 0;
  let total = 0;
  for (const [, m] of byJob) {
    for (const [oc, n] of m) {
      total += n;
      if (oc === "completed" || oc === "abandoned") determined += n;
      if (oc === "completed") completedN += n;
    }
  }
  for (const s of SLICES)
    totals.set(
      s.key,
      rows.filter((r) => (r.outcome ?? "__null") === s.key).reduce((a, r) => a + r.n, 0),
    );
  const jobs = [...byJob.keys()].sort(
    (a, b) =>
      [...(byJob.get(b)?.values() ?? [])].reduce((x, y) => x + y, 0) -
      [...(byJob.get(a)?.values() ?? [])].reduce((x, y) => x + y, 0),
  );
  const maxTotal = Math.max(
    1,
    ...jobs.map((j) => [...(byJob.get(j)?.values() ?? [])].reduce((a, b) => a + b, 0)),
  );
  const W = 420;
  const ROW_H = 24;

  return (
    <div>
      <CaptionBar>
        <span className="font-medium text-ink">
          {count(determined)} of {count(total)} sessions determined
        </span>
        <span>
          completion rate among determined:{" "}
          <span className="font-medium text-ink tabular">
            {determined > 0 ? pct(completedN / determined) : "—"}
          </span>{" "}
          <ProvenanceChip
            kind="model"
            method="J3 outcome classification over determined sessions"
          />
        </span>
        {degraded.j3 && <span>enrichment not run — outcomes unavailable this run</span>}
      </CaptionBar>
      <svg width={W + 260} height={jobs.length * ROW_H + 8} className="mt-2 max-w-full">
        <title>session outcomes per job type</title>
        {jobs.map((job, i) => {
          const m = byJob.get(job);
          const jobTotal = [...(m?.values() ?? [])].reduce((a, b) => a + b, 0);
          let x = 150;
          const y = i * ROW_H + 4;
          return (
            <g key={job}>
              <text x={144} y={y + 11} textAnchor="end" fontSize={11} fill="var(--color-ink-2)">
                {job}
              </text>
              {SLICES.map((s) => {
                const n = m?.get(s.key) ?? 0;
                if (n === 0) return null;
                const w = Math.max(2, (n / maxTotal) * W);
                const rect = (
                  <g key={s.key}>
                    <rect x={x} y={y} width={w - 2} height={14} rx={3} fill={s.fill}>
                      <title>{`${job}: ${s.label} — ${n}`}</title>
                    </rect>
                  </g>
                );
                x += w;
                return rect;
              })}
              <text
                x={x + 4}
                y={y + 11}
                fontSize={10}
                fill="var(--color-ink-3)"
                className="tabular"
              >
                {count(jobTotal)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {SLICES.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <svg width={12} height={12} role="img" aria-label={s.label}>
              <rect width={12} height={12} rx={2} fill={s.fill} />
            </svg>
            {s.label} <span className="tabular text-ink-3">({count(totals.get(s.key) ?? 0)})</span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {jobs.slice(0, 6).map((job) => (
          <Link
            key={job}
            className="rounded border border-hairline px-1.5 py-0.5 text-ink-2 hover:border-ink-3"
            to={{
              pathname: "/product/outcomes",
              search: filtersToSearch({
                ...filters,
                jobTypes: job.startsWith("(") ? [] : [job as JobType],
              }),
            }}
          >
            {job} sessions →
          </Link>
        ))}
      </div>
    </div>
  );
}
