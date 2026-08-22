// Routes per docs/plans/ui.md section 2 sitemap.

import { createBrowserRouter } from "react-router";
import { AppShell } from "./pages/AppShell.tsx";
import { appChildRoutes } from "./routes.tsx";

export const router = createBrowserRouter([
  { path: "/", element: <AppShell />, children: appChildRoutes },
]);
