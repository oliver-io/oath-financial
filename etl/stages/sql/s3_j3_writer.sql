-- Output: enrich.j3_verdicts rows — verdict / abstention / error, exactly one
-- row per selected record (docs/architecture/llm.md invariant). The runner
-- fills _j3_pending per batch; this INSERT runs inside one transaction.
INSERT INTO enrich.j3_verdicts SELECT * FROM _j3_pending;
