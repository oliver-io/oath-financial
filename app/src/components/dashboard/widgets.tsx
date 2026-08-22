// Widget registry for the room dashboards (user directive): each widget is a
// self-contained compact render of a construct from one of the room's
// sub-pages — the sub-page keeps the focused report; the dashboard tile links
// back to it. Every renderer fetches its own rows through the same queries.ts
// entries the full pages use, so semantics cannot fork.

import type { ReactNode } from "react";
import { useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import {
  AuditorDaySchema,
  DashboardStatsSchema,
  FailureSeriesPointSchema,
  IncidentRowQ,
  JobShareSchema,
  OutcomeCountSchema,
  qAuditorDaily,
  qDashboardStats,
  qFailureSeries,
  qIncidents,
  qJobShare,
  qOutcomesByJob,
} from "../../data/queries.ts";
import { count } from "../../fmt.ts";
import type { Side } from "../../state/pins.ts";
import { ActivityStrips } from "../ops/ActivityStrips.tsx";
import { FailureTimeSeries } from "../ops/FailureTimeSeries.tsx";
import { JobShareBar } from "../product/JobShareBar.tsx";
import { OutcomeBars } from "../product/OutcomeBars.tsx";
import { Skeleton } from "../shared/honesty.tsx";

export interface WidgetDef {
  id: string;
  side: Side;
  title: string;
  /** The sub-page carrying the focused report; the tile header links here. */
  source: string;
  /** Content-fitted flex sizing: stat tiles pack several per row, half
   * widgets pair up, full widgets take the whole row. */
  size: "stat" | "half" | "full";
  render: () => ReactNode;
}

// ---- widget renderers (each fetches its own data) ---------------------------

function FailureSeriesWidget() {
  const win = useWindow();
  const filters = useFilters();
  const series = useRows(FailureSeriesPointSchema, qFailureSeries(win, filters), win);
  const incidents = useRows(IncidentRowQ, qIncidents(), null);
  if (series.loading || incidents.loading) return <Skeleton progress={series.fetchProgress} />;
  if (!series.rows || !incidents.rows) return null;
  return (
    <FailureTimeSeries
      points={series.rows}
      incidents={incidents.rows}
      win={win}
      filters={filters}
    />
  );
}

function ActivityStripsWidget() {
  const win = useWindow();
  const filters = useFilters();
  const daily = useRows(AuditorDaySchema, qAuditorDaily(win, filters), win);
  if (daily.loading) return <Skeleton progress={daily.fetchProgress} />;
  return daily.rows ? <ActivityStrips rows={daily.rows} win={win} compact /> : null;
}

function JobShareWidget() {
  const win = useWindow();
  const filters = useFilters();
  const jobShare = useRows(JobShareSchema, qJobShare(win, filters), null);
  if (jobShare.loading) return <Skeleton />;
  return jobShare.rows ? <JobShareBar rows={jobShare.rows} compact /> : null;
}

function OutcomeBarsWidget() {
  const win = useWindow();
  const filters = useFilters();
  const outcomes = useRows(OutcomeCountSchema, qOutcomesByJob(win, filters), null);
  if (outcomes.loading) return <Skeleton />;
  return outcomes.rows ? <OutcomeBars rows={outcomes.rows} /> : null;
}

/** One stat tile off the shared dashboard-stats query. */
function StatWidget({
  pick,
  label,
  caption,
}: {
  pick: (s: {
    failure_events: number;
    active_clients: number;
    active_auditors: number;
    turns: number;
    determined: number;
    contained: number;
    chain_turns: number;
  }) => string;
  label: string;
  caption: string;
}) {
  const win = useWindow();
  const filters = useFilters();
  const stats = useRows(DashboardStatsSchema, qDashboardStats(win, filters), win);
  const s = stats.rows?.[0];
  if (stats.loading) return <Skeleton lines={2} />;
  return (
    <div>
      <div className="text-2xl font-semibold tabular text-ink">{s ? pick(s) : "—"}</div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-1 text-[10px] text-ink-3">{caption}</div>
    </div>
  );
}

// ---- the registry -----------------------------------------------------------

export const WIDGETS: WidgetDef[] = [
  {
    id: "failure-series",
    side: "ops",
    title: "Failures over time",
    source: "/ops/failures",
    size: "full",
    render: () => <FailureSeriesWidget />,
  },
  {
    id: "activity-strips",
    side: "ops",
    title: "Daily activity",
    source: "/ops/rhythm",
    size: "half",
    render: () => <ActivityStripsWidget />,
  },
  {
    id: "stat-failure-events",
    side: "ops",
    title: "Failure events",
    source: "/ops/failures",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => count(s.failure_events)}
        label="failure events in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-active-clients",
    side: "ops",
    title: "Active clients",
    source: "/ops/environments",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => count(s.active_clients)}
        label="clients active in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-active-auditors",
    side: "ops",
    title: "Active auditors",
    source: "/ops/rhythm",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => count(s.active_auditors)}
        label="auditors active in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "job-share",
    side: "product",
    title: "Job-type share",
    source: "/product/usage",
    size: "half",
    render: () => <JobShareWidget />,
  },
  {
    id: "outcome-bars",
    side: "product",
    title: "Outcomes per job type",
    source: "/product/outcomes",
    size: "full",
    render: () => <OutcomeBarsWidget />,
  },
  {
    id: "stat-turns",
    side: "product",
    title: "Turns",
    source: "/product/usage",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => count(s.turns)}
        label="turns in window"
        caption="event-timestamp membership"
      />
    ),
  },
  {
    id: "stat-determined",
    side: "product",
    title: "Determined sessions",
    source: "/product/outcomes",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => `${count(s.determined)} of ${count(s.contained)}`}
        label="contained sessions determined"
        caption="whole-session containment"
      />
    ),
  },
  {
    id: "stat-chain-turns",
    side: "product",
    title: "Identical-input chains",
    source: "/product/agent",
    size: "stat",
    render: () => (
      <StatWidget
        pick={(s) => count(s.chain_turns)}
        label="turns with identical-input chains"
        caption="event-timestamp membership"
      />
    ),
  },
];

export const widgetsFor = (side: Side): WidgetDef[] => WIDGETS.filter((w) => w.side === side);
export const widgetById = (id: string): WidgetDef | undefined => WIDGETS.find((w) => w.id === id);
