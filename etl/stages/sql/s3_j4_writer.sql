-- Output: enrich.j4_gaps rows — verdict / abstention / error, exactly one row
-- per selected cluster (docs/architecture/llm.md invariant). The runner fills
-- _j4_pending per batch; this INSERT runs inside one transaction.
INSERT INTO enrich.j4_gaps SELECT * FROM _j4_pending;
