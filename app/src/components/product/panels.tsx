// Self-fetching product panel components: each is one construct with its own
// queries, renderable as a page detail or a dashboard widget. Extracted from
// the product pages so the panel registry can reference them directly.

import { ToolFamilySchema } from "@trace-insights/contracts";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
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
import { useData, useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import {
  AuditorClientCellSchema,
  CapabilityGapRowQ,
  ClientDaySchema,
  CorrectionRowSchema,
  DimValueSchema,
  FamilyDaySchema,
  FamilyShapeSchema,
  FrictionRowSchema,
  GapExemplarSchema,
  GrindRowSchema,
  InteractionCostDotSchema,
  JobShareSchema,
  OutcomeCountSchema,
  qAuditorClientGrid,
  qCapabilityGaps,
  qCorrections,
  qDims,
  qFamilyDaily,
  qFrictionTable,
  qGapExemplars,
  qGrindTurns,
  qInteractionCostDots,
  qJobShare,
  qOutcomesByJob,
  qPostFailureByFamily,
  qRepeatChains,
  qTurnsByClientDay,
  RepeatChainRowSchema,
} from "../../data/queries.ts";
import { count, dayLabel } from "../../fmt.ts";
import { ErrorState, Skeleton, StatedParam } from "../shared/honesty.tsx";
import { MicroBar3, Sparkline } from "../shared/microviz.tsx";
import { clientColor, toolFamilyColor } from "../shared/series.ts";
import { FrictionTable } from "./FrictionTable.tsx";
import { GapLedger } from "./GapLedger.tsx";
import { InteractionStrip } from "./InteractionStrip.tsx";
import { JobShareBar } from "./JobShareBar.tsx";
import { OutcomeBars } from "./OutcomeBars.tsx";

// ---- usage: job share -------------------------------------------------------

export function JobSharePanel({ compact = false }: { compact?: boolean }) {
  const win = useWindow();
  const filters = useFilters();
  const jobShare = useRows(JobShareSchema, qJobShare(win, filters), null);
  if (jobShare.error) return <ErrorState message={jobShare.error} />;
  if (jobShare.loading) return <Skeleton />;
  return jobShare.rows ? <JobShareBar rows={jobShare.rows} compact={compact} /> : null;
}

// ---- usage: lines-of-business timeline --------------------------------------

export function LobTimelinePanel() {
  const win = useWindow();
  const filters = useFilters();
  const clientDays = useRows(ClientDaySchema, qTurnsByClientDay(win, filters), win);
  const dims = useRows(DimValueSchema, qDims(), null);
  const clientOrder = useMemo(
    () => (dims.rows ?? []).filter((d) => d.kind === "client").map((d) => d.value),
    [dims.rows],
  );
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
  if (clientDays.loading) return <Skeleton progress={clientDays.fetchProgress} />;
  return (
    <div>
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
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-ink-3">
        Shown as daily bars: activity is uneven across clients, and a continuous area would suggest
        activity on days where there was none.
      </p>
    </div>
  );
}

// ---- usage: auditor × client grid -------------------------------------------

export function AuditorClientGridPanel() {
  const win = useWindow();
  const filters = useFilters();
  const grid = useRows(AuditorClientCellSchema, qAuditorClientGrid(win, filters), win);
  const auditors = [...new Set((grid.rows ?? []).map((g) => g.auditor))].sort();
  const gridClients = [...new Set((grid.rows ?? []).map((g) => g.client))].sort();
  const gridMap = new Map(
    (grid.rows ?? []).map((g) => [`${g.auditor}|${g.client}`, g.active_days]),
  );
  if (grid.loading) return <Skeleton progress={grid.fetchProgress} />;
  return (
    <div>
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
      <p className="mt-1 text-[10px] text-ink-3">
        Dot size = active days, not turns; no totals column. Auditors barely overlap across clients,
        so cross-auditor comparisons are confounded by engagement — this grid shows load, never
        skill.
      </p>
    </div>
  );
}

// ---- usage: capability adoption ---------------------------------------------

export function FamilyAdoptionPanel() {
  const win = useWindow();
  const filters = useFilters();
  const familyDaily = useRows(FamilyDaySchema, qFamilyDaily(win, filters), win);
  const familyRows = useMemo(() => {
    const per = new Map<string, Map<string, number>>();
    const audPerFam = new Map<string, number>();
    for (const fam of ToolFamilySchema.options) per.set(fam, new Map());
    for (const r of familyDaily.rows ?? []) {
      const p = per.get(r.tool_family);
      if (!p) continue;
      p.set(r.day, (p.get(r.day) ?? 0) + r.n);
      audPerFam.set(r.tool_family, Math.max(audPerFam.get(r.tool_family) ?? 0, r.auditors));
    }
    return ToolFamilySchema.options
      .map((fam) => {
        const p = per.get(fam);
        const days = [...(p?.keys() ?? [])].sort();
        return {
          family: fam,
          auditors: audPerFam.get(fam) ?? 0,
          series: days.map((d) => p?.get(d) ?? 0),
          total: days.reduce((a, d) => a + (p?.get(d) ?? 0), 0),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [familyDaily.rows]);
  if (familyDaily.loading) return <Skeleton progress={familyDaily.fetchProgress} />;
  return (
    <div>
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
        Single-adopter rows are capability outliers; a flat or dying sparkline distinguishes an
        abandoned surface from a growing workaround.
      </p>
    </div>
  );
}

// ---- outcomes: outcome bars, interaction strip, friction, gap ledger --------

export function OutcomeBarsPanel() {
  const win = useWindow();
  const filters = useFilters();
  const outcomes = useRows(OutcomeCountSchema, qOutcomesByJob(win, filters), null);
  if (outcomes.error) return <ErrorState message={outcomes.error} />;
  if (outcomes.loading) return <Skeleton />;
  return outcomes.rows ? <OutcomeBars rows={outcomes.rows} /> : null;
}

export function InteractionStripPanel() {
  const win = useWindow();
  const filters = useFilters();
  const dots = useRows(InteractionCostDotSchema, qInteractionCostDots(win, filters), null);
  if (dots.loading) return <Skeleton />;
  return dots.rows ? <InteractionStrip dots={dots.rows} /> : null;
}

export function FrictionTablePanel({ limit }: { limit?: number }) {
  const win = useWindow();
  const filters = useFilters();
  const location = useLocation();
  const friction = useRows(FrictionRowSchema, qFrictionTable(win, filters), null);
  if (friction.error) return <ErrorState message={friction.error} />;
  if (friction.loading) return <Skeleton />;
  if (!friction.rows) return null;
  const rows = limit ? friction.rows.slice(0, limit) : friction.rows;
  return (
    <div>
      <FrictionTable rows={rows} />
      {limit && friction.rows.length > limit && (
        <Link
          to={{
            pathname: "/product/outcomes",
            search: location.search,
            hash: "#panel-friction-table",
          }}
          className="mt-1 inline-block text-[10px] text-ink-3 underline decoration-dotted"
        >
          +{friction.rows.length - limit} more sessions
        </Link>
      )}
    </div>
  );
}

export function GapLedgerPanel() {
  const win = useWindow();
  void win; // gap aggregates are reference-plane (full dataset); window does not re-slice
  const gaps = useRows(CapabilityGapRowQ, qCapabilityGaps(), null);
  const exemplarRows = useRows(GapExemplarSchema, qGapExemplars(), null);
  const exemplars = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of exemplarRows.rows ?? [])
      m.set(e.gap_id, [...(m.get(e.gap_id) ?? []), e.session_id]);
    return m;
  }, [exemplarRows.rows]);
  if (gaps.loading) return <Skeleton />;
  if (!gaps.rows) return null;
  return (
    <div>
      <GapLedger gaps={gaps.rows} exemplars={exemplars} />
      <p className="mt-1 text-[10px] text-ink-3">
        Gap aggregates are computed over the full dataset (reference plane); the window does not
        re-slice them.
      </p>
    </div>
  );
}

// ---- agent: repeat chains ---------------------------------------------------

function SessionLink({ sessionId, turn }: { sessionId: string; turn: number }) {
  return (
    <Link
      to={`/session/${sessionId}`}
      className="font-mono text-[11px] underline decoration-dotted"
    >
      {sessionId}
      <span className="text-ink-3">#{turn}</span>
    </Link>
  );
}

export function RepeatChainsPanel({ limit }: { limit?: number }) {
  const win = useWindow();
  const filters = useFilters();
  const chains = useRows(RepeatChainRowSchema, qRepeatChains(win, filters), win);
  if (chains.error) return <ErrorState message={chains.error} />;
  if (chains.loading) return <Skeleton progress={chains.fetchProgress} />;
  const rows = limit ? (chains.rows ?? []).slice(0, limit) : (chains.rows ?? []);
  if (rows.length === 0)
    return <p className="text-sm text-ink-3">No identical-input chains in this window.</p>;
  return (
    <div>
      <table className="w-full max-w-2xl border-collapse text-xs tabular">
        <thead>
          <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
            <th className="py-1.5 pr-2 font-medium">turn</th>
            <th className="py-1.5 pr-2 font-medium">tool(s)</th>
            <th className="py-1.5 pr-2 text-right font-medium">chain length</th>
            <th className="py-1.5 font-medium">followed a signature match?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.session_id}|${r.turn_number}`}
              className="border-b border-hairline hover:bg-paper"
            >
              <td className="py-1.5 pr-2">
                <SessionLink sessionId={r.session_id} turn={r.turn_number} />
              </td>
              <td className="py-1.5 pr-2 font-mono text-[10px]">{r.tools}</td>
              <td className="py-1.5 pr-2 text-right font-medium">{count(r.chain_count)}</td>
              <td className="py-1.5">{r.after_signature_match ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-ink-3">
        Counts byte-identical re-invocations only. Whether a chain is a retry or a legitimate
        polling loop is not determined here.
      </p>
    </div>
  );
}

// ---- agent: long same-tool runs ---------------------------------------------

export function GrindTablePanel({ limit }: { limit?: number }) {
  const win = useWindow();
  const filters = useFilters();
  const location = useLocation();
  const { manifest } = useData();
  const threshold = manifest.stated_params.grind_run_threshold;
  const grinds = useRows(GrindRowSchema, qGrindTurns(win, filters, threshold), win);
  if (grinds.loading) return <Skeleton progress={grinds.fetchProgress} />;
  const rows = limit ? (grinds.rows ?? []).slice(0, limit) : (grinds.rows ?? []);
  if (rows.length === 0)
    return <p className="text-sm text-ink-3">No runs at or above the threshold in this window.</p>;
  return (
    <table className="w-full max-w-xl border-collapse text-xs tabular">
      <thead>
        <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
          <th className="py-1.5 pr-2 font-medium">turn</th>
          <th className="py-1.5 pr-2 font-medium">dominant family (by call count)</th>
          <th className="py-1.5 text-right font-medium">longest run</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={`${r.session_id}|${r.turn_number}`}
            className="border-b border-hairline hover:bg-paper"
          >
            <td className="py-1.5 pr-2">
              <SessionLink sessionId={r.session_id} turn={r.turn_number} />
            </td>
            <td className="py-1.5 pr-2">
              {r.dominant_family && (
                <>
                  <span
                    className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ background: toolFamilyColor(r.dominant_family) }}
                  />
                  {r.dominant_family}
                  {r.dominant_family === "browser" && (
                    <Link
                      to={{
                        pathname: "/product/outcomes",
                        search: location.search,
                        hash: "#panel-gap-ledger",
                      }}
                      className="ml-2 text-[10px] underline decoration-dotted"
                      title="browser-family runs concentrate in the browser-grind capability gap — see the gap ledger"
                    >
                      ↘ capability gap
                    </Link>
                  )}
                </>
              )}
            </td>
            <td className="py-1.5 text-right font-medium">×{count(r.max_same_tool_run)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The grind threshold ⚙, shared by the panel's page and widget chrome. */
export function GrindThresholdParam() {
  const { manifest } = useData();
  return (
    <StatedParam
      label="run threshold"
      value={String(manifest.stated_params.grind_run_threshold)}
      rationale="Turns whose longest single-tool run meets this length. A neutral count — a 75-call Bash run may be a legitimate batch loop; the 'grind' reading is interpretation."
    />
  );
}

// ---- agent: correction feed -------------------------------------------------

function CorrectionItem({
  row,
}: {
  row: {
    session_id: string;
    turn_number: number;
    day: string;
    user_text_head: string;
    prev_assistant_tail: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
        <SessionLink sessionId={row.session_id} turn={row.turn_number} />
        <span>{dayLabel(row.day)}</span>
        <button
          type="button"
          className="cursor-pointer underline decoration-dotted"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "hide" : "show"} previous assistant tail
        </button>
      </div>
      <p className="text-xs text-ink">{row.user_text_head}…</p>
      {open && (
        <pre className="mt-1 whitespace-pre-wrap rounded bg-paper p-2 font-mono text-[10px] text-ink-2">
          {row.prev_assistant_tail ?? "(no previous turn in window)"}
        </pre>
      )}
    </div>
  );
}

export function CorrectionFeedPanel({ limit }: { limit?: number }) {
  const win = useWindow();
  const filters = useFilters();
  const { degraded } = useData();
  const corrections = useRows(CorrectionRowSchema, qCorrections(win, filters), win);
  if (corrections.loading) return <Skeleton progress={corrections.fetchProgress} />;
  const rows = limit ? (corrections.rows ?? []).slice(0, limit) : (corrections.rows ?? []);
  return (
    <div className="max-w-2xl">
      {degraded.j2 && (
        <p className="mb-2 text-xs text-ink-3">
          Enrichment did not run — corrections are unclassified this run (the deterministic
          candidate flag alone mixes real re-steers with plain new asks).
        </p>
      )}
      {rows.map((r) => (
        <CorrectionItem key={`${r.session_id}|${r.turn_number}`} row={r} />
      ))}
      {rows.length === 0 && !degraded.j2 && (
        <p className="text-sm text-ink-3">No classified corrections in this window.</p>
      )}
      <p className="mt-1 text-[10px] text-ink-3">A curated review queue, not a metric.</p>
    </div>
  );
}

// ---- agent: post-failure shape by family ------------------------------------

export function FamilyShapesPanel() {
  const win = useWindow();
  const filters = useFilters();
  const shapes = useRows(FamilyShapeSchema, qPostFailureByFamily(win, filters), win);
  if (shapes.loading) return <Skeleton progress={shapes.fetchProgress} />;
  return (
    <div className="max-w-md">
      {(shapes.rows ?? []).map((r) => (
        <div key={r.tool_family} className="mb-1 flex items-center gap-2 text-xs">
          <span className="w-24 text-right text-ink-2">{r.tool_family}</span>
          <MicroBar3 a={r.shape_a} b={r.shape_b} c={r.shape_c} width={200} />
          <span className="tabular text-[10px] text-ink-3">
            {count(r.shape_a + r.shape_b + r.shape_c)}
          </span>
        </div>
      ))}
      <p className="mt-1 text-[10px] text-ink-3">
        Segments: the same tool later succeeds in the turn / other calls follow / the turn ends on
        the failure. These are positional facts; whether a follow-up was a recovery is not asserted.
      </p>
    </div>
  );
}
