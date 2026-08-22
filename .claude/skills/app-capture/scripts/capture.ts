#!/usr/bin/env bun
/**
 * app-capture — state-aware screenshots of the running app via CDP.
 *
 * Never captures blind: waits for the app's readiness contract
 * (document.documentElement[data-capture-state]) to reach the REQUESTED state,
 * settles fonts + two animation frames, disables transitions, then captures.
 * Refuses to write an image of the wrong state.
 *
 * Usage:
 *   bun .claude/skills/app-capture/scripts/capture.ts \
 *     --route "/ops?signature=portal-auth-403" \
 *     --out shots/ops-auth.png \
 *     [--base http://localhost:5173] [--state ready|loading|error|empty]
 *     [--width 1600] [--height 1200] [--full-page] [--timeout 30000]
 *     [--wait-for "<extra css selector that must exist>"]
 *
 * Readiness contract (implemented by the app shell):
 *   <html data-capture-state="booting|loading|ready|error|empty">
 *   - "ready": manifest + partitions loaded AND every mounted construct's
 *     query has resolved (no skeletons in the tree)
 *   - "loading": data plane up, page queries in flight (skeletons visible)
 *   - "empty": queries resolved to an empty window state
 *   - "error": a construct-level or loader error state is showing
 * Fallback when the attribute is absent (older app builds): --wait-for is
 * REQUIRED, and the capture is stamped "contract:none" on stderr.
 *
 * Exit codes: 0 captured in requested state · 2 usage · 3 chrome/CDP failure
 *             4 timeout waiting for requested state (reports the state seen)
 *             5 wrong state persisted (e.g. asked ready, app stuck in error)
 */

import { parseArgs } from "node:util";
import { existsSync } from "node:fs";

const { values } = parseArgs({
  options: {
    route: { type: "string" },
    url: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "http://localhost:5173" },
    state: { type: "string", default: "ready" },
    width: { type: "string", default: "1600" },
    height: { type: "string", default: "1200" },
    timeout: { type: "string", default: "30000" },
    "wait-for": { type: "string" },
    "full-page": { type: "boolean", default: false },
    port: { type: "string", default: "9223" },
  },
});

function die(code: number, msg: string): never {
  console.error(`app-capture: ${msg}`);
  process.exit(code);
}

if (!values.out) die(2, "required: --out <path.png>");
if (!values.route && !values.url) die(2, "required: --route </path?query> or --url <full url>");
const REQUESTED = values.state as "ready" | "loading" | "error" | "empty";
if (!["ready", "loading", "error", "empty"].includes(REQUESTED))
  die(2, `--state must be ready|loading|error|empty (got "${REQUESTED}")`);
const url = values.url ?? new URL(values.route!, values.base).toString();
const port = Number(values.port);
const timeoutMs = Number(values.timeout);

// ---------- chrome: reuse a debug-port instance or launch our own ----------
async function cdpAlive(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
    return r.ok;
  } catch {
    return false;
  }
}

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

let launched: ReturnType<typeof Bun.spawn> | null = null;
if (!(await cdpAlive())) {
  const chrome = CHROME_PATHS.find((p) => existsSync(p));
  if (!chrome) die(3, "chrome not found; install Chrome or start one with --remote-debugging-port yourself");
  const profile = `${process.env.TEMP ?? "/tmp"}/app-capture-profile-${port}`;
  launched = Bun.spawn(
    [chrome, "--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const deadline = Date.now() + 10_000;
  while (!(await cdpAlive())) {
    if (Date.now() > deadline) die(3, "chrome did not open its debug port within 10s");
    await Bun.sleep(200);
  }
}

// ---------- minimal CDP client ----------
const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
let target = targets.find((t) => t.type === "page");
if (!target)
  target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
};
const send = (method: string, params: any = {}) =>
  new Promise<any>((res, rej) => {
    const i = ++msgId;
    pending.set(i, res);
    try {
      ws.send(JSON.stringify({ id: i, method, params }));
    } catch (e) {
      rej(e);
    }
  });
const evalJs = async (expression: string): Promise<any> => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? "evaluate failed");
  return r.result?.result?.value;
};

