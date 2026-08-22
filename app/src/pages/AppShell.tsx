// App shell: nav rail with the two side identities, first-class time-window
// control, shared filter bar (all pages except `/`), provenance legend, boot
// gate. State lives in the URL only.

import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { FilterBar } from "../components/shared/FilterBar.tsx";
import { ErrorState, HatchDefs, Skeleton } from "../components/shared/honesty.tsx";
import { TimeWindowControl } from "../components/shared/TimeWindowControl.tsx";
import {
  DataProvider,
  type RuntimeFactory,
  useDataState,
  useFilters,
} from "../data/DataContext.tsx";

const NAV = [
  { to: "/", label: "Findings", side: null },
  { to: "/ops", label: "Failures & incidents", side: "ops" as const },
  { to: "/ops/environments", label: "Environments", side: "ops" as const },
  { to: "/ops/rhythm", label: "Working rhythm", side: "ops" as const },
  { to: "/product/usage", label: "Usage", side: "product" as const },
  { to: "/product/outcomes", label: "Outcomes", side: "product" as const },
  { to: "/product/agent", label: "Agent behavior", side: "product" as const },
];

function sideColor(side: "ops" | "product" | null): string {
  if (side === "ops") return "var(--color-ops)";
  if (side === "product") return "var(--color-product)";
  return "var(--color-ink)";
}

function NavRail() {
  const filters = useFilters();
  const location = useLocation();
  const search = location.search;
  return (
    <nav className="w-52 shrink-0 border-r border-hairline bg-surface px-3 py-4 flex flex-col gap-4">
      <Link to="/" className="px-2 text-sm font-semibold tracking-tight text-ink">
        Trace Insights
      </Link>
      <div className="flex flex-col gap-3">
        <div>
          <NavItem item={NAV[0]} search={search} />
        </div>
        <div>
          <div
            className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-ops)" }}
          >
            Ops
          </div>
          {NAV.filter((n) => n.side === "ops").map((n) => (
            <NavItem key={n.to} item={n} search={search} />
          ))}
        </div>
        <div>
          <div
            className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-product)" }}
          >
            Product
          </div>
          {NAV.filter((n) => n.side === "product").map((n) => (
            <NavItem key={n.to} item={n} search={search} />
          ))}
        </div>
      </div>
      <div className="mt-auto px-2 text-[10px] leading-relaxed text-ink-3">
        <span className="font-medium">Provenance:</span> unchipped values are structural; H
        heuristic · C curated · M model.{" "}
        {filters.includeDemo ? "Demo traffic shown (hatched)." : ""}
      </div>
    </nav>
  );
}

function NavItem({ item, search }: { item: (typeof NAV)[number] | undefined; search: string }) {
  if (!item) return null;
  return (
    <NavLink
      to={{ pathname: item.to, search }}
      end={item.to === "/" || item.to === "/ops"}
      className="block rounded px-2 py-1 text-sm text-ink-2 hover:bg-paper"
      style={({ isActive }) =>
        isActive
          ? {
              color: sideColor(item.side),
              background:
                item.side === "product" ? "var(--color-product-soft)" : "var(--color-ops-soft)",
              fontWeight: 500,
            }
          : undefined
      }
    >
      {item.label}
    </NavLink>
  );
}

function ShellBody() {
  const { api, error, bootPhase } = useDataState();
  const location = useLocation();
  const navigate = useNavigate();
  if (error)
    return (
      <div className="mx-auto max-w-xl py-16">
        <ErrorState message={error} onRetry={() => navigate(0)} />
      </div>
    );
  if (!api)
    return (
      <div className="mx-auto max-w-xl py-16">
        <Skeleton lines={4} />
        <div className="text-xs text-ink-3">connecting to the data plane… ({bootPhase})</div>
      </div>
    );
  const onFindings = location.pathname === "/";
  const onSession = location.pathname.startsWith("/session/");
  return (
    <div className="flex min-h-screen">
      <NavRail />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-hairline bg-surface/95 px-6 py-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <TimeWindowControl />
            {!onFindings && !onSession && <FilterBar demoOnly={false} />}
            {onFindings && <FilterBar demoOnly />}
          </div>
        </header>
        <main className="px-6 py-5">
          <Outlet />
        </main>
        <footer className="border-t border-hairline px-6 py-3 text-[11px] text-ink-3">
          run <span className="font-mono">{api.manifest.run_id}</span> · rules{" "}
          {Object.entries(api.manifest.rule_versions)
            .map(([k, v]) => `${k}:${v}`)
            .join(" · ")}
          {api.degraded.any && (
            <span className="ml-3">
              enrichment partial — model-class fields may be absent (see per-view captions)
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

export function AppShell({ runtimeFactory }: { runtimeFactory?: RuntimeFactory }) {
  return (
    <DataProvider {...(runtimeFactory ? { runtimeFactory } : {})}>
      <HatchDefs />
      <ShellBody />
    </DataProvider>
  );
}
