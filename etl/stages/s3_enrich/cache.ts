// bun:sqlite LLM cache: get/put by composite key.
// Contract: docs/architecture/etl.md Stage 3 Cache — build/llm_cache.sqlite,
// one table cache(key TEXT PRIMARY KEY, job, packet_hash, prompt_version,
// model_id, response_json, created_at) where
// key = sha256(job|packet_hash|prompt_version|model_id) (etl/lib/hash.ts
// cacheKey). WAL mode; the file survives full pipeline rebuilds and is deleted
// only by `etl enrich --recache` (explicit flag, never default).

import type { Database } from "bun:sqlite";
import { Unimplemented } from "../../lib/errors.ts";

export interface CacheEntry {
  key: string;
  job: string;
  packetHash: string;
  promptVersion: string;
  modelId: string;
  responseJson: string;
  createdAt: string;
}

export class LlmCache {
  constructor(private readonly db: Database) {
    void this.db;
  }

  /** Opens (creating table if absent, WAL mode) the cache database at `path`. */
  static open(_path: string): LlmCache {
    throw new Unimplemented("LlmCache.open", "docs/architecture/etl.md Stage 3 cache");
  }

  get(_key: string): CacheEntry | null {
    throw new Unimplemented("LlmCache.get", "docs/architecture/etl.md Stage 3 cache");
  }

  put(_entry: CacheEntry): void {
    throw new Unimplemented("LlmCache.put", "docs/architecture/etl.md Stage 3 cache");
  }

  /** Deletes all rows — only reachable via `etl enrich --recache`. */
  clear(): void {
    throw new Unimplemented("LlmCache.clear", "docs/architecture/etl.md Stage 3 cache");
  }

  close(): void {
    throw new Unimplemented("LlmCache.close", "docs/architecture/etl.md Stage 3 cache");
  }
}
