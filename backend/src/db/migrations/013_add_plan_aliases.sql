-- Durable redirect model for historical recurring-production consolidation
-- (Phase 4C.3A). When N fragmented plans are consolidated into one canonical
-- plan, the N-1 non-canonical plan rows are marked inactive+permanent (never
-- deleted, never reused) and one plan_aliases row is written per old plan id
-- so old public URLs (/plans/:oldId) keep resolving via a server-side 301
-- instead of disappearing. This table is never written by ordinary imports —
-- only by a human-authorized consolidation migration script.
CREATE TABLE plan_aliases (
    alias_plan_id INTEGER PRIMARY KEY,
    canonical_plan_id INTEGER NOT NULL,
    group_key TEXT NOT NULL CHECK (trim(group_key) <> ''),
    reason TEXT NOT NULL CHECK (trim(reason) <> ''),
    created_at TEXT NOT NULL,
    CHECK (alias_plan_id <> canonical_plan_id),
    FOREIGN KEY(alias_plan_id) REFERENCES plans(id),
    FOREIGN KEY(canonical_plan_id) REFERENCES plans(id)
);

CREATE INDEX idx_plan_aliases_canonical ON plan_aliases(canonical_plan_id);

-- A canonical target must never itself already be an alias of something else
-- (no chains: alias -> alias -> canonical is never allowed).
CREATE TRIGGER trg_plan_aliases_no_chain_insert
BEFORE INSERT ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE alias_plan_id = NEW.canonical_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: canonical_plan_id must not itself be an alias (chain)');
END;

-- A plan that is already used as someone else's canonical target must never
-- become an alias itself (no cycles, and a canonical plan can never
-- simultaneously be an alias).
CREATE TRIGGER trg_plan_aliases_no_cycle_insert
BEFORE INSERT ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE canonical_plan_id = NEW.alias_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: alias_plan_id is already a canonical target elsewhere (would create a cycle/chain)');
END;

-- The same two invariants, enforced again on UPDATE. No application code
-- currently updates plan_aliases (only inserts), but the schema itself must
-- stay airtight against a raw UPDATE (a future code change, an admin/debug
-- tool, or a manual fix) — not just against INSERT (cross-review finding).
CREATE TRIGGER trg_plan_aliases_no_chain_update
BEFORE UPDATE OF alias_plan_id, canonical_plan_id ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE alias_plan_id = NEW.canonical_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: canonical_plan_id must not itself be an alias (chain)');
END;

CREATE TRIGGER trg_plan_aliases_no_cycle_update
BEFORE UPDATE OF alias_plan_id, canonical_plan_id ON plan_aliases
WHEN EXISTS (SELECT 1 FROM plan_aliases WHERE canonical_plan_id = NEW.alias_plan_id)
BEGIN
    SELECT RAISE(ABORT, 'plan_aliases: alias_plan_id is already a canonical target elsewhere (would create a cycle/chain)');
END;
