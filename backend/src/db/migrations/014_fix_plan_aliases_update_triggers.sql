-- Fixes a false-positive in the plan_aliases UPDATE guard triggers added by
-- migration 013: their WHEN clauses checked for a conflicting row without
-- excluding the row being updated itself, so a legitimate single UPDATE
-- that changes a row's own alias_plan_id and canonical_plan_id together
-- could be rejected by comparing against its own pre-update state
-- (cross-review finding). SQLite has no CREATE OR REPLACE TRIGGER, so the
-- 013 triggers are dropped and recreated here with the corrected WHEN
-- clauses. This is a separate migration (rather than editing 013) so it
-- reaches any database where 013 was already applied — editing an
-- already-applied migration file never re-runs it (see db/migrate.js).
DROP TRIGGER trg_plan_aliases_no_chain_update;
DROP TRIGGER trg_plan_aliases_no_cycle_update;

CREATE TRIGGER trg_plan_aliases_no_chain_update
BEFORE UPDATE OF alias_plan_id, canonical_plan_id ON plan_aliases
WHEN EXISTS (
    SELECT 1 FROM plan_aliases
    WHERE alias_plan_id = NEW.canonical_plan_id AND alias_plan_id != OLD.alias_plan_id
)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: canonical_plan_id must not itself be an alias (chain)');
END;

CREATE TRIGGER trg_plan_aliases_no_cycle_update
BEFORE UPDATE OF alias_plan_id, canonical_plan_id ON plan_aliases
WHEN EXISTS (
    SELECT 1 FROM plan_aliases
    WHERE canonical_plan_id = NEW.alias_plan_id AND alias_plan_id != OLD.alias_plan_id
)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: alias_plan_id is already a canonical target elsewhere (would create a cycle/chain)');
END;
