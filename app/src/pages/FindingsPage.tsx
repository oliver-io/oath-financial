// / — the Dashboard (ui.md §3 "/ Dashboard", user-directive revision): three
// zones — (1) ranked finding cards from ref/findings (rule-generated, never
// model prose; audiences render as the README personas OPERATIONS/PRODUCT);
// (2) the top-level visuals rendered compact, same components as the room
// versions, click-through to their tabs; (3) a category-card grid, one card
// per sub-page with a live summary stat — ghost cards sit in the same grid.

import { parseIntArray, parseTargetParams } from "@trace-insights/contracts";
import { Link, useLocation } from "react-router";
import { z } from "zod";
import { ActivityStrips } from "../components/ops/ActivityStrips.tsx";
import { FailureTimeSeries } from "../components/ops/FailureTimeSeries.tsx";
import { JobShareBar } from "../components/product/JobShareBar.tsx";
import { ErrorState, ProvenanceChip, Skeleton } from "../components/shared/honesty.tsx";
import { Sparkline } from "../components/shared/microviz.tsx";
import { useData, useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  AuditorDaySchema,
  DashboardStatsSchema,
  FailureSeriesPointSchema,
  IncidentRowQ,
  JobShareSchema,
  qAuditorDaily,
  qDashboardStats,
  qFailureSeries,
  qIncidents,
  qJobShare,
} from "../data/queries.ts";
import { count, pct } from "../fmt.ts";
import { DEFAULT_FILTERS, type FilterState, filtersToSearch } from "../state/urlState.ts";
import { PageTitle } from "./PageScaffold.tsx";

// ---------------------------------------------------------------- findings

const FindingRowQ = z.object({
  finding_id: z.string(),
  rank: z.number(),
  audience: z.string(),
  title: z.string(),
  metric_value: z.number().nullable(),
  metric_label: z.string().nullable(),
  sparkline: z.string(),
  series_start_day: z.string().nullable(),
  target_params: z.string(),
  provenance: z.string(),
  requires_enrichment: z.boolean(),
});
type Finding = z.infer<typeof FindingRowQ>;

function targetLink(f: Finding, base: FilterState): string {
  const p = parseTargetParams(f.target_params);
  const filters: FilterState = { ...DEFAULT_FILTERS, includeDemo: base.includeDemo };
  if (typeof p.from === "string" && typeof p.to === "string")
    filters.window = { fromDay: p.from, toDay: p.to };
  if (typeof p.signature === "string" && p.signature) filters.signature = p.signature;
  if (typeof p.gap === "string" && p.gap) filters.gap = p.gap;
  const path =
    p.side === "ops" ? "/ops" : p.page === "usage" ? "/product/usage" : "/product/outcomes";
  return `${path}${filtersToSearch(filters)}`;
}

function AudienceTag({ audience }: { audience: string }) {
  const isOps = audience === "ops";
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wider"
      style={{
        color: isOps ? "var(--color-ops)" : "var(--color-product)",
        background: isOps ? "var(--color-ops-soft)" : "var(--color-product-soft)",
      }}
    >
      {isOps ? "OPERATIONS" : "PRODUCT"}
    </span>
  );
}

const chipKind = (p: string): "heuristic" | "curated" | "model" | null =>
  p === "heuristic" || p === "curated" || p === "model" ? p : null;

