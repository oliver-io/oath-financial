// DuckDB session plumbing: open/close, runSqlFile(name, params), query helpers.
// Contract: docs/plans/etl.md §2 lib/duckdb.ts. Open/close and file plumbing are
// real (the phase-1 smoke test depends on them); the SQL files themselves carry
// the pipeline logic and are not implemented yet.

import { join } from "node:path";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { Unimplemented } from "./errors.ts";

const SQL_DIR = join(import.meta.dir, "..", "stages", "sql");

export interface DuckDbSession {
  readonly connection: DuckDBConnection;
  close(): void;
}

/** Opens (creating if absent) the pipeline database. Pass ":memory:" in tests. */
export async function openDuckDb(dbPath: string): Promise<DuckDbSession> {
  const instance = await DuckDBInstance.create(dbPath);
  const connection = await instance.connect();
  return {
    connection,
    close() {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

/** Runs one statement and returns all rows as objects. */
export async function queryRows(
  session: DuckDbSession,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const reader = await session.connection.runAndReadAll(sql);
  return reader.getRowObjects();
}

/** Runs one statement, returning nothing. */
export async function exec(session: DuckDbSession, sql: string): Promise<void> {
  await session.connection.run(sql);
}

/** Loads `etl/stages/sql/<name>.sql` from disk. */
export async function loadSqlFile(name: string): Promise<string> {
  return await Bun.file(join(SQL_DIR, `${name}.sql`)).text();
}

/** Executes a named SQL file against the session. Rules/thresholds reach the
 * SQL as DuckDB temp tables and SET VARIABLEs installed by the stage executor
 * and stage prepare() hooks (never string-spliced into the files — the .sql
 * files stay static and reviewable, docs/plans/etl.md §3 RuleSet). A file
 * still carrying the `-- UNIMPLEMENTED` placeholder throws Unimplemented so
 * red tests fail with the contract reference, not a SQL parse error. */
export async function runSqlFile(session: DuckDbSession, name: string): Promise<void> {
  const sql = await loadSqlFile(name);
  if (sql.includes("-- UNIMPLEMENTED")) {
    throw new Unimplemented(`runSqlFile(${name})`, "docs/plans/etl.md §3 Stage");
  }
  await session.connection.run(sql);
}

/** Runs a named SQL file that is a SELECT (enrichment selectors) and returns
 * its rows. Same UNIMPLEMENTED guard as runSqlFile. */
export async function querySqlFile(
  session: DuckDbSession,
  name: string,
): Promise<Record<string, unknown>[]> {
  const sql = await loadSqlFile(name);
  if (sql.includes("-- UNIMPLEMENTED")) {
    throw new Unimplemented(`querySqlFile(${name})`, "docs/plans/etl.md §3 JobSpec");
  }
  return await queryRows(session, sql);
}

/** SELECT COUNT(*) — used by stage rowCounts reports. */
export async function countRows(session: DuckDbSession, table: string): Promise<number> {
  const rows = await queryRows(session, `SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

/** Escapes a value into a DuckDB single-quoted string literal. Used only by
 * executor/prepare plumbing (paths, rule rows) — never inside .sql files. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
