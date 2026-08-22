// /product/usage — "Who uses this, for what work, where is it concentrated?"
// (ui.md §3). Mixed grain: job-type share is session-grain (containment),
// turns/day timeline is event-grain — both rules captioned.

import { ToolFamilySchema } from "@trace-insights/contracts";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { JobShareBar } from "../components/product/JobShareBar.tsx";
import { ErrorState, ProvenanceChip, Skeleton } from "../components/shared/honesty.tsx";
import { Sparkline } from "../components/shared/microviz.tsx";
import { clientColor, toolFamilyColor } from "../components/shared/series.ts";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  AuditorClientCellSchema,
  ClientDaySchema,
  DimValueSchema,
  FamilyDaySchema,
  JobShareSchema,
  qAuditorClientGrid,
  qDims,
  qFamilyDaily,
  qJobShare,
  qTurnsByClientDay,
} from "../data/queries.ts";
import { count, dayLabel } from "../fmt.ts";
import { ContainmentCaption, EventSemanticsCaption, PageTitle, Section } from "./PageScaffold.tsx";

export function ProductUsagePage() {
  const win = useWindow();
  const filters = useFilters();
  const jobShare = useRows(JobShareSchema, qJobShare(win, filters), null);
  const clientDays = useRows(ClientDaySchema, qTurnsByClientDay(win, filters), win);
  const grid = useRows(AuditorClientCellSchema, qAuditorClientGrid(win, filters), win);
  const familyDaily = useRows(FamilyDaySchema, qFamilyDaily(win, filters), win);
  const dims = useRows(DimValueSchema, qDims(), null);
  const clientOrder = useMemo(
    () => (dims.rows ?? []).filter((d) => d.kind === "client").map((d) => d.value),
    [dims.rows],
  );

  const _totalSessions = (jobShare.rows ?? []).reduce((a, r) => a + r.n, 0);
  const _top3 = (jobShare.rows ?? []).slice(0, 3).reduce((a, r) => a + r.n, 0);
  const _maxShare = Math.max(1, ...(jobShare.rows ?? []).map((r) => r.n));

  const timelineData = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const r of clientDays.rows ?? []) {
      const row = byDay.get(r.day) ?? { day: r.day };
      row[r.client] = r.n;
      byDay.set(r.day, row);
    }
    return [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }, [clientDays.rows]);
  const activeClients = clientOrder.filter((c) =>
    (clientDays.rows ?? []).some((r) => r.client === c),
  );

  const auditors = [...new Set((grid.rows ?? []).map((g) => g.auditor))].sort();
  const gridClients = [...new Set((grid.rows ?? []).map((g) => g.client))].sort();
  const gridMap = new Map(
    (grid.rows ?? []).map((g) => [`${g.auditor}|${g.client}`, g.active_days]),
  );

  const familyRows = useMemo(() => {
    const per = new Map<
      string,
      { auditors: Set<number>; series: Map<string, number>; audCount: number }
    >();
    for (const fam of ToolFamilySchema.options)
      per.set(fam, { auditors: new Set(), series: new Map(), audCount: 0 });
    const audPerFam = new Map<string, number>();
    for (const r of familyDaily.rows ?? []) {
      const p = per.get(r.tool_family);
      if (!p) continue;
      p.series.set(r.day, (p.series.get(r.day) ?? 0) + r.n);
      audPerFam.set(r.tool_family, Math.max(audPerFam.get(r.tool_family) ?? 0, r.auditors));
    }
    return ToolFamilySchema.options
      .map((fam) => {
        const p = per.get(fam);
        const days = [...(p?.series.keys() ?? [])].sort();
        return {
          family: fam,
          auditors: audPerFam.get(fam) ?? 0,
          series: days.map((d) => p?.series.get(d) ?? 0),
          total: days.reduce((a, d) => a + (p?.series.get(d) ?? 0), 0),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [familyDaily.rows]);

  return (
    <div>
      <PageTitle
        side="product"
        title="Usage"
        question="Who uses this, for what work, where is it concentrated?"
      />

      <Section
        title="What work is this used for?"
        chip={<ProvenanceChip kind="model" method="J3 job-type classification (session grain)" />}
      >
        {jobShare.error && <ErrorState message={jobShare.error} />}
        {jobShare.loading && <Skeleton />}
        {jobShare.rows && <JobShareBar rows={jobShare.rows} />}
        <ContainmentCaption />
      </Section>

      <Section title="Lines of business over time — turns per day by client">
        {clientDays.loading && <Skeleton progress={clientDays.fetchProgress} />}
        {clientDays.rows && (
          <div className="h-52 w-full">
            <ResponsiveContainer>
              <BarChart
                data={timelineData}
                margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
                barCategoryGap={2}
              >
                <CartesianGrid stroke="var(--color-grid)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d) => dayLabel(String(d))}
                  tick={{ fontSize: 10, fill: "var(--color-ink-3)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-ink-3)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-grid)" }}
                  labelFormatter={(d) => dayLabel(String(d))}
                  contentStyle={{ fontSize: 11, border: "1px solid var(--color-hairline)" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activeClients.map((c) => (
                  <Bar
                    key={c}
                    dataKey={c}
                    stackId="c"
                    fill={clientColor(c, clientOrder)}
                    maxBarSize={18}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          Bars, not area: with one client at ~70% and another present only two days, area
          interpolation would fabricate ramps and hide slivers.
        </p>
        <EventSemanticsCaption />
      </Section>

      <Section title="Auditor × client load — deliberately unranked">
        {grid.rows && (
          <svg
            width={140 + gridClients.length * 60}
            height={auditors.length * 26 + 30}
            className="max-w-full"
          >
            <title>auditor × client dot grid, dot size = active days</title>
            {gridClients.map((c, j) => (
              <text
                key={c}
                x={140 + j * 60 + 20}
                y={12}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-ink-3)"
              >
                {c}
              </text>
            ))}
            {auditors.map((a, i) => (
              <g key={a}>
                <text
                  x={134}
                  y={26 + i * 26 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--color-ink-2)"
                >
                  {a}
                </text>
                {gridClients.map((c, j) => {
                  const days = gridMap.get(`${a}|${c}`) ?? 0;
                  if (days === 0) return null;
                  return (
                    <circle
                      key={c}
                      cx={140 + j * 60 + 20}
                      cy={26 + i * 26}
                      r={3 + Math.min(9, days)}
                      fill="var(--color-product)"
                      fillOpacity={0.45}
                    >
                      <title>{`${a} × ${c}: active ${count(days)} day(s)`}</title>
                    </circle>
                  );
                })}
              </g>
            ))}
          </svg>
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          Dot size = active days, not turns; no totals column. Auditors barely overlap across
          clients, so cross-auditor comparisons are confounded by engagement — this grid shows load,
          never skill.
        </p>
        <EventSemanticsCaption />
      </Section>

      <Section title="Capability adoption — who uses which tool surface, and is it growing?">
        {familyDaily.loading && <Skeleton progress={familyDaily.fetchProgress} />}
        <table className="w-full max-w-xl border-collapse text-xs tabular">
          <tbody>
            {familyRows.map((r) => (
              <tr key={r.family} className="border-b border-hairline">
                <td className="py-1.5 pr-2">
                  <span
                    className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ background: toolFamilyColor(r.family) }}
                  />
                  {r.family}
                </td>
                <td className="py-1.5 pr-2 text-right">
                  {count(r.auditors)} auditor{r.auditors === 1 ? "" : "s"}
                </td>
                <td className="py-1.5 pr-2 text-right text-ink-3">{count(r.total)} calls</td>
                <td className="py-1.5">
                  <Sparkline values={r.series} width={140} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-ink-3">
          Single-adopter rows are capability outliers (e.g. browser automation); a flat or dying
          sparkline distinguishes an abandoned surface from a growing workaround.
        </p>
        <EventSemanticsCaption />
      </Section>
    </div>
  );
}
