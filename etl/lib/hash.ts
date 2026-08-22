// sha256 helpers (file, object, packet).
// Contract: docs/plans/etl.md §2 lib/hash.ts. Pure utilities — real, not stubs.
// Object hashing is key-order-stable so packet hashes are deterministic
// (packet stability IS cache correctness — docs/architecture/etl.md stage 3).

import { createHash } from "node:crypto";

/** sha256 hex digest of a UTF-8 string. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 hex digest of a file's bytes. */
export async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

/** sha256 of a JSON-serializable object with recursively sorted keys, so two
 * structurally-equal objects always hash identically regardless of insertion order. */
export function sha256Object(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

/** Enrichment cache key: sha256(job|packet_hash|prompt_version|model_id)
 * per docs/architecture/etl.md stage 3. */
export function cacheKey(
  job: string,
  packetHash: string,
  promptVersion: string,
  modelId: string,
): string {
  return sha256Text(`${job}|${packetHash}|${promptVersion}|${modelId}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}
