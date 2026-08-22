// Child routes: `/` is a data-free index; each domain's root is its own
// dashboard; sub-category pages sit beneath it (navigation lives in the
// shell's domain navbar — no per-room layout).

import { IndexPage } from "./pages/IndexPage.tsx";
import { OpsDashboardPage } from "./pages/OpsDashboardPage.tsx";
import { OpsEnvironmentsPage } from "./pages/OpsEnvironmentsPage.tsx";
import { OpsPage } from "./pages/OpsPage.tsx";
import { OpsRhythmPage } from "./pages/OpsRhythmPage.tsx";
import { ProductAgentPage } from "./pages/ProductAgentPage.tsx";
import { ProductDashboardPage } from "./pages/ProductDashboardPage.tsx";
import { ProductOutcomesPage } from "./pages/ProductOutcomesPage.tsx";
import { ProductUsagePage } from "./pages/ProductUsagePage.tsx";
import { SessionPage } from "./pages/SessionPage.tsx";

export const appChildRoutes = [
  { index: true, element: <IndexPage /> },
  { path: "ops", element: <OpsDashboardPage /> },
  { path: "ops/failures", element: <OpsPage /> },
  { path: "ops/environments", element: <OpsEnvironmentsPage /> },
  { path: "ops/rhythm", element: <OpsRhythmPage /> },
  { path: "product", element: <ProductDashboardPage /> },
  { path: "product/usage", element: <ProductUsagePage /> },
  { path: "product/outcomes", element: <ProductOutcomesPage /> },
  { path: "product/agent", element: <ProductAgentPage /> },
  { path: "session/:id", element: <SessionPage /> },
];
