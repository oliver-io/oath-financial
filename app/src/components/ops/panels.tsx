// Self-fetching ops panel components: each is one construct with its own
// queries, renderable as a page detail or a dashboard widget. Extracted from
// the ops pages so the panel registry can reference them directly.

import { SignatureClassSchema } from "@trace-insights/contracts";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useData, useFilters, useRows, useWindow } from "../../data/DataContext.tsx";
import {
  AuditorDaySchema,
  EnvCellSchema,
  FailureSeriesPointSchema,
  FailureSignatureRowQ,
  IncidentRowQ,
  IntegritySchema,
  QuickRestartSchema,
  qAuditorDaily,
  qAuditorTimeline,
  qEnvHeatmap,
  qFailureSeries,
  qFailureSignatures,
  qIncidents,
  qIntegrity,
  qQuickRestarts,
  qSessionSpans,
  qSignatureAgg,
  SessionSpanSchema,
  SignatureAggSchema,
  TimelineRowQ,
} from "../../data/queries.ts";
import { count, dayLabel, duration } from "../../fmt.ts";
import { filtersToSearch } from "../../state/urlState.ts";
import { ErrorState, Skeleton } from "../shared/honesty.tsx";
import { signatureClassColor } from "../shared/series.ts";
import { ActivityStrips } from "./ActivityStrips.tsx";
import { FailureTimeSeries } from "./FailureTimeSeries.tsx";
import { SignatureTable } from "./SignatureTable.tsx";

// ---- failures: time series --------------------------------------------------

export function FailureSeriesPanel() {
  const win = useWindow();
  const filters = useFilters();
  const series = useRows(FailureSeriesPointSchema, qFailureSeries(win, filters), win);
  const incidents = useRows(IncidentRowQ, qIncidents(), null);
  if (series.error) return <ErrorState message={series.error} />;
  if (series.loading || incidents.loading) return <Skeleton progress={series.fetchProgress} />;
  if (!series.rows || !incidents.rows) return null;
  return (
    <div>
      <FailureTimeSeries
        points={series.rows}
        incidents={incidents.rows}
        win={win}
        filters={filters}
      />
      <p className="mt-1 text-[10px] text-ink-3">
        Shaded bands are detected incidents (rate excursions); click a band for blast radius and the
        product-side crossover.
      </p>
    </div>
  );
}

// ---- failures: signature table (detail) + mini widget -----------------------

export function SignatureTablePanel() {
  const win = useWindow();
  const filters = useFilters();
  const aggs = useRows(SignatureAggSchema, qSignatureAgg(win, filters, filters.groupBy), win);
  const refs = useRows(FailureSignatureRowQ, qFailureSignatures(), null);
  const refByPattern = useMemo(
    () => new Map((refs.rows ?? []).map((r) => [r.pattern_id, r])),
    [refs.rows],
  );
  if (aggs.error) return <ErrorState message={aggs.error} />;
  if (aggs.loading || refs.loading) return <Skeleton lines={5} progress={aggs.fetchProgress} />;
  if (!aggs.rows || !refs.rows) return null;
  return <SignatureTable aggs={aggs.rows} refByPattern={refByPattern} groupBy={filters.groupBy} />;
}