await new Promise((r) => (ws.onopen = r));
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(values.width),
  height: Number(values.height),
  deviceScaleFactor: 1,
  mobile: false,
});
// Kill transitions/animations & caret before the app boots — deterministic pixels.
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `document.addEventListener("DOMContentLoaded",()=>{const s=document.createElement("style");s.textContent="*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";document.head.appendChild(s);});`,
});
await send("Page.navigate", { url });

// ---------- state-aware wait ----------
const PROBE = `(() => {
  const el = document.documentElement;
  const contract = el.hasAttribute("data-capture-state");
  return { contract, state: el.getAttribute("data-capture-state") };
})()`;

const deadline = Date.now() + timeoutMs;
let lastSeen = "(no contract attribute)";
let contractPresent = false;
for (;;) {
  const probe = await evalJs(PROBE).catch(() => null);
  if (probe) {
    contractPresent = probe.contract;
    lastSeen = probe.state ?? lastSeen;
    if (probe.contract && probe.state === REQUESTED) break;
    // terminal wrong-states: asked ready but app settled into error
    if (probe.contract && REQUESTED === "ready" && probe.state === "error")
      die(5, `app settled into state "error" while "ready" was requested — capture refused (fix or capture --state error deliberately)`);
  }
  if (!contractPresent && values["wait-for"]) {
    const found = await evalJs(`!!document.querySelector(${JSON.stringify(values["wait-for"])})`).catch(() => false);
    if (found) {
      console.error(`app-capture: contract:none — proceeded on --wait-for selector; upgrade the app to the data-capture-state contract`);
      break;
    }
  }
  if (Date.now() > deadline) {
    if (!contractPresent && !values["wait-for"])
      die(4, `no data-capture-state attribute on <html> and no --wait-for given; refusing a blind capture. Last state: ${lastSeen}`);
    die(4, `timed out waiting for state "${REQUESTED}" (last seen: "${lastSeen}")`);
  }
  await Bun.sleep(250);
}

// extra selector gate (optional, composes with the contract)
if (contractPresent && values["wait-for"]) {
  const ok = await evalJs(`!!document.querySelector(${JSON.stringify(values["wait-for"])})`).catch(() => false);
  if (!ok) die(4, `state "${REQUESTED}" reached but --wait-for selector never appeared: ${values["wait-for"]}`);
}

// settle: fonts + two rAFs (layout/paint quiesce)
await evalJs(`document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);

// ---------- capture ----------
let clip: any;
if (values["full-page"]) {
  const m = await send("Page.getLayoutMetrics");
  const cs = m.result?.cssContentSize ?? m.result?.contentSize;
  if (cs) {
    clip = { x: 0, y: 0, width: Math.min(cs.width, 4000), height: Math.min(cs.height, 8000), scale: 1 };
    await send("Emulation.setDeviceMetricsOverride", {
      width: Math.ceil(clip.width),
      height: Math.ceil(clip.height),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await Bun.sleep(200);
  }
}
const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip, captureBeyondViewport: true } : {}) });
if (!shot.result?.data) die(3, `captureScreenshot failed: ${JSON.stringify(shot).slice(0, 300)}`);
const bytes = Buffer.from(shot.result.data, "base64");
if (bytes.length < 8_000) die(5, `capture suspiciously small (${bytes.length} bytes) — likely a blank page; refused`);
await Bun.write(values.out!, bytes);

console.log(
  JSON.stringify({
    out: values.out,
    url,
    state: REQUESTED,
    contract: contractPresent ? "data-capture-state" : "wait-for-fallback",
    bytes: bytes.length,
    viewport: { width: Number(values.width), height: Number(values.height), fullPage: !!values["full-page"] },
  }),
);

if (launched) launched.kill();
process.exit(0);
