// Interaction cost strip plot (ui.md §3): dot per completed session,
// x = human-authored-turn count, row = job type; H chip under the marker-flag
// definition. Outlier dots clickable → session viewer.

import { useNavigate } from "react-router";
import type { z } from "zod";
import type { InteractionCostDotSchema } from "../../data/queries.ts";
import { count } from "../../fmt.ts";

type Dot = z.infer<typeof InteractionCostDotSchema>;

export function InteractionStrip({ dots }: { dots: Dot[] }) {
  const navigate = useNavigate();
  const jobs = [...new Set(dots.map((d) => d.job_type ?? "(not classified)"))];
  const max = Math.max(1, ...dots.map((d) => d.interaction_cost));
  const W = 460;
  const ROW_H = 26;
  if (dots.length === 0)
    return <div className="text-sm text-ink-3">No completed sessions in this window.</div>;
  return (
    <svg width={W + 220} height={jobs.length * ROW_H + 20} className="max-w-full">
      <title>interaction cost per completed session</title>
      {jobs.map((job, i) => {
        const y = i * ROW_H + 14;
        return (
          <g key={job}>
            <text x={144} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-2)">
              {job}
            </text>
            <line x1={150} y1={y} x2={150 + W} y2={y} stroke="var(--color-grid)" />
            {dots
              .filter((d) => (d.job_type ?? "(not classified)") === job)
              .map((d) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: SVG dot acts as a drill-down link
                <circle
                  key={d.session_id}
                  cx={150 + (d.interaction_cost / max) * W}
                  cy={y}
                  r={4}
                  fill="var(--color-product)"
                  fillOpacity={0.55}
                  stroke="var(--color-surface)"
                  strokeWidth={1}
                  className="cursor-pointer"
                  onClick={() => navigate(`/session/${d.session_id}`)}
                >
                  <title>{`${d.session_id}: ${count(d.interaction_cost)} human-authored turns — click to open`}</title>
                </circle>
              ))}
          </g>
        );
      })}
      <text
        x={150 + W}
        y={jobs.length * ROW_H + 14}
        textAnchor="end"
        fontSize={10}
        fill="var(--color-ink-3)"
      >
        max {count(max)} human-authored turns
      </text>
    </svg>
  );
}
