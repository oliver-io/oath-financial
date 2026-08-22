// / — a pure index to the two rooms (user directive): no data, no queries.
// Each room card names its dashboard and sub-pages with their questions.
// Deliberately-not-built rationale lives in docs and the room dashboards.

import { Link, useLocation } from "react-router";

const ROOMS = [
  {
    side: "ops" as const,
    to: "/ops",
    title: "Ops — system health",
    lead: "Is the system healthy? Failures by signature, incidents, environment health.",
    pages: [
      {
        to: "/ops/failures",
        label: "Failures & incidents",
        q: "What is breaking, how badly, one-off or systemic?",
      },
      {
        to: "/ops/environments",
        label: "Environments",
        q: "Which client environments show elevated error rates?",
      },
      {
        to: "/ops/rhythm",
        label: "Working rhythm",
        q: "When and in what pattern does each auditor work?",
      },
    ],
  },
  {
    side: "product" as const,
    to: "/product",
    title: "Product — the work",
    lead: "Are people getting work done? Job mix, outcomes, interaction cost, capability gaps.",
    pages: [
      {
        to: "/product/usage",
        label: "Usage",
        q: "Who uses this, for what work, where is it concentrated?",
      },
      {
        to: "/product/outcomes",
        label: "Outcomes",
        q: "Do tasks finish, and what do they cost in human interactions?",
      },
      {
        to: "/product/agent",
        label: "Agent behavior",
        q: "Where does the agent repeat itself, run long, or get corrected?",
      },
    ],
  },
];

export function IndexPage() {
  const location = useLocation();
  const search = location.search;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center py-10">
      <h1 className="text-2xl font-semibold text-ink">Trace Insights</h1>
      <p className="mt-2 mb-8 text-base text-ink-3">
        Observability for auditor agent sessions — one dataset, two rooms.
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {ROOMS.map((room) => {
          const color = room.side === "ops" ? "var(--color-ops)" : "var(--color-product)";
          return (
            <div
              key={room.side}
              className="flex flex-col rounded border border-hairline bg-surface"
              style={{ borderTop: `3px solid ${color}` }}
            >
              <Link to={{ pathname: room.to, search }} className="block p-6 hover:bg-paper">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-lg font-semibold" style={{ color }}>
                    {room.title}
                  </div>
                  <span
                    className="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-medium tracking-wide uppercase"
                    style={{ color, borderColor: color }}
                  >
                    dashboard →
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-3">{room.lead}</p>
              </Link>
              <div className="flex flex-1 flex-col divide-y divide-hairline border-t border-hairline bg-paper">
                {room.pages.map((p) => (
                  <Link
                    key={p.to}
                    to={{ pathname: p.to, search }}
                    className="group flex flex-1 items-center justify-between gap-3 px-6 py-5 text-sm text-ink-2 hover:bg-surface hover:text-ink"
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-ink">{p.label}</span>
                      <span className="mt-0.5 text-xs text-ink-3">{p.q}</span>
                    </span>
                    <span className="text-ink-3 group-hover:text-ink">›</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
