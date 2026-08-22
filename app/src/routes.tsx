// Child routes, in their own module so tests can mount the identical tree
// under a memory router (no browser-history construction at import time).

import { FindingsPage } from "./pages/FindingsPage.tsx";
import { OpsEnvironmentsPage } from "./pages/OpsEnvironmentsPage.tsx";
import { OpsPage } from "./pages/OpsPage.tsx";
import { OpsRhythmPage } from "./pages/OpsRhythmPage.tsx";
import { ProductAgentPage } from "./pages/ProductAgentPage.tsx";
import { ProductOutcomesPage } from "./pages/ProductOutcomesPage.tsx";
import { ProductUsagePage } from "./pages/ProductUsagePage.tsx";
import { SessionPage } from "./pages/SessionPage.tsx";

export const appChildRoutes = [
  { index: true, element: <FindingsPage /> },
  { path: "ops", element: <OpsPage /> },
  { path: "ops/environments", element: <OpsEnvironmentsPage /> },
  { path: "ops/rhythm", element: <OpsRhythmPage /> },
  { path: "product/usage", element: <ProductUsagePage /> },
  { path: "product/outcomes", element: <ProductOutcomesPage /> },
  { path: "product/agent", element: <ProductAgentPage /> },
  { path: "session/:id", element: <SessionPage /> },
];
