// Render smoke tests (app.md §7): every route in the sitemap mounts against
// the fixture pack without throwing, including /session/:id on the worst
// fixture session. Loading resolves to real construct content (footer run id)
// with no rendered error state.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

// happy-dom has no layout, so Recharts measures every chart container as 0x0
// and warns per chart; silence exactly that message, pass everything else on.
// biome-ignore lint/suspicious/noConsole: targeted filter of Recharts warning spam
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("width(0) and height(0)")) return;
  realWarn(...args);
};

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
  "/ops/failures",
  "/ops/environments",
  "/ops/rhythm",
  "/product",
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

// Widget/page invariant (user directive): the dashboard can only ever contain
// widgets that are pinnable from a sub-page — every registry entry must render
// a pin control (data-pin-id) on its source page.
import { WIDGETS } from "../src/components/dashboard/widgets.tsx";

describe("widget pinnability invariant", () => {
  for (const w of WIDGETS) {
    test(`"${w.title}" (${w.id}) has a pin control on ${w.source}`, async () => {
      const runtime = await createTestRuntime("fixture-run-0001");
      const router = createMemoryRouter(
        [
          {
            path: "/",
            element: createElement(AppShell, { runtimeFactory: async () => runtime }),
            children: appChildRoutes,
          },
        ],
        { initialEntries: [w.source] },
      );
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      roots.push(root);
      root.render(createElement(RouterProvider, { router }));
      let found = false;
      for (let i = 0; i < 100 && !found; i++) {
        await new Promise((r) => setTimeout(r, 50));
        found = el.querySelector(`[data-pin-id="${w.id}"]`) !== null;
      }
      expect(found).toBe(true);
    }, 20000);
  }
});