/** Widget view: top signatures by sessions, name · class · events · sessions. */
export function SignatureTableWidget() {
  const win = useWindow();
  const filters = useFilters();
  const aggs = useRows(SignatureAggSchema, qSignatureAgg(win, filters, "none"), win);
  const refs = useRows(FailureSignatureRowQ, qFailureSignatures(), null);
  const nameOf = useMemo(
    () =>
      new Map(
        (refs.rows ?? []).map((r) => [
          r.pattern_id,
          { name: r.display_name, cls: r.signature_class },
        ]),
      ),
    [refs.rows],
  );
  if (aggs.loading || refs.loading) return <Skeleton lines={4} />;
  const rows = (aggs.rows ?? []).slice(0, 5);
  return (
    <table className="w-full border-collapse text-xs tabular">
      <tbody>
        {rows.map((a) => {
          const meta = nameOf.get(a.pattern_id);
          return (
            <tr key={a.pattern_id} className="border-b border-hairline last:border-b-0">
              <td className="py-1.5 pr-2">
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: signatureClassColor(meta?.cls ?? "") }}
                />
                {meta?.name ?? a.pattern_id}
              </td>
              <td className="py-1.5 pr-2 text-right">{count(a.events)} ev</td>
              <td className="py-1.5 text-right font-medium">{count(a.sessions)} sess</td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td className="py-2 text-ink-3">No signature matches in this window.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ---- environments: heatmap --------------------------------------------------

const SEQ = [
  "var(--color-seq-1)",
  "var(--color-seq-2)",
  "var(--color-seq-3)",
  "var(--color-seq-4)",
  "var(--color-seq-5)",
  "var(--color-seq-6)",
] as const;

export function EnvHeatmapPanel() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const { manifest } = useData();
  const smallN = manifest.stated_params.small_n_call_threshold;
  const cells = useRows(EnvCellSchema, qEnvHeatmap(win, filters), win);

  const { clients, rate, totals, maxRate } = useMemo(() => {
    const clientSet = [...new Set((cells.rows ?? []).map((c) => c.client))].sort();
    const totalsM = new Map<string, number>();
    const rateM = new Map<string, number>();
    let max = 0;
    for (const c of cells.rows ?? []) {
      totalsM.set(c.client, c.total_calls);
      if (c.signature_class) {
        const r = c.total_calls > 0 ? (c.failures / c.total_calls) * 100 : 0;
        rateM.set(`${c.client}|${c.signature_class}`, r);
        if (r > max) max = r;
      }
    }
    return { clients: clientSet, rate: rateM, totals: totalsM, maxRate: Math.max(max, 0.001) };
  }, [cells.rows]);

  const classes = SignatureClassSchema.options;
  const CELL = 46;
  if (cells.error) return <ErrorState message={cells.error} />;
  if (cells.loading) return <Skeleton progress={cells.fetchProgress} />;
  return (
    <div>
      {clients.length > 0 && (
        <svg
          width={230 + classes.length * (CELL + 2)}
          height={clients.length * (CELL + 2) + 90}
          className="max-w-full"
        >
          <title>client × signature-class error-rate heatmap</title>
          {classes.map((cls, j) => (
            <text
              key={cls}
              x={170 + j * (CELL + 2) + CELL / 2}
              y={clients.length * (CELL + 2) + 14}
              fontSize={9}
              fill="var(--color-ink-3)"
              transform={`rotate(35, ${170 + j * (CELL + 2) + CELL / 2}, ${clients.length * (CELL + 2) + 14})`}
            >
              {cls}
            </text>
          ))}
          {clients.map((client, i) => {
            const total = totals.get(client) ?? 0;
            const small = total < smallN;
            return (
              <g key={client}>
                <text
                  x={164}
                  y={i * (CELL + 2) + CELL / 2 + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--color-ink-2)"
                >
                  {client}{" "}
                  <tspan fill="var(--color-ink-3)" fontSize={9}>
                    ({count(total)} calls)
                  </tspan>
                </text>
                {classes.map((cls, j) => {
                  const r = rate.get(`${client}|${cls}`) ?? 0;
                  const step = r === 0 ? 0 : Math.min(5, 1 + Math.floor((r / maxRate) * 4.999));
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: SVG heatmap cell
                    <rect
                      key={cls}
                      x={170 + j * (CELL + 2)}
                      y={i * (CELL + 2)}
                      width={CELL}
                      height={CELL}
                      rx={3}
                      fill={small && r > 0 ? "url(#dot-small-n)" : SEQ[step]}
                      stroke={small && r > 0 ? "var(--color-ink-3)" : "none"}
                      strokeDasharray={small && r > 0 ? "2,2" : undefined}
                      className="cursor-pointer"
                      role="button"
                      onClick={() =>
                        navigate({
                          pathname: "/ops/failures",
                          search: filtersToSearch({ ...filters, client }),
                        })
                      }
                    >
                      <title>
                        {small
                          ? `${client} × ${cls}: ${r.toFixed(1)} per 100 calls — fewer than ${smallN} calls; treat with caution`
                          : `${client} × ${cls}: ${r.toFixed(1)} errors per 100 calls — click to open the failures page filtered`}
                      </title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      <p className="mt-1 text-[10px] text-ink-3">
        One-hue slate ramp, darker = higher rate. Dotted cells have under {smallN} calls in the
        window (small-n warning).
      </p>
    </div>
  );
}

// ---- environments: integrity strip ------------------------------------------

export function IntegrityStripPanel() {
  const filters = useFilters();
  const integrity = useRows(IntegritySchema, qIntegrity(filters), null);
  if (integrity.loading) return <Skeleton lines={2} />;
  const row = integrity.rows?.[0];
  if (!row) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {(
          [
            ["resumed fragments (leading turns lost)", row.resumed_fragments],
            ["sessions with internal missing turns", row.sessions_missing_turns],
            ["sessions total", row.sessions_total],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded border border-hairline p-3 text-center">
            <div className="text-lg font-semibold tabular text-ink">{count(v)}</div>
            <div className="max-w-40 text-[10px] text-ink-3">{label}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-ink-3">
        Ingest-side integrity (generation rows missing usage, referential gates, fork checks) is
        recorded in the pipeline run manifest, which is not part of the serving plane.
      </p>
    </div>
  );
}

// ---- rhythm: activity strips ------------------------------------------------

export function ActivityStripsPanel({ compact = false }: { compact?: boolean }) {
  const win = useWindow();
  const filters = useFilters();
  const daily = useRows(AuditorDaySchema, qAuditorDaily(win, filters), win);
  if (daily.error) return <ErrorState message={daily.error} />;
  if (daily.loading) return <Skeleton progress={daily.fetchProgress} />;
  return daily.rows ? <ActivityStrips rows={daily.rows} win={win} compact={compact} /> : null;
}

// ---- rhythm: bout profile ---------------------------------------------------

export function BoutProfilePanel() {
  const win = useWindow();
  const timeline = useRows(TimelineRowQ, qAuditorTimeline(win), null);
  const boutProfile = useMemo(() => {
    const per = new Map<string, { bouts: number[]; spans: number[] }>();
    for (const r of timeline.rows ?? []) {
      const p = per.get(r.auditor) ?? { bouts: [], spans: [] };
      p.bouts.push(r.bout_count);
      if (r.bout_count > 0) p.spans.push(r.capped_gap_span_s / r.bout_count);
      per.set(r.auditor, p);
    }
    const med = (xs: number[]) => {
      if (xs.length === 0) return 0;
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)] ?? 0;
    };
    return [...per.entries()].map(([auditor, p]) => ({
      auditor,
      boutsPerDay: p.bouts.reduce((a, b) => a + b, 0) / Math.max(p.bouts.length, 1),
      medianBoutSpan: med(p.spans),
    }));
  }, [timeline.rows]);
  if (timeline.loading) return <Skeleton />;
  return (
    <div className="flex flex-wrap gap-4">
      {boutProfile.map((b) => (
        <div key={b.auditor} className="rounded border border-hairline p-2 text-center">
          <div className="text-[11px] font-medium text-ink">{b.auditor}</div>
          <div className="mt-1 flex items-end justify-center gap-2">
            <div>
              <div
                className="mx-auto w-4 rounded-t bg-ops"
                style={{ height: Math.max(4, b.boutsPerDay * 14) }}
              />
              <div className="mt-0.5 text-[9px] text-ink-3">
                {b.boutsPerDay.toFixed(1)} bouts/day
              </div>
            </div>
            <div>
              <div
                className="mx-auto w-4 rounded-t bg-ops/50"
                style={{ height: Math.max(4, Math.min(56, b.medianBoutSpan / 120)) }}
              />
              <div className="mt-0.5 text-[9px] text-ink-3">
                {duration(b.medianBoutSpan, true)} median bout
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- rhythm: wall-span vs engaged scatter -----------------------------------

export function SpanScatterPanel() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const spans = useRows(SessionSpanSchema, qSessionSpans(win, filters), null);
  const maxSpan = Math.max(1, ...(spans.rows ?? []).map((s) => s.wall_span_s));
  const maxEngaged = Math.max(1, ...(spans.rows ?? []).map((s) => s.capped_gap_span_s));
  const logx = (v: number, max: number, W: number) => (Math.log10(1 + v) / Math.log10(1 + max)) * W;
  if (spans.loading) return <Skeleton />;
  return (
    <div>
      <svg width={560} height={240} className="max-w-full">
        <title>wall span vs engaged time, dot = session (log-log)</title>
        <line x1={60} y1={210} x2={540} y2={210} stroke="var(--color-hairline)" />
        <line x1={60} y1={10} x2={60} y2={210} stroke="var(--color-hairline)" />
        <text x={300} y={232} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">
          wall span (log) → max {duration(maxSpan)}
        </text>
        <text
          x={14}
          y={110}
          fontSize={10}
          fill="var(--color-ink-3)"
          transform="rotate(-90, 14, 110)"
        >
          engaged (log)
        </text>
        {(spans.rows ?? []).map((s) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: SVG dot acts as a drill-down link
          <circle
            key={s.session_id}
            cx={60 + logx(s.wall_span_s, maxSpan, 480)}
            cy={210 - logx(s.capped_gap_span_s, maxEngaged, 195)}
            r={4}
            fill="var(--color-ops)"
            fillOpacity={0.5}
            className="cursor-pointer"
            onClick={() => navigate(`/session/${s.session_id}`)}
          >
            <title>{`${s.session_id} (${s.auditor}): wall ${duration(s.wall_span_s)}, engaged ${duration(s.capped_gap_span_s, true)} — click to open`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-1 text-[10px] text-ink-3">
        Dots far below the diagonal are long-lived sessions with little attention. Wall spans
        include days of absence and are never summed as effort. Sessions overlapping the window are
        shown.
      </p>
    </div>
  );
}

// ---- rhythm: quick restarts -------------------------------------------------

export function QuickRestartsPanel({ limit }: { limit?: number }) {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const restarts = useRows(QuickRestartSchema, qQuickRestarts(win, filters), null);
  if (restarts.loading) return <Skeleton lines={2} />;
  const rows = limit ? (restarts.rows ?? []).slice(0, limit) : (restarts.rows ?? []);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.session_id}
            type="button"
            className="cursor-pointer rounded border border-hairline px-1.5 py-0.5 text-[10px] text-ink-2 hover:border-ink-3"
            onClick={() => navigate(`/session/${r.session_id}`)}
            title={`${r.auditor} started a new session ${duration(r.quick_restart_after_s)} after this one ended — click to open the first of the pair`}
          >
            {dayLabel(r.day)} · {r.auditor} · +{duration(r.quick_restart_after_s)}
          </button>
        ))}
        {rows.length === 0 && (
          <span className="text-sm text-ink-3">No quick restarts in this window.</span>
        )}
        {limit && (restarts.rows ?? []).length > limit && (
          <Link to="/ops/rhythm" className="text-[10px] text-ink-3 underline decoration-dotted">
            +{(restarts.rows ?? []).length - limit} more
          </Link>
        )}
      </div>
      <p className="mt-1 text-[10px] text-ink-3">
        Captioned as workflow granularity, not continuation (derivations.md §3).
      </p>
    </div>
  );
}
