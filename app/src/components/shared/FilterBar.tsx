// Shared filter bar (ui.md §2), rendered on ops/product pages (the hub index
// has no filter bar): client/entity (select), auditor (select), job type
// (multi-select, M chip on the control itself), include-demo toggle
// (default off; demo rows render hatched when on).

import { type JobType, JobTypeSchema } from "@trace-insights/contracts";
import { useLocation, useNavigate } from "react-router";
import { useFilters, useRows } from "../../data/DataContext.tsx";
import { DimValueSchema, qDims } from "../../data/queries.ts";
import { type FilterState, filtersToSearch } from "../../state/urlState.ts";
import { ProvenanceChip } from "./honesty.tsx";

export function FilterBar() {
  const filters = useFilters();
  const navigate = useNavigate();
  const location = useLocation();
  const dims = useRows(DimValueSchema, qDims(), null);

  const patch = (p: Partial<FilterState>) => {
    navigate(
      { pathname: location.pathname, search: filtersToSearch({ ...filters, ...p }) },
      { replace: false },
    );
  };

  const clients = (dims.rows ?? []).filter((d) => d.kind === "client").map((d) => d.value);
  const entities = (dims.rows ?? [])
    .filter((d) => d.kind === "entity" && (!filters.client || d.parent === filters.client))
    .map((d) => d.value);
  const auditors = (dims.rows ?? []).filter((d) => d.kind === "auditor").map((d) => d.value);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <Select
        label="client"
        value={filters.client}
        options={clients}
        onChange={(v) => patch({ client: v, entity: null })}
      />
      <Select
        label="entity"
        value={filters.entity}
        options={entities}
        onChange={(v) => patch({ entity: v })}
      />
      <Select
        label="auditor"
        value={filters.auditor}
        options={auditors}
        onChange={(v) => patch({ auditor: v })}
      />
      <JobMulti value={filters.jobTypes} onChange={(jobTypes) => patch({ jobTypes })} />
      <label className="flex cursor-pointer items-center gap-1.5 text-ink-2">
        <input
          type="checkbox"
          checked={filters.includeDemo}
          onChange={(e) => patch({ includeDemo: e.target.checked })}
        />
        include demo traffic
      </label>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-ink-2">
      {label}
      <select
        className="rounded border border-hairline bg-surface px-1 py-0.5"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function JobMulti({ value, onChange }: { value: JobType[]; onChange: (v: JobType[]) => void }) {
  const all = JobTypeSchema.options;
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded border border-hairline bg-surface px-1.5 py-0.5 text-ink-2">
        job type{value.length > 0 ? ` (${value.length})` : ""}{" "}
        <ProvenanceChip kind="model" method="J3 session classification" />
      </summary>
      <div className="absolute z-20 mt-1 w-56 rounded border border-hairline bg-surface p-2 shadow-sm">
        {all.map((j) => (
          <label key={j} className="flex cursor-pointer items-center gap-1.5 py-0.5">
            <input
              type="checkbox"
              checked={value.includes(j)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, j] : value.filter((x) => x !== j))
              }
            />
            {j}
          </label>
        ))}
      </div>
    </details>
  );
}