function FindingCards() {
  const { degraded } = useData();
  const filters = useFilters();
  const findings = useRows(FindingRowQ, "SELECT * FROM findings ORDER BY rank LIMIT 8", null);
  return (
    <section className="mb-8">
      {findings.error && <ErrorState message={findings.error} />}
      {findings.loading && <Skeleton lines={5} />}
      {findings.rows && findings.rows.length === 0 && (
        <div className="mb-4 rounded border border-hairline bg-paper p-4 text-sm text-ink-3">
          No findings met their thresholds for this run.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:[&>div:last-child:nth-child(odd)]:col-span-2">
        {(findings.rows ?? []).map((f) => {
          const kind = chipKind(f.provenance);
          const spark = parseIntArray(f.sparkline);
          return (
            <div
              key={f.finding_id}
              className="flex items-center justify-between gap-4 rounded border border-hairline bg-surface p-3"
            >
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <AudienceTag audience={f.audience} />
                  {kind && (
                    <ProvenanceChip kind={kind} method="threshold rule over derived tables" />
                  )}
                </div>
                <p className="text-sm text-ink">{f.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {spark.length > 0 ? (
                  <Sparkline values={spark} width={90} height={30} />
                ) : f.metric_value !== null ? (
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular text-ink">
                      {count(f.metric_value)}
                    </div>
                    <div className="text-[10px] text-ink-3">{f.metric_label}</div>
                  </div>
                ) : null}
                <Link
                  to={targetLink(f, filters)}
                  className="rounded border border-hairline px-2 py-1 text-xs font-medium text-ink-2 hover:border-ink-3"
                >
                  open →
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      {degraded.any && (
        <p className="mt-3 text-xs text-ink-3">
          Enrichment did not run for this publish — only rule-only findings are shown; cards that
          need model-classified fields will appear on an enriched run.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------- compact visuals

function CompactPanel({
  title,
  to,
  side,
  children,
}: {
  title: string;
  to: string;
  side: "ops" | "product";
  children: React.ReactNode;
}) {
  const location = useLocation();
  return (
    <div className="min-w-0 rounded border border-hairline bg-surface p-3">
      <Link
        to={{ pathname: to, search: location.search }}
        className="mb-2 inline-block border-b-2 pb-0.5 text-xs font-medium text-ink hover:text-ink-2"
        style={{ borderColor: side === "ops" ? "var(--color-ops)" : "var(--color-product)" }}
      >
        {title} →
      </Link>
      {children}
    </div>
  );
}

function TopVisuals() {
  const win = useWindow();
  const filters = useFilters();
  const series = useRows(FailureSeriesPointSchema, qFailureSeries(win, filters), win);
  const incidents = useRows(IncidentRowQ, qIncidents(), null);
  const jobShare = useRows(JobShareSchema, qJobShare(win, filters), null);
  const daily = useRows(AuditorDaySchema, qAuditorDaily(win, filters), win);
  return (
    <section className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <CompactPanel title="Failures over time" to="/ops" side="ops">
        {series.loading && <Skeleton progress={series.fetchProgress} />}
        {series.rows && incidents.rows && (
          <FailureTimeSeries
            points={series.rows}
            incidents={incidents.rows}
            win={win}
            filters={filters}
          />
        )}
      </CompactPanel>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CompactPanel title="Job-type share" to="/product/usage" side="product">
          {jobShare.loading && <Skeleton />}
          {jobShare.rows && <JobShareBar rows={jobShare.rows} compact />}
        </CompactPanel>
        <CompactPanel title="Daily activity" to="/ops/rhythm" side="ops">
          {daily.loading && <Skeleton progress={daily.fetchProgress} />}
          {daily.rows && <ActivityStrips rows={daily.rows} win={win} compact />}
        </CompactPanel>
      </div>
    </section>
  );
}

// ---------------------------------------------------------- category cards

function CategoryCard({
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
  return (
    <Link
      to={to}
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

function CategoryGrid() {
  const win = useWindow();
  const filters = useFilters();
  const stats = useRows(DashboardStatsSchema, qDashboardStats(win, filters), win);
  const s = stats.rows?.[0];
  return (
    <section>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CategoryCard
          to="/ops"
          side="ops"
          title="Failures & incidents"
          question="What is breaking, how badly, one-off or systemic?"
          stat={s ? count(s.failure_events) : null}
          statLabel="failure events in window"
        />
        <CategoryCard
          to="/ops/environments"
          side="ops"
          title="Environments"
          question="Which client box is unhealthy?"
          stat={s ? count(s.active_clients) : null}
          statLabel="clients active in window"
        />
        <CategoryCard
          to="/ops/rhythm"
          side="ops"
          title="Working rhythm"
          question="How does work actually flow, per auditor and engagement?"
          stat={s ? count(s.active_auditors) : null}
          statLabel="auditors active in window"
        />
        <CategoryCard
          to="/product/usage"
          side="product"
          title="Usage"
          question="Who uses this, for what work, where is it concentrated?"
          stat={s ? count(s.turns) : null}
          statLabel="turns in window"
        />
        <CategoryCard
          to="/product/outcomes"
          side="product"
          title="Outcomes"
          question="Do tasks finish, and what do they cost in human interactions?"
          stat={s ? `${count(s.determined)} of ${count(s.contained)}` : null}
          statLabel="contained sessions determined"
        />
        <CategoryCard
          to="/product/agent"
          side="product"
          title="Agent behavior"
          question="Where does the agent thrash, retry, or get corrected?"
          stat={s ? count(s.chain_turns) : null}
          statLabel="turns with identical-input chains"
        />
        <div className="rounded border border-dashed border-hairline bg-paper p-3 text-ink-3 select-none">
          <div className="text-sm font-medium">Cost analysis</div>
          <p className="mt-0.5 text-[11px] leading-snug">
            This telemetry undercounts tokens 15–20× (single-generation capture); any dollar or
            token figure would be invented.
          </p>
        </div>
        <div className="rounded border border-dashed border-hairline bg-paper p-3 text-ink-3 select-none">
          <div className="text-sm font-medium">Tool latency</div>
          <p className="mt-0.5 text-[11px] leading-snug">
            Durations record telemetry write time, not execution time; a "slowest tool" view would
            rank noise.
          </p>
        </div>
      </div>
      {stats.rows?.[0] && (
        <p className="mt-2 text-[10px] text-ink-3">
          Card stats: event counts use event-timestamp membership; the outcomes stat counts
          whole-contained sessions (
          {pct(
            stats.rows[0].contained > 0 ? stats.rows[0].determined / stats.rows[0].contained : 0,
          )}{" "}
          determined).
        </p>
      )}
    </section>
  );
}

export function FindingsPage() {
  return (
    <div>
      <PageTitle side={null} title="Dashboard" question="What should I act on this week?" />
      <FindingCards />
      <TopVisuals />
      <CategoryGrid />
    </div>
  );
}
