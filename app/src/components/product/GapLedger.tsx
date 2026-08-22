// Capability-gap ledger (ui.md §3): row = gap — name · sessions · auditors ·
// interaction-cost estimate · sessions/day sparkline · evidence-pattern
// popover. Sorted by cost; this table IS the ranked feature backlog; rows link
// to exemplar sessions. Names are model-produced (J4) — degraded runs show the
// evidence pattern id instead.

import { parseIntArray } from "@trace-insights/contracts";
import { useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import { useData } from "../../data/DataContext.tsx";
import type { CapabilityGapRowQ } from "../../data/queries.ts";
import { count } from "../../fmt.ts";
import { ProvenanceChip } from "../shared/honesty.tsx";
import { Sparkline } from "../shared/microviz.tsx";

type Gap = z.infer<typeof CapabilityGapRowQ>;

function EvidencePopover({ gap }: { gap: Gap }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        type="button"
        className="cursor-pointer text-[10px] text-ink-3 underline decoration-dotted"
        onClick={() => setOpen((v) => !v)}
      >
        evidence pattern
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-30 block w-72 rounded border border-hairline bg-surface p-2 text-[11px] text-ink-2 shadow-md">
          <span className="font-medium">{gap.evidence_pattern}</span>{" "}
          <ProvenanceChip kind="heuristic" method="structural shape computed in the derive stage; enrichment only names and groups" />
          {gap.description && <span className="mt-1 block">{gap.description}</span>}
        </span>
      )}
    </span>
  );
}

export function GapLedger({
  gaps,
  exemplars,
}: {
  gaps: Gap[];
  exemplars: Map<string, string[]>;
}) {
  const { degraded } = useData();
  return (
    <table className="w-full border-collapse text-xs tabular">
      <thead>
        <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
          <th className="py-1.5 pr-2 font-medium">capability gap</th>
          <th className="py-1.5 pr-2 text-right font-medium">sessions</th>
          <th className="py-1.5 pr-2 text-right font-medium">auditors</th>
          <th className="py-1.5 pr-2 text-right font-medium" title="turns spent inside the workaround — the backlog ranking key">
            interaction cost
          </th>
          <th className="py-1.5 pr-2 font-medium">sessions/day</th>
          <th className="py-1.5 font-medium">exemplars</th>
        </tr>
      </thead>
      <tbody>
        {gaps.map((g) => (
          <tr key={g.gap_id} className="border-b border-hairline hover:bg-paper">
            <td className="py-2 pr-2">
              {g.display_name ? (
                <span className="font-medium text-ink">
                  {g.display_name} <ProvenanceChip kind="model" method="J4 naming; counts are deterministic" />
                </span>
              ) : (
                <span className="font-mono text-[11px] text-ink-2" title={degraded.j4 ? "name unavailable — enrichment not run" : undefined}>
                  {g.gap_id}
                </span>
              )}
              <div>
                <EvidencePopover gap={g} />
              </div>
            </td>
            <td className="py-2 pr-2 text-right">{count(g.session_count)}</td>
            <td className="py-2 pr-2 text-right">{count(g.auditor_count)}</td>
            <td className="py-2 pr-2 text-right font-medium">{count(g.interaction_cost_estimate)}</td>
            <td className="py-2 pr-2">
              <Sparkline values={parseIntArray(g.daily_series)} />
            </td>
            <td className="py-2">
              <span className="flex flex-wrap gap-1">
                {(exemplars.get(g.gap_id) ?? []).slice(0, 3).map((sid) => (
                  <Link
                    key={sid}
                    to={`/session/${sid}`}
                    className="rounded border border-hairline px-1 py-0.5 font-mono text-[10px] text-ink-2 hover:border-ink-3"
                  >
                    {sid}
                  </Link>
                ))}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
