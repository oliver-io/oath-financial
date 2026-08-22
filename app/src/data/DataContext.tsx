// App-wide data context: boots the runtime + store once, exposes the manifest,
// degraded context, and typed query hooks. Failure posture per app.md §4:
// boot errors render as an error state, never a blank page.

import type { ServeManifest } from "@trace-insights/contracts";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import type { z } from "zod";
import { DEFAULT_FILTERS, type FilterState, parseFilters } from "../state/urlState.ts";
import { setBootCaptureState, trackCapture } from "./captureState.ts";
import { DataStore, type DegradedContext } from "./loader.ts";
import type { DbRuntime } from "./runtime.ts";
import { fullRange, type TimeWindow } from "./window.ts";

export interface DataApi {
  store: DataStore;
  manifest: ServeManifest;
  degraded: DegradedContext;
}

interface DataState {
  api: DataApi | null;
  error: string | null;
  bootPhase: string;
}

const DataCtx = createContext<DataState>({ api: null, error: null, bootPhase: "starting" });

/** Injectable for tests (the browser runtime imports `?worker` assets Bun
 * cannot parse); the default lazy-imports the DuckDB-WASM runtime. */
export type RuntimeFactory = () => Promise<DbRuntime>;
const defaultRuntimeFactory: RuntimeFactory = async () =>
  (await import("./runtime.ts")).createRuntime();

export function DataProvider({
  children,
  runtimeFactory = defaultRuntimeFactory,
}: {
  children: ReactNode;
  runtimeFactory?: RuntimeFactory;
}) {
  const [state, setState] = useState<DataState>({ api: null, error: null, bootPhase: "starting" });
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: boot runs exactly once; the ref guards re-entry
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const phase = (bootPhase: string) => setState((s) => ({ ...s, bootPhase }));
    setBootCaptureState("booting");
    (async () => {
      const runId = new URLSearchParams(window.location.search).get("run") ?? undefined;
      phase("starting query engine");
      const db = await runtimeFactory();
      phase("fetching manifest + reference plane");
      const store = new DataStore(db);
      await store.init(runId);
      setState({
        api: { store, manifest: store.manifest, degraded: store.degraded },
        error: null,
        bootPhase: "ready",
      });
      setBootCaptureState("ready");
    })().catch((err: unknown) => {
      setBootCaptureState("failed");
      setState({
        api: null,
        error: err instanceof Error ? err.message : String(err),
        bootPhase: "failed",
      });
    });
  }, []);
  return <DataCtx.Provider value={state}>{children}</DataCtx.Provider>;
}

export function useDataState(): DataState {
  return useContext(DataCtx);
}

/** Non-null data api — call only below the boot gate. */
export function useData(): DataApi {
  const { api } = useContext(DataCtx);
  if (!api) throw new Error("useData called before data boot completed");
  return api;
}

/** Current filter state, parsed from the URL (the only store). */
export function useFilters(): FilterState {
  const location = useLocation();
  return useMemo(() => parseFilters(new URLSearchParams(location.search)), [location.search]);
}

/** The effective window: URL window or the manifest-derived full range. */
export function useWindow(): TimeWindow {
  const { manifest } = useData();
  const filters = useFilters();
  return filters.window ?? fullRange(manifest);
}

export interface QueryResult<T> {
  rows: T[] | null; // null while loading
  error: string | null;
  loading: boolean;
  fetchProgress: { done: number; total: number } | null;
}

/** Runs a windowed SQL query (fact views scoped to `win`), validating every
 * row against the given contract schema. Pass win = null for reference-plane
 * queries that must not touch fact views. */
export function useRows<S extends z.ZodType>(
  schema: S,
  sql: string | null,
  win: TimeWindow | null,
): QueryResult<z.infer<S>> {
  const { api } = useDataState();
  const [state, setState] = useState<QueryResult<z.infer<S>>>({
    rows: null,
    error: null,
    loading: true,
    fetchProgress: null,
  });
  const key = `${sql}|${win?.fromDay}|${win?.toDay}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs are keyed on the serialized sql+window; schema identity is deliberately not a dependency
  useEffect(() => {
    if (!api || sql === null) return;
    let alive = true;
    let settled = false;
    trackCapture("loading", 1);
    const settle = () => {
      if (!settled) {
        settled = true;
        trackCapture("loading", -1);
      }
    };
    setState((s) => ({ ...s, loading: true, error: null }));
    const onProgress = (done: number, total: number) => {
      if (alive && total > 0) setState((s) => ({ ...s, fetchProgress: { done, total } }));
    };
    const promise = win
      ? api.store.queryInWindow(win.fromDay, win.toDay, sql, onProgress)
      : api.store.query(sql);
    promise
      .then((raw) => {
        if (!alive) return;
        const rows = raw.map((r) => schema.parse(r) as z.infer<S>);
        setState({ rows, error: null, loading: false, fetchProgress: null });
        settle();
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          rows: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
          fetchProgress: null,
        });
        settle();
      });
    return () => {
      alive = false;
      settle();
    };
  }, [api, key]);
  return state;
}

export { DEFAULT_FILTERS };
