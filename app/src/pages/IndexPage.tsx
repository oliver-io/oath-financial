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
      { to: "/ops/environments", label: "Environments", q: "Which client box is unhealthy?" },
      {
        to: "/ops/rhythm",
        label: "Working rhythm",
        q: "How does work actually flow, per auditor and engagement?",
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
        q: "Where does the agent thrash, retry, or get corrected?",
      },
    ],
  },
];

export function IndexPage() {
  const location = useLocation();
  const search = location.search;
  return (
    <div className="mx-auto mt-[10vh] mb-auto w-full max-w-5xl">
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
              className="rounded border border-hairline bg-surface"
              style={{ borderTop: `3px solid ${color}` }}
            >
              <Link to={{ pathname: room.to, search }} className="block p-6 hover:bg-paper">
                <div className="text-lg font-semibold" style={{ color }}>
                  {room.title} →
                </div>
                <p className="mt-1.5 text-sm text-ink-3">{room.lead}</p>
              </Link>
              <div className="border-t border-hairline px-6 py-3">
                {room.pages.map((p) => (
                  <Link
                    key={p.to}
                    to={{ pathname: p.to, search }}
                    className="block py-2.5 text-sm text-ink-2 hover:text-ink"
                  >
                    <span className="font-medium text-ink">{p.label}</span>
                    <span className="ml-2 text-[11px] text-ink-3">{p.q}</span>
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
