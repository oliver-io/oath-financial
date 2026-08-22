-- Output: J5 record keys + packet inputs — one row per seeded-sample member
--   (derive.tool_events.j5_sample_bucket: 'unmatched' missed-failure probes,
--   'matched' false-positive probes; sizes/seed from thresholds.yaml, computed
--   deterministically in stage 2). Consumed by s3_enrich/runner.ts.
SELECT
  e.observation_id,
  e.j5_sample_bucket AS bucket,
  e.tool_name,
  e.matched_signature_id,
  e.matched_snippet,
  substr(o.output_text, 1, 600) AS output_text
FROM derive.tool_events e
JOIN clean.observations o USING (observation_id)
WHERE e.j5_sample_bucket IS NOT NULL
ORDER BY e.j5_sample_bucket, e.observation_id;
