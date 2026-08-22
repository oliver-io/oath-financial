// "When and what kind?" — stacked bar of counting failure events per day,
// color = signature_class (≤7, fixed slots), with incident bands as shaded
// regions; band click opens the incident panel (ui.md §3 /ops).

import { SignatureClassSchema } from "@trace-insights/contracts";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { z } from "zod";
import type { FailureSeriesPointSchema, IncidentRowQ } from "../../data/queries.ts";
import type { TimeWindow } from "../../data/window.ts";
import { dayLabel } from "../../fmt.ts";
import { type FilterState, filtersToSearch } from "../../state/urlState.ts";
import { signatureClassColor } from "../shared/series.ts";

type Point = z.infer<typeof FailureSeriesPointSchema>;
type Incident = z.infer<typeof IncidentRowQ>;

function allDays(w: TimeWindow): string[] {
  const out: string[] = [];
  let t = Date.parse(`${w.fromDay}T00:00:00Z`);
  const end = Date.parse(`${w.toDay}T00:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

export function FailureTimeSeries({
  points,
  incidents,
  win,
  filters,
}: {
  points: Point[];
  incidents: Incident[];
  win: TimeWindow;
  filters: FilterState;
}) {
  const navigate = useNavigate();
  const classes = SignatureClassSchema.options.filter((c) =>
    points.some((p) => p.signature_class === c),
  );
  const data = useMemo(() => {
    const byDay = new Map<string, Record<string, number | string>>();
    for (const day of allDays(win)) byDay.set(day, { day });
    for (const p of points) {
      const row = byDay.get(p.day);
      if (row) row[p.signature_class] = p.n;
    }
    return [...byDay.values()];
  }, [points, win]);

  const visibleIncidents = incidents.filter(
    (i) => i.start_ts.slice(0, 10) <= win.toDay && i.end_ts.slice(0, 10) >= win.fromDay,
  );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
          barCategoryGap={2}
        >
          <CartesianGrid stroke="var(--color-grid)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={dayLabel}
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
          {visibleIncidents.map((i) => (
            <ReferenceArea
              key={i.incident_id}
              x1={i.start_ts.slice(0, 10)}
              x2={i.end_ts.slice(0, 10)}
              fill="var(--color-failure)"
              fillOpacity={0.07}
              stroke="var(--color-failure)"
              strokeOpacity={0.25}
              onClick={() =>
                // incident panels live on /ops; the compact dashboard render
                // click-through lands there too
                navigate({
                  pathname: "/ops/failures",
                  search: filtersToSearch({ ...filters, incident: i.incident_id }),
                })
              }
              className="cursor-pointer"
            />
          ))}
          {classes.map((c) => (
            <Bar
              key={c}
              dataKey={c}
              stackId="f"
              fill={signatureClassColor(c)}
              maxBarSize={18}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
