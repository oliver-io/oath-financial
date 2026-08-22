// Render smoke tests (app.md §7): every route in the sitemap mounts against
// the fixture pack without throwing, including /session/:id on the worst
// fixture session. Loading resolves to real construct content (footer run id)
// with no rendered error state.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

import { afterAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppShell } from "../src/pages/AppShell.tsx";
import { appChildRoutes } from "../src/routes.tsx";
import { createTestRuntime, installFetchStub } from "./testRuntime.ts";

installFetchStub();

const ROUTES = [
  "/",
  "/ops",
  "/ops/environments",
  "/ops/rhythm",
  "/product/usage",
  "/product/outcomes",
  "/product/agent",
  "/session/s-monster", // 76 turns, 131-call turn, 46KB message
  "/session/s-limit",
  "/session/s-resumed",
  "/session/does-not-exist",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roots: Root[] = [];

async function mountRoute(path: string, runId = "fixture-run-0001"): Promise<string> {
  // DataProvider reads the run override from window.location, not the router
  const url = `http://localhost/${runId === "fixture-run-0001" ? "" : `?run=${runId}`}`;
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  const runtime = await createTestRuntime(runId);
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(AppShell, { runtimeFactory: async () => runtime }),
        children: appChildRoutes,
      },
    ],
    { initialEntries: [path] },
  );
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  root.render(createElement(RouterProvider, { router }));
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    const text = el.textContent ?? "";
    if (text.includes(`run ${runId}`) && !text.includes("connecting to the data plane")) {
      return text;
    }
  }
  return el.textContent ?? "";
}

describe("render smoke", () => {
  for (const path of ROUTES) {
    test(`${path} mounts and resolves`, async () => {
      const text = await mountRoute(path);
      expect(text).toContain("run fixture-run-0001");
      expect(text).not.toContain("Couldn't load this view");
    }, 20000);
  }

  test("degraded run renders the enrichment-partial footer", async () => {
    const text = await mountRoute("/product/outcomes", "fixture-run-degraded");
    expect(text).toContain("run fixture-run-degraded");
    expect(text).toContain("enrichment partial");
  }, 20000);
});

afterAll(() => {
  for (const r of roots) r.unmount();
});
