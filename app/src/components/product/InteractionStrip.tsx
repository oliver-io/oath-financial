// Interaction cost strip plot (ui.md §3): dot per completed session,
// x = human-authored-turn count, row = job type; H chip under the marker-flag
// definition. Outlier dots clickable → session viewer.

import type { z } from "zod";
import type { InteractionCostDotSchema } from "../../data/queries.ts";
import { count } from "../../fmt.ts";
import { SvgDrillLink } from "../shared/SvgDrillLink.tsx";

type Dot = z.infer<typeof InteractionCostDotSchema>;

export function InteractionStrip({ dots }: { dots: Dot[] }) {
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
                <SvgDrillLink
                  key={d.session_id}
                  to={`/session/${d.session_id}`}
                  label={`open session ${d.session_id}`}
                >
                  <circle
                    cx={150 + (d.interaction_cost / max) * W}
                    cy={y}
                    r={4}
                    fill="var(--color-product)"
                    fillOpacity={0.55}
                    stroke="var(--color-surface)"
                    strokeWidth={1}
                  >
                    <title>{`${d.session_id}: ${count(d.interaction_cost)} human-authored turns — click to open`}</title>
                  </circle>
                </SvgDrillLink>
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
