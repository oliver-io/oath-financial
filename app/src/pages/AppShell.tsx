// App shell — navigation revision (ui.md §3 "Navigation shell"): horizontal
// navbar with the two rooms as top-level entries; their sub-pages render as
// horizontal tabs within the room, underlined in the room identity color. The
// shared filter bar sits below the navbar and persists across tab switches
// (URL state unchanged — tabs are the existing routes). Boot gate + footer.

import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { FilterBar } from "../components/shared/FilterBar.tsx";
import { ErrorState, HatchDefs, Skeleton } from "../components/shared/honesty.tsx";
import { TimeWindowControl } from "../components/shared/TimeWindowControl.tsx";
import { DataProvider, type RuntimeFactory, useDataState } from "../data/DataContext.tsx";

type Side = "ops" | "product";

export const ROOM_TABS: Record<Side, { to: string; label: string }[]> = {
  ops: [
    { to: "/ops", label: "Failures" },
    { to: "/ops/environments", label: "Environments" },
    { to: "/ops/rhythm", label: "Rhythm" },
  ],
  product: [
    { to: "/product/usage", label: "Usage" },
    { to: "/product/outcomes", label: "Outcomes" },
    { to: "/product/agent", label: "Agent" },
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

function TopNav() {
  const location = useLocation();
  const search = location.search;
  const room = roomOf(location.pathname);
  const onDashboard = location.pathname === "/";
  return (
    <div className="border-b border-hairline bg-surface">
      <div className="flex items-center gap-6 px-6 pt-2">
        <Link
          to={{ pathname: "/", search }}
          className="text-sm font-semibold tracking-tight text-ink"
        >
          Trace Insights
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink
            to={{ pathname: "/", search }}
            className="rounded px-2.5 py-1 text-ink-2 hover:bg-paper"
            style={onDashboard ? { color: "var(--color-ink)", fontWeight: 600 } : {}}
          >
            Dashboard
          </NavLink>
          {(["ops", "product"] as const).map((s) => (
            <NavLink
              key={s}
              to={{ pathname: ROOM_TABS[s][0]?.to ?? "/", search }}
              className="rounded px-2.5 py-1 text-ink-2 hover:bg-paper"
              style={
                room === s ? { color: sideColor(s), background: sideSoft(s), fontWeight: 600 } : {}
              }
            >
              {s === "ops" ? "Ops" : "Product"}
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto hidden text-[10px] text-ink-3 md:block">
          Provenance: unchipped = structural · H heuristic · C curated · M model
        </span>
      </div>
      {room && (
        <div
          className="mt-1 flex gap-1 px-6"
          style={{ boxShadow: `inset 0 -2px 0 ${sideSoft(room)}` }}
        >
          {ROOM_TABS[room].map((t) => (
            <NavLink
              key={t.to}
              to={{ pathname: t.to, search }}
              end
              className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
              style={({ isActive }) =>
                isActive
                  ? {
                      color: sideColor(room),
                      fontWeight: 600,
                      boxShadow: `inset 0 -2px 0 ${sideColor(room)}`,
                    }
                  : undefined
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
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
  const onDashboard = location.pathname === "/";
  const onSession = location.pathname.startsWith("/session/");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10">
        <TopNav />
        <div className="border-b border-hairline bg-surface/95 px-6 py-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <TimeWindowControl />
            {!onSession && <FilterBar demoOnly={onDashboard} />}
          </div>
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
