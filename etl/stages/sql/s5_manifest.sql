-- Output: publish.manifest_partitions — the per-day partition inventory the
--   TS-side finalize() reads to export day files and build the published
--   manifest.json (run id, partition list + date coverage, per-job enrichment
--   coverage, rule_versions = YAML version strings, stated_params) before the
--   latest.json pointer swap LAST (atomicity by ordering — all in
--   s5_publish.ts finalize()).
-- Contract: docs/architecture/etl.md Stage 5; docs/plans/etl.md §3;
--   contracts/src/manifest.ts ServeManifestSchema.
CREATE TABLE publish.manifest_partitions AS
SELECT 'turns' AS tbl, day, COUNT(*) AS n FROM publish.facts_turns GROUP BY day
UNION ALL
SELECT 'tool_events', day, COUNT(*) FROM publish.facts_tool_events GROUP BY day;
