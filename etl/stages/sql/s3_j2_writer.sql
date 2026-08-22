-- Output: enrich.j2_verdicts rows — verdict / abstention / error, exactly one
-- row per selected record (docs/architecture/llm.md invariant). The runner
-- fills _j2_pending per batch; this INSERT runs inside one transaction.
INSERT INTO enrich.j2_verdicts SELECT * FROM _j2_pending;
