// /ops — the OPS room dashboard: ops findings, the room's headline visuals
// rendered compact (same components as the full pages), and category cards
// for the room's sub-pages with live stats.

import { CategoryCard, GhostCategoryCard } from "../components/dashboard/CategoryCard.tsx";
import { FindingCards } from "../components/dashboard/FindingCards.tsx";
import { ActivityStrips } from "../components/ops/ActivityStrips.tsx";
import { FailureTimeSeries } from "../components/ops/FailureTimeSeries.tsx";
import { Skeleton } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  AuditorDaySchema,
  DashboardStatsSchema,
  FailureSeriesPointSchema,
  IncidentRowQ,
  qAuditorDaily,
  qDashboardStats,
  qFailureSeries,
  qIncidents,
} from "../data/queries.ts";
import { count } from "../fmt.ts";
import { CompactPanel } from "../components/dashboard/CompactPanel.tsx";
import { PageTitle } from "./PageScaffold.tsx";

export function OpsDashboardPage() {
  const win = useWindow();
  const filters = useFilters();
  const series = useRows(FailureSeriesPointSchema, qFailureSeries(win, filters), win);
  const incidents = useRows(IncidentRowQ, qIncidents(), null);
  const daily = useRows(AuditorDaySchema, qAuditorDaily(win, filters), win);
  const stats = useRows(DashboardStatsSchema, qDashboardStats(win, filters), win);
  const s = stats.rows?.[0];
  return (
    <div>
      <PageTitle side="ops" title="Ops" question="Is the system healthy?" />
      <FindingCards audience="ops" />
      <section className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CompactPanel title="Failures over time" to="/ops/failures" side="ops">
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
        </div>
        <CompactPanel title="Daily activity" to="/ops/rhythm" side="ops">
          {daily.loading && <Skeleton progress={daily.fetchProgress} />}
          {daily.rows && <ActivityStrips rows={daily.rows} win={win} compact />}
        </CompactPanel>
      </section>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CategoryCard
          to="/ops/failures"
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
        <GhostCategoryCard
          title="Tool latency"
          reason="Durations record telemetry write time, not execution time; a 'slowest tool' view would rank noise."
        />
      </section>
      <p className="mt-2 text-[10px] text-ink-3">
        Card stats use event-timestamp membership (ops window rule).
      </p>
    </div>
  );
}
