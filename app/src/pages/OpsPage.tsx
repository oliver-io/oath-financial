// /ops — Failures & incidents: "What is breaking, how badly, one-off or
// systemic?" (ui.md §3). Event semantics throughout; sessions appear only as
// drill-down links, never as counting units.

import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import { FailureTimeSeries } from "../components/ops/FailureTimeSeries.tsx";
import { IncidentPanel } from "../components/ops/IncidentPanel.tsx";
import { SignatureTable } from "../components/ops/SignatureTable.tsx";
import { ErrorState, ProvenanceChip, Skeleton } from "../components/shared/honesty.tsx";
import {
  FailureSeriesPointSchema,
  FailureSignatureRowQ,
  IncidentRowQ,
  qFailureSeries,
  qFailureSignatures,
  qIncidents,
  qSignatureAgg,
  SignatureAggSchema,
} from "../data/queries.ts";
import { filtersToSearch } from "../state/urlState.ts";
import { EventSemanticsCaption, PageTitle, Section } from "./PageScaffold.tsx";

export function OpsPage() {
  const win = useWindow();
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();

  const series = useRows(FailureSeriesPointSchema, qFailureSeries(win, filters), win);
  const incidents = useRows(IncidentRowQ, qIncidents(), null);
  const aggs = useRows(SignatureAggSchema, qSignatureAgg(win, filters, filters.groupBy), win);
  const refs = useRows(FailureSignatureRowQ, qFailureSignatures(), null);
  const refByPattern = useMemo(
    () => new Map((refs.rows ?? []).map((r) => [r.pattern_id, r])),
    [refs.rows],
  );
  const signatureNames = useMemo(
    () => new Map((refs.rows ?? []).map((r) => [r.pattern_id, r.display_name])),
    [refs.rows],
  );
  const openIncident = (incidents.rows ?? []).find((i) => i.incident_id === filters.incident);

  return (
    <div>
      <PageTitle
        side="ops"
        title="Failures & incidents"
        question="What is breaking, how badly, one-off or systemic?"
      />
      <div className="mb-4 flex items-center gap-3 text-xs text-ink-2">
        <label
          className="flex cursor-pointer items-center gap-1.5"
          title="Subagent outputs are near-uniform failure templates; naive matching sees ~6× the real failure count, so Agent-tool events are excluded from failure aggregates by default."
        >
          <input
            type="checkbox"
            checked={filters.includeAgent}
            onChange={(e) =>
              navigate({
                pathname: location.pathname,
                search: filtersToSearch({ ...filters, includeAgent: e.target.checked }),
              })
            }
          />
          include Agent-tool failures
        </label>
      </div>

      <Section
        title="When is it failing, and what kind?"
        chip={<ProvenanceChip kind="heuristic" method="anchored signature matches per day" />}
      >
        {series.error && <ErrorState message={series.error} />}
        {series.loading && <Skeleton progress={series.fetchProgress} />}
        {series.rows && incidents.rows && (
          <FailureTimeSeries
            points={series.rows}
            incidents={incidents.rows}
            win={win}
            filters={filters}
          />
        )}
        <p className="mt-1 text-[10px] text-ink-3">
          Shaded bands are detected incidents (rate excursions); click a band for blast radius
          and the product-side crossover.
        </p>
        <EventSemanticsCaption />
      </Section>

      <Section title="Failure signatures">
        {aggs.error && <ErrorState message={aggs.error} />}
        {(aggs.loading || refs.loading) && <Skeleton lines={5} progress={aggs.fetchProgress} />}
        {aggs.rows && refs.rows && (
          <SignatureTable aggs={aggs.rows} refByPattern={refByPattern} groupBy={filters.groupBy} />
        )}
      </Section>

      {openIncident && <IncidentPanel incident={openIncident} signatureNames={signatureNames} />}
    </div>
  );
}
