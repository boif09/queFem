-- Authoritative runtime mapping of consolidated recurring-production groups
-- (Phase 4C.3A atomicity hardening). Replaces the earlier
-- data-policy/recurring-production-applied-groups.json file: that JSON file
-- could commit out of step with the SQLite consolidation transaction (a
-- crash, a lock, or a disk error between the two could leave the DB
-- consolidated with no importer mapping, silently allowing a future import
-- to re-fragment the very production this feature exists to fix). This
-- table is written inside the SAME transaction as the alias/relink/
-- occurrence/category writes in scripts/consolidate-recurring-group.js, so
-- they always commit or roll back together.
--
-- This is a separate table from plan_aliases: plan_aliases is the durable
-- URL-redirect model (keyed by old plan id), while this table is the
-- importer-facing groupKey -> canonicalPlanId lookup used by
-- GencatAgendaImporter.getTargetPlanId() for FUTURE occurrences. Alias plan
-- ids are deliberately not duplicated here — they are derivable from
-- plan_aliases.canonical_plan_id.
--
-- The human-reviewed recurring-production-decisions.json file remains
-- separate and version-controlled (policy/review state, not runtime state).
CREATE TABLE recurring_production_applied_groups (
    group_key TEXT PRIMARY KEY CHECK (trim(group_key) <> ''),
    source TEXT NOT NULL CHECK (trim(source) <> ''),
    canonical_plan_id INTEGER NOT NULL,
    applied_at TEXT NOT NULL,
    applied_by TEXT NOT NULL CHECK (trim(applied_by) <> ''),
    FOREIGN KEY(canonical_plan_id) REFERENCES plans(id)
);

CREATE INDEX idx_recurring_production_applied_groups_canonical
ON recurring_production_applied_groups(canonical_plan_id);
