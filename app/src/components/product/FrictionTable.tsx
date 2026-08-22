// Friction table (ui.md §3): row = session, sorted by friction_share desc —
// friction bar · dominant_friction_cause chip (evidence popover) · job type ·
// outcome. Rows with cause = system_failure carry the crossover chip
// "↗ <signature> in Ops" → /ops with that signature selected.

import { useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import { useFilters, useRows } from "../../data/DataContext.tsx";
import type { FrictionRowSchema } from "../../data/queries.ts";
import { FailureSignatureRowQ, qFailureSignatures } from "../../data/queries.ts";
import { approxPct } from "../../fmt.ts";
import { ProvenanceChip } from "../shared/honesty.tsx";
import { RateBar } from "../shared/microviz.tsx";
import { DEFAULT_FILTERS, filtersToSearch } from "../../state/urlState.ts";

type Row = z.infer<typeof FrictionRowSchema>;

function CausePopover({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  if (!row.dominant_friction_cause) return <span className="text-ink-3">—</span>;
  return (
    <span className="relative">
      <button
        type="button"
        className="cursor-pointer rounded-sm border border-hairline px-1 py-0.5 text-[10px] text-ink-2"
        onClick={() => setOpen((v) => !v)}
      >
        {row.dominant_friction_cause} <ProvenanceChip kind="model" method="J2 turn classification rollup" />
      </button>
      {open && (
        <span className="absolute left-0 top-6 z-30 block w-64 rounded border border-hairline bg-surface p-2 text-[11px] text-ink-2 shadow-md">
          Dominant cause across this session's classified turns (J2 rollup).{" "}
          {row.outcome_evidence ?? ""} Open the session to audit the pointer turns.
        </span>
      )}
    </span>
  );
}

export function FrictionTable({ rows }: { rows: Row[] }) {
  const filters = useFilters();
  const sigNames = useRows(FailureSignatureRowQ, qFailureSignatures(), null);
  const nameOf = new Map((sigNames.rows ?? []).map((s) => [s.pattern_id, s.display_name]));
  if (rows.length === 0)
    return (
      <div className="text-sm text-ink-3">
        No friction-classified sessions in this window (friction is a model-class field — absent
        when enrichment has not run).
      </div>
    );
  return (
    <table className="w-full border-collapse text-xs tabular">
      <thead>
        <tr className="border-b border-hairline text-left text-[11px] text-ink-3">
          <th className="py-1.5 pr-2 font-medium">session</th>
          <th className="py-1.5 pr-2 font-medium">
            friction <ProvenanceChip kind="model" method="J2 turn-friction rollup" />
          </th>
          <th className="py-1.5 pr-2 font-medium">dominant cause</th>
          <th className="py-1.5 pr-2 font-medium">job type</th>
          <th className="py-1.5 pr-2 font-medium">outcome</th>
          <th className="py-1.5 font-medium">crossover</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.session_id} className="border-b border-hairline hover:bg-paper">
            <td className="py-1.5 pr-2">
              <Link to={`/session/${r.session_id}`} className="font-mono text-[11px] underline decoration-dotted">
                {r.session_id}
              </Link>
              <span className="ml-1 text-[10px] text-ink-3">{r.auditor}</span>
            </td>
            <td className="py-1.5 pr-2">
              {r.friction_share !== null && (
                <span title={approxPct(r.friction_share)}>
                  <RateBar value={r.friction_share} /> {approxPct(r.friction_share)}
                </span>
              )}
            </td>
            <td className="py-1.5 pr-2">
              <CausePopover row={r} />
            </td>
            <td className="py-1.5 pr-2">{r.job_type ?? "—"}</td>
            <td className="py-1.5 pr-2">{r.outcome ?? "—"}</td>
            <td className="py-1.5">
              {r.dominant_friction_cause === "system_failure" && r.dominant_linked_signature ? (
                <Link
                  to={{
                    pathname: "/ops",
                    search: filtersToSearch({
                      ...DEFAULT_FILTERS,
                      window: filters.window,
                      signature: r.dominant_linked_signature,
                    }),
                  }}
                  className="rounded border px-1 py-0.5 text-[10px]"
                  style={{ borderColor: "var(--color-ops)", color: "var(--color-ops)" }}
                  title={nameOf.get(r.dominant_linked_signature) ?? r.dominant_linked_signature}
                >
                  ↗ {r.dominant_linked_signature} in Ops
                </Link>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
