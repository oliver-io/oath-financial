/// <reference types="vite/client" />

// Exact declarations: TS wildcard ambient modules don't match specifiers that
// also resolve through the package's export map, so the two Vite-suffixed
// DuckDB assets are declared individually.
declare module "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?worker" {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

declare module "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url" {
  const url: string;
  export default url;
}
