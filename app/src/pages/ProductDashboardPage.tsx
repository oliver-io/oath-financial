// /product — the PRODUCT room dashboard: product findings, the room's
// headline visuals compact (same components as the full pages), and category
// cards for the room's sub-pages with live stats.

import { CategoryCard, GhostCategoryCard } from "../components/dashboard/CategoryCard.tsx";
import { FindingCards } from "../components/dashboard/FindingCards.tsx";
import { JobShareBar } from "../components/product/JobShareBar.tsx";
import { Skeleton } from "../components/shared/honesty.tsx";
import { useFilters, useRows, useWindow } from "../data/DataContext.tsx";
import {
  DashboardStatsSchema,
  JobShareSchema,
  qDashboardStats,
  qJobShare,
} from "../data/queries.ts";
import { count } from "../fmt.ts";
import { ContainmentCaption, PageTitle } from "./PageScaffold.tsx";
import { CompactPanel } from "../components/dashboard/CompactPanel.tsx";

export function ProductDashboardPage() {
  const win = useWindow();
  const filters = useFilters();
  const jobShare = useRows(JobShareSchema, qJobShare(win, filters), null);
  const stats = useRows(DashboardStatsSchema, qDashboardStats(win, filters), win);
  const s = stats.rows?.[0];
  return (
    <div>
      <PageTitle side="product" title="Product" question="Are people getting work done?" />
      <FindingCards audience="product" />
      <section className="mb-8 max-w-xl">
        <CompactPanel title="Job-type share" to="/product/usage" side="product">
          {jobShare.loading && <Skeleton />}
          {jobShare.rows && <JobShareBar rows={jobShare.rows} compact />}
          <ContainmentCaption />
        </CompactPanel>
      </section>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CategoryCard
          to="/product/usage"
          side="product"
          title="Usage"
          question="Who uses this, for what work, where is it concentrated?"
          stat={s ? count(s.turns) : null}
          statLabel="turns in window"
        />
        <CategoryCard
          to="/product/outcomes"
          side="product"
          title="Outcomes"
          question="Do tasks finish, and what do they cost in human interactions?"
          stat={s ? `${count(s.determined)} of ${count(s.contained)}` : null}
          statLabel="contained sessions determined"
        />
        <CategoryCard
          to="/product/agent"
          side="product"
          title="Agent behavior"
          question="Where does the agent thrash, retry, or get corrected?"
          stat={s ? count(s.chain_turns) : null}
          statLabel="turns with identical-input chains"
        />
        <GhostCategoryCard
          title="Cost analysis"
          reason="This telemetry undercounts tokens 15–20× (single-generation capture); any dollar or token figure would be invented."
        />
      </section>
      <p className="mt-2 text-[10px] text-ink-3">
        Turn stats use event-timestamp membership; the outcomes stat counts whole-contained
        sessions (product window rule).
      </p>
    </div>
  );
}
