// Activity strips (ui.md §3 /ops/rhythm) — one row per auditor, x = day,
// cell intensity = turns; demo cells hatched when shown. Shared between the
// Rhythm tab and the dashboard's compact daily-activity headline.

import { useMemo } from "react";
import type { z } from "zod";
import { useFilters } from "../../data/DataContext.tsx";
import type { AuditorDaySchema } from "../../data/queries.ts";
import type { TimeWindow } from "../../data/window.ts";
import { count, dayLabel } from "../../fmt.ts";

type Row = z.infer<typeof AuditorDaySchema>;

export function daysIn(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromDay}T00:00:00Z`);
  const end = Date.parse(`${toDay}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export function ActivityStrips({
  rows,
  win,
  compact = false,
}: {
  rows: Row[];
  win: TimeWindow;
  compact?: boolean;
}) {
  const filters = useFilters();
  const days = useMemo(() => daysIn(win.fromDay, win.toDay), [win]);
  const auditors = useMemo(() => [...new Set(rows.map((r) => r.auditor))].sort(), [rows]);
  const byKey = useMemo(() => new Map(rows.map((r) => [`${r.auditor}|${r.day}`, r])), [rows]);
  const maxTurns = Math.max(1, ...rows.map((r) => r.turns));
  const CELL = compact ? 10 : 14;
  return (
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
  );
}
