// App shell (user directive, final): the old top bar (brand · window control ·
// filters) on top, then ONE horizontal navbar showing the top-level domains —
// clicking a domain opens its dashboard, and the active domain's sub-category
// pages appear indented inline after it. `/` is a data-free index.

import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { FilterBar } from "../components/shared/FilterBar.tsx";
import { ErrorState, HatchDefs, Skeleton } from "../components/shared/honesty.tsx";
import { TimeWindowControl } from "../components/shared/TimeWindowControl.tsx";
import { DataProvider, type RuntimeFactory, useDataState } from "../data/DataContext.tsx";

type Side = "ops" | "product";

const SUB_PAGES: Record<Side, { to: string; label: string }[]> = {
  ops: [
    { to: "/ops/failures", label: "Failures & incidents" },
    { to: "/ops/environments", label: "Environments" },
    { to: "/ops/rhythm", label: "Working rhythm" },
  ],
  product: [
    { to: "/product/usage", label: "Usage" },
    { to: "/product/outcomes", label: "Outcomes" },
    { to: "/product/agent", label: "Agent behavior" },
  ],
};

const sideColor = (side: Side): string =>
  side === "ops" ? "var(--color-ops)" : "var(--color-product)";
const sideSoft = (side: Side): string =>
  side === "ops" ? "var(--color-ops-soft)" : "var(--color-product-soft)";

function roomOf(pathname: string): Side | null {
  if (pathname.startsWith("/ops")) return "ops";
  if (pathname.startsWith("/product")) return "product";
  return null;
}

/** Row 1 — the original control bar: brand, window control, filter bar. */
function TopBar({ showFilters }: { showFilters: boolean }) {
  const location = useLocation();
  return (
    <div className="border-b border-hairline bg-surface/95 px-6 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link
          to={{ pathname: "/", search: location.search }}
          className="text-sm font-semibold tracking-tight text-ink"
        >
          Trace Insights
        </Link>
        <TimeWindowControl />
        {showFilters && <FilterBar />}
        <span
          className="ml-auto hidden text-[10px] text-ink-3 xl:block"
          title="Provenance: unchipped values are structural; H heuristic · C curated · M model."
        >
          unchipped = structural · H · C · M
        </span>
      </div>
    </div>
  );
}

/** Left vertical nav rail (as originally): Ops and Product as distinct
 * sections — each header links to its domain dashboard — with the
 * sub-category pages indented beneath. */
function NavRail() {
  const location = useLocation();
  const search = location.search;
  const room = roomOf(location.pathname);
  return (
    <nav className="w-52 shrink-0 border-r border-hairline bg-surface px-3 py-4">
      <div className="flex flex-col gap-5">
        {(["ops", "product"] as const).map((s) => (
          <div key={s}>
            <NavLink
              to={{ pathname: `/${s}`, search }}
              end
              className="block rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wider"
              style={({ isActive }) => ({
                color: room === s ? sideColor(s) : "var(--color-ink-3)",
                background: isActive ? sideSoft(s) : undefined,
              })}
            >
              {s === "ops" ? "Ops" : "Product"}
            </NavLink>
            <div className="mt-0.5 flex flex-col">
              {SUB_PAGES[s].map((t) => (
                <NavLink
                  key={t.to}
                  to={{ pathname: t.to, search }}
                  end
                  className="block rounded py-1 pr-2 pl-4 text-sm text-ink-2 hover:bg-paper"
                  style={({ isActive }) =>
                    isActive
                      ? { color: sideColor(s), background: sideSoft(s), fontWeight: 500 }
                      : {}
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
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
  const onIndex = location.pathname === "/";
  const onSession = location.pathname.startsWith("/session/");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10">
        <TopBar showFilters={!onSession && !onIndex} />
      </header>
      <div className="flex min-h-[calc(100vh-45px)]">
        <NavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className={onIndex ? "flex flex-1 flex-col px-6 py-5" : "flex-1 px-6 py-5"}>
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
