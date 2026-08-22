// Incident side panel (ui.md §3 /ops): blast-radius counts, member
// signatures, linked_friction_cost, and the crossover link "see the work this
// cost →" — /product/outcomes with the window set to the incident span
// (containment + caption then apply on the product side).

import { parseStringArray } from "@trace-insights/contracts";
import { Link, useLocation, useNavigate } from "react-router";
import type { z } from "zod";
import { useData, useFilters } from "../../data/DataContext.tsx";
import type { IncidentRowQ } from "../../data/queries.ts";
import { approx, count, tsLabel } from "../../fmt.ts";
import { DEFAULT_FILTERS, filtersToSearch } from "../../state/urlState.ts";
import { ProvenanceChip } from "../shared/honesty.tsx";

type Incident = z.infer<typeof IncidentRowQ>;

export function IncidentPanel({
  incident,
  signatureNames,
}: {
  incident: Incident;
  signatureNames: Map<string, string>;
}) {
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  const { degraded } = useData();
  const sigs = parseStringArray(incident.signature_ids);
  const close = () =>
    navigate({
      pathname: location.pathname,
      search: filtersToSearch({ ...filters, incident: null }),
    });
  const span = { fromDay: incident.start_ts.slice(0, 10), toDay: incident.end_ts.slice(0, 10) };
  return (
    <aside className="fixed right-0 top-0 z-40 h-full w-96 overflow-y-auto border-l border-hairline bg-surface p-4 shadow-lg">
      <div className="mb-2 flex items-start justify-between">
        <h2 className="text-sm font-semibold text-ink">
          Incident <span className="font-mono text-xs">{incident.incident_id}</span>
        </h2>
        <button type="button" className="cursor-pointer text-ink-3 hover:text-ink" onClick={close}>
          ✕
        </button>
      </div>
      <div className="mb-3 text-xs text-ink-2 tabular">
        {tsLabel(incident.start_ts)} → {tsLabel(incident.end_ts)}{" "}
        <ProvenanceChip kind="heuristic" method="rate excursion vs the signature's baseline" />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["sessions", incident.blast_sessions],
            ["auditors", incident.blast_auditors],
            ["clients", incident.blast_clients],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded border border-hairline p-2">
            <div className="text-lg font-semibold tabular text-ink">{count(v)}</div>
            <div className="text-[10px] text-ink-3">{label}</div>
          </div>
        ))}
      </div>
      <div className="mb-3">
        <div className="mb-1 text-[11px] font-medium text-ink-2">Member signatures</div>
        <div className="flex flex-wrap gap-1">
          {sigs.map((s) => (
            <Link
              key={s}
              to={{
                pathname: "/ops/failures",
                search: filtersToSearch({ ...filters, signature: s, incident: null }),
              }}
              className="rounded border border-hairline px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-ink-3"
            >
              {signatureNames.get(s) ?? s}
            </Link>
          ))}
        </div>
      </div>
      <div className="mb-4 text-xs text-ink-2">
        <span className="font-medium">Linked friction cost:</span>{" "}
        {incident.linked_friction_cost !== null ? (
          <>
            {approx(incident.linked_friction_cost)}{" "}
            <ProvenanceChip
              kind="model"
              method="sum of J2 turn friction attributed to this incident's signatures"
            />
          </>
        ) : (
          <span className="text-ink-3">
            {degraded.j2 ? "not computed — enrichment not run" : "—"}
          </span>
        )}
      </div>
      <Link
        to={{
          pathname: "/product/outcomes",
          search: filtersToSearch({ ...DEFAULT_FILTERS, window: span }),
        }}
        className="inline-block rounded border px-2 py-1 text-xs font-medium"
        style={{ borderColor: "var(--color-product)", color: "var(--color-product)" }}
      >
        see the work this cost →
      </Link>
      <p className="mt-2 text-[10px] text-ink-3">
        Opens the product side with the window set to the incident span; whole-session containment
        and its excluded-count caption apply there.
      </p>
    </aside>
  );
}
