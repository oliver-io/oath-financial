// bun:sqlite LLM cache: get/put by composite key.
// Contract: docs/architecture/etl.md Stage 3 Cache — build/llm_cache.sqlite,
// one table cache(key TEXT PRIMARY KEY, job, packet_hash, prompt_version,
// model_id, response_json, created_at) where
// key = sha256(job|packet_hash|prompt_version|model_id) (etl/lib/hash.ts
// cacheKey). WAL mode; the file survives full pipeline rebuilds and is deleted
// only by `etl enrich --recache` (explicit flag, never default). Only
// schema-VALID responses are cached — transport failures and schema failures
// re-attempt on the next run instead of being replayed.

import { Database } from "bun:sqlite";

export interface CacheEntry {
  key: string;
  job: string;
  packetHash: string;
  promptVersion: string;
  modelId: string;
  responseJson: string;
  createdAt: string;
}

interface CacheRow {
  key: string;
  job: string;
  packet_hash: string;
  prompt_version: string;
  model_id: string;
  response_json: string;
  created_at: string;
}

export class LlmCache {
  private constructor(private readonly db: Database) {}

  /** Opens (creating table if absent, WAL mode) the cache database at `path`. */
  static open(path: string): LlmCache {
    const db = new Database(path, { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS cache (
         key TEXT PRIMARY KEY, job TEXT, packet_hash TEXT, prompt_version TEXT,
         model_id TEXT, response_json TEXT, created_at TEXT)`,
    );
    return new LlmCache(db);
  }

  get(key: string): CacheEntry | null {
    const row = this.db.query<CacheRow, [string]>("SELECT * FROM cache WHERE key = ?").get(key);
    if (!row) return null;
    return {
      key: row.key,
      job: row.job,
      packetHash: row.packet_hash,
      promptVersion: row.prompt_version,
      modelId: row.model_id,
      responseJson: row.response_json,
      createdAt: row.created_at,
    };
  }

  put(entry: CacheEntry): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO cache
           (key, job, packet_hash, prompt_version, model_id, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.key,
        entry.job,
        entry.packetHash,
        entry.promptVersion,
        entry.modelId,
        entry.responseJson,
        entry.createdAt,
      );
  }

  /** Deletes rows — only reachable via `etl enrich --recache` (one job's rows
   * when scoped, everything otherwise). */
  clear(job?: string): void {
    if (job === undefined) this.db.query("DELETE FROM cache").run();
    else this.db.query("DELETE FROM cache WHERE job = ?").run(job);
  }

  close(): void {
    this.db.close();
  }
}
