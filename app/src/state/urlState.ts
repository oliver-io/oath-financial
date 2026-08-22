// Filter bar + window ⇄ URL query params codec — the ONLY state store
// (app.md §3 state/urlState.ts). Serialization is canonical (fixed key order,
// defaults omitted) so URL → state → URL is byte-stable.

import type { JobType } from "@trace-insights/contracts";
import type { TimeWindow } from "../data/window.ts";

export interface FilterState {
  window: TimeWindow | null; // null = manifest full range (the default)
  client: string | null;
  entity: string | null;
  auditor: string | null;
  jobTypes: JobType[]; // empty = all
  includeDemo: boolean; // default off
  includeAgent: boolean; // /ops: include Agent-tool failures (default off)
  signature: string | null; // /ops selected signature
  incident: string | null; // /ops open incident panel
  gap: string | null; // /product selected capability gap
  groupBy: "none" | "client" | "auditor"; // /ops signature-table pivot
  session: string | null; // excluded-sessions list toggle etc.
}

export const DEFAULT_FILTERS: FilterState = {
  window: null,
  client: null,
  entity: null,
  auditor: null,
  jobTypes: [],
  includeDemo: false,
  includeAgent: false,
  signature: null,
  incident: null,
  gap: null,
  groupBy: "none",
  session: null,
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams): FilterState {
  const from = params.get("from");
  const to = params.get("to");
  const window =
    from && to && DAY_RE.test(from) && DAY_RE.test(to) && from <= to
      ? { fromDay: from, toDay: to }
      : null;
  const jobs = (params.get("job") ?? "")
    .split(",")
    .filter((j): j is JobType => j.length > 0) as JobType[];
  const group = params.get("group");
  return {
    window,
    client: params.get("client"),
    entity: params.get("entity"),
    auditor: params.get("auditor"),
    jobTypes: jobs,
    includeDemo: params.get("demo") === "1",
    includeAgent: params.get("agent") === "1",
    signature: params.get("signature"),
    incident: params.get("incident"),
    gap: params.get("gap"),
    groupBy: group === "client" || group === "auditor" ? group : "none",
    session: params.get("session"),
  };
}

/** Canonical key order; default values are omitted entirely. */
export function serializeFilters(f: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (f.window) {
    params.set("from", f.window.fromDay);
    params.set("to", f.window.toDay);
  }
  if (f.client) params.set("client", f.client);
  if (f.entity) params.set("entity", f.entity);
  if (f.auditor) params.set("auditor", f.auditor);
  if (f.jobTypes.length > 0) params.set("job", f.jobTypes.join(","));
  if (f.includeDemo) params.set("demo", "1");
  if (f.includeAgent) params.set("agent", "1");
  if (f.signature) params.set("signature", f.signature);
  if (f.incident) params.set("incident", f.incident);
  if (f.gap) params.set("gap", f.gap);
  if (f.groupBy !== "none") params.set("group", f.groupBy);
  if (f.session) params.set("session", f.session);
  return params;
}

export function filtersToSearch(f: FilterState): string {
  const s = serializeFilters(f).toString();
  return s ? `?${s}` : "";
}

/** Builds a link to a route carrying the given (partial) filter state. */
export function linkTo(path: string, patch: Partial<FilterState>, base?: FilterState): string {
  const f = { ...(base ?? DEFAULT_FILTERS), ...patch };
  return `${path}${filtersToSearch(f)}`;
}
