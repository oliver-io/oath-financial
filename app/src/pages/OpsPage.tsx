// /ops/failures — Failures & incidents. Panels via the registry; the
// Agent-tool toggle is page-level chrome affecting both panels through the
// URL filter state.

import { useLocation, useNavigate } from "react-router";
import { useFilters } from "../data/DataContext.tsx";
import { filtersToSearch } from "../state/urlState.ts";
import { EventSemanticsCaption, PageTitle, PanelSection } from "./PageScaffold.tsx";

export function OpsPage() {
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div>
      <PageTitle
        side="ops"
        title="Failures & incidents"
        question="What is breaking, how badly, one-off or systemic?"
        stats={[{ id: "stat-failure-events", side: "ops" }]}
      />
      <div className="mb-4 flex items-center gap-3 text-xs text-ink-2">
        <label
          className="flex cursor-pointer items-center gap-1.5"
          title="Subagent outputs are near-uniform failure templates; naive matching sees ~6x the real failure count, so Agent-tool events are excluded from failure aggregates by default."
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
          include agent-tool failures
        </label>
      </div>
      <PanelSection id="failure-series" />
      <PanelSection id="signature-table" />
      <EventSemanticsCaption />
    </div>
  );
}
