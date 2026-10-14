-- Human decisions taken on the private DIBA review page (see docs/DEPLOYMENT.md, "Página privada de revisión").
--
-- KEEP_SEPARATE rows are read by the DIBA importer next to data-policy/diba-link-overrides.json: a record that
-- a person has confirmed as a distinct event stops being listed as a possible duplicate. MERGED rows are an
-- audit trail of the merges executed from the page; they never influence the importer, because a merge changes the
-- plans themselves (plan_sources / plan_aliases) and keeps its own rollback SQL here.
CREATE TABLE IF NOT EXISTS diba_review_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL CHECK (length(trim(item_id)) > 0),
    source_key TEXT NOT NULL CHECK (source_key LIKE 'diba-%'),
    source_record_id TEXT NOT NULL CHECK (length(trim(source_record_id)) > 0),
    decision TEXT NOT NULL CHECK (decision IN ('KEEP_SEPARATE', 'MERGED')),
    alias_plan_id INTEGER,
    canonical_plan_id INTEGER,
    rollback_sql TEXT,
    note TEXT,
    decided_by TEXT NOT NULL CHECK (length(trim(decided_by)) > 0),
    decided_at TEXT NOT NULL,
    UNIQUE (source_key, source_record_id),
    CHECK (decision <> 'MERGED' OR (alias_plan_id IS NOT NULL AND canonical_plan_id IS NOT NULL AND rollback_sql IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_diba_review_decisions_item ON diba_review_decisions(item_id);
