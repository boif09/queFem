-- Allows plan_aliases.alias_plan_id to preserve a historical public plan ID
-- that no longer has a row in `plans` at all (Phase 4C.3A legacy-URL
-- hardening). Confirmed necessary in production: by the time the Gran Gala
-- Flamenc recurring group was actually consolidated, retention had already
-- removed 2 of its original 16 plan rows (ids 1196/1197) because their
-- occurrences had passed the retention cutoff — the detector, which only
-- ever sees current `plans` rows, could no longer see them. Without this
-- change, those two old public URLs would permanently 404 instead of
-- redirecting, because migration 013 required alias_plan_id to reference an
-- existing plans row.
--
-- SQLite has no ALTER TABLE DROP CONSTRAINT, so the table is rebuilt.
-- Preserved unchanged: the alias_plan_id PRIMARY KEY (still a hard uniqueness
-- guarantee), the canonical_plan_id FOREIGN KEY to plans (a redirect must
-- always point at a plan that genuinely exists), the
-- alias_plan_id<>canonical_plan_id CHECK, and all four chain/cycle-prevention
-- triggers — none of which ever reference the `plans` table, only
-- `plan_aliases` itself, so dropping alias_plan_id's FK does not weaken them
-- at all. Nothing else has a foreign key to plan_aliases, so rebuilding it
-- is safe regardless of the current PRAGMA foreign_keys setting.
--
-- New: is_legacy distinguishes an alias created by relinking a plan_sources
-- row away from a plan that still physically exists (is_legacy=0, the
-- original/normal case) from one that only ever exists to preserve a
-- retention-deleted historical public ID (is_legacy=1) — never inferred,
-- only ever written from an explicit, human-supplied --legacy-alias-id
-- value backed by prior verified evidence (e.g. a production audit).
CREATE TABLE plan_aliases_new (
    alias_plan_id INTEGER PRIMARY KEY,
    canonical_plan_id INTEGER NOT NULL,
    group_key TEXT NOT NULL CHECK (trim(group_key) <> ''),
    reason TEXT NOT NULL CHECK (trim(reason) <> ''),
    is_legacy INTEGER NOT NULL DEFAULT 0 CHECK (is_legacy IN (0, 1)),
    created_at TEXT NOT NULL,
    CHECK (alias_plan_id <> canonical_plan_id),
    FOREIGN KEY(canonical_plan_id) REFERENCES plans(id)
);

INSERT INTO plan_aliases_new (alias_plan_id, canonical_plan_id, group_key, reason, is_legacy, created_at)
SELECT alias_plan_id, canonical_plan_id, group_key, reason, 0, created_at FROM plan_aliases;

DROP TABLE plan_aliases;
ALTER TABLE plan_aliases_new RENAME TO plan_aliases;

CREATE INDEX idx_plan_aliases_canonical ON plan_aliases(canonical_plan_id);

CREATE TRIGGER trg_plan_aliases_no_chain_insert
BEFORE INSERT ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE alias_plan_id = NEW.canonical_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: canonical_plan_id must not itself be an alias (chain)');
END;

CREATE TRIGGER trg_plan_aliases_no_cycle_insert
BEFORE INSERT ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE canonical_plan_id = NEW.alias_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: alias_plan_id is already a canonical target elsewhere (would create a cycle/chain)');
END;

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
