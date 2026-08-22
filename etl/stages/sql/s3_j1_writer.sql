-- Output: enrich.j1_verdicts rows — verdict / abstention / error, exactly one
-- row per selected record (docs/architecture/llm.md invariant). The runner
-- fills _j1_pending per batch; this INSERT runs inside one transaction.
INSERT INTO enrich.j1_verdicts SELECT * FROM _j1_pending;
