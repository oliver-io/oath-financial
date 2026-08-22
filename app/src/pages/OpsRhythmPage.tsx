// /ops/rhythm — "How does work actually flow, per auditor and engagement?"
// (ui.md §3). All constructs turn-grain → event semantics; the gap cap is a ⚙
// stated parameter on every construct here.

import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ErrorState,
  ProvenanceChip,
  Skeleton,
  StatedParam,
} from "../components/shared/honesty.tsx";
import { useData, useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  AuditorDaySchema,
  QuickRestartSchema,
  qAuditorDaily,
  qAuditorTimeline,
  qQuickRestarts,
  qSessionSpans,
  SessionSpanSchema,
  TimelineRowQ,
} from "../data/queries.ts";
import { count, dayLabel, duration } from "../fmt.ts";
import { EventSemanticsCaption, PageTitle, Section } from "./PageScaffold.tsx";

function daysIn(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromDay}T00:00:00Z`);
  const end = Date.parse(`${toDay}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

function GapCapParam() {
  const { manifest } = useData();
  return (
    <StatedParam
      label="gap cap"
      value={duration(manifest.stated_params.gap_cap_s)}
      rationale="Inter-turn gaps above this cap are treated as absence: they end a bout and are excluded from engaged-time sums. Some sub-cap gaps contain agent background work, so 'engaged' still overclaims slightly."
    />
  );
}

export function OpsRhythmPage() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const { manifest } = useData();
  const daily = useRows(AuditorDaySchema, qAuditorDaily(win, filters), win);
  const timeline = useRows(TimelineRowQ, qAuditorTimeline(win), null);
  const spans = useRows(SessionSpanSchema, qSessionSpans(win, filters), null);
  const restarts = useRows(QuickRestartSchema, qQuickRestarts(win, filters), null);

  const days = useMemo(() => daysIn(win.fromDay, win.toDay), [win]);
  const auditors = useMemo(
    () => [...new Set((daily.rows ?? []).map((r) => r.auditor))].sort(),
    [daily.rows],
  );
  const byKey = useMemo(
    () => new Map((daily.rows ?? []).map((r) => [`${r.auditor}|${r.day}`, r])),
    [daily.rows],
  );
  const maxTurns = Math.max(1, ...(daily.rows ?? []).map((r) => r.turns));

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

  const CELL = 14;
  const maxSpan = Math.max(1, ...(spans.rows ?? []).map((s) => s.wall_span_s));
  const maxEngaged = Math.max(1, ...(spans.rows ?? []).map((s) => s.capped_gap_span_s));
  const logx = (v: number, max: number, W: number) => (Math.log10(1 + v) / Math.log10(1 + max)) * W;

  return (
    <div>
      <PageTitle
        side="ops"
        title="Working rhythm"
        question="How does work actually flow, per auditor and engagement?"
      />

      <Section title="Who was active when" chip={<GapCapParam />}>
        {daily.error && <ErrorState message={daily.error} />}
        {daily.loading && <Skeleton progress={daily.fetchProgress} />}
        {daily.rows && (
          <svg
            width={120 + days.length * (CELL + 1)}
            height={auditors.length * (CELL + 2) + 26}
            className="max-w-full"
          >
            <title>activity strips: turns per auditor per day</title>
            {auditors.map((a, i) => (
              <g key={a}>
                <text
                  x={114}
                  y={i * (CELL + 2) + CELL - 2}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--color-ink-2)"
                >
                  {a}
                </text>
                {days.map((d, j) => {
                  const r = byKey.get(`${a}|${d}`);
                  const turns = r?.turns ?? 0;
                  const hasDemo = (r?.demo_turns ?? 0) > 0 && filters.includeDemo;
                  const alpha = turns === 0 ? 0 : 0.2 + 0.8 * (turns / maxTurns);
                  return (
                    <g key={d}>
                      <rect
                        x={120 + j * (CELL + 1)}
                        y={i * (CELL + 2)}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        fill={turns === 0 ? "var(--color-grid)" : "var(--color-ops)"}
                        fillOpacity={turns === 0 ? 1 : alpha}
                      >
                        <title>{`${a} · ${dayLabel(d)}: ${count(turns)} turns${hasDemo ? ` (${r?.demo_turns} demo)` : ""}`}</title>
                      </rect>
                      {hasDemo && (
                        <rect
                          x={120 + j * (CELL + 1)}
                          y={i * (CELL + 2)}
                          width={CELL}
                          height={CELL}
                          rx={2}
                          fill="url(#hatch-demo)"
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {days.map(
              (d, j) =>
                j % 7 === 0 && (
                  <text
                    key={d}
                    x={120 + j * (CELL + 1)}
                    y={auditors.length * (CELL + 2) + 14}
                    fontSize={9}
                    fill="var(--color-ink-3)"
                  >
                    {dayLabel(d)}
                  </text>
                ),
            )}
          </svg>
        )}
        <EventSemanticsCaption />
      </Section>

      <Section
        title="Bout profile — one-sitting workers vs fragmented attention"
        chip={
          <>
            <ProvenanceChip
              kind="heuristic"
              method="bouts segmented at the stated gap cap on the auditor's merged timeline"
            />{" "}
            <GapCapParam />
          </>
        }
      >
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
      </Section>

      <Section
        title="Wall span vs engaged time — why wall spans are never summed"
        chip={
          <>
            <ProvenanceChip kind="heuristic" method="engaged = capped-gap span" /> <GapCapParam />
          </>
        }
      >
        {spans.rows && (
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
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          Dots far below the diagonal are long-lived sessions with little attention (the "27-day
          session was 3 hours of engagement" correction). Wall spans include days of absence and are
          never summed as effort. Sessions overlapping the window are shown.
        </p>
      </Section>

      <Section
        title="Quick restarts — workflow granularity"
        chip={
          <StatedParam
            label="quick-restart window"
            value={duration(manifest.stated_params.quick_restart_window_s)}
            rationale="A new session by the same auditor within this window of the previous one. Explicitly NOT a continuation claim — the next session is presumed a distinct task."
          />
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {(restarts.rows ?? []).map((r) => (
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
          {(restarts.rows ?? []).length === 0 && !restarts.loading && (
            <span className="text-sm text-ink-3">No quick restarts in this window.</span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-ink-3">
          Captioned as granularity, not continuation (derivations.md §3).
        </p>
      </Section>
    </div>
  );
}
