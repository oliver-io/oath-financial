-- Output: enrich.j5_audit rows — verdict / abstention / error, exactly one row
-- per selected sample member (docs/architecture/llm.md invariant). The runner
-- fills _j5_pending per batch; this INSERT runs inside one transaction.
INSERT INTO enrich.j5_audit SELECT * FROM _j5_pending;
