// Durable redirect lookups for historically consolidated recurring
// productions (see migrations/013_add_plan_aliases.sql). Read-heavy: the HTML
// and API routes call findCanonicalId() on every /plans/:id request, so the
// lookup is a single indexed PRIMARY KEY read. Writes only ever happen from
// the human-authorized consolidation script (scripts/consolidate-recurring-group.js).
//
// alias_plan_id does NOT require a corresponding `plans` row to exist
// (migrations/016_allow_legacy_plan_aliases.sql) — retention can delete an
// old plan row before its recurring group is ever consolidated, and that old
// public URL must still redirect. is_legacy marks such rows for auditability;
// it never changes lookup behavior (findCanonicalId works identically either
// way — the whole point is that callers never need to know the difference).
export class PlanAliasRepository {
  constructor(db) {
    this.db = db;
    this.findCanonical = db.prepare('SELECT canonical_plan_id FROM plan_aliases WHERE alias_plan_id = ?');
    this.insert = db.prepare(`
      INSERT INTO plan_aliases (alias_plan_id, canonical_plan_id, group_key, reason, is_legacy, created_at)
      VALUES (@alias_plan_id, @canonical_plan_id, @group_key, @reason, @is_legacy, @created_at)
    `);
    this.listForCanonicalStmt = db.prepare('SELECT alias_plan_id FROM plan_aliases WHERE canonical_plan_id = ? ORDER BY alias_plan_id');
    this.isAliasStmt = db.prepare('SELECT 1 FROM plan_aliases WHERE alias_plan_id = ?');
    this.isCanonicalStmt = db.prepare('SELECT 1 FROM plan_aliases WHERE canonical_plan_id = ?');
    this.isLegacyStmt = db.prepare('SELECT is_legacy FROM plan_aliases WHERE alias_plan_id = ?');
  }

  // Returns the canonical plan id for a given (possibly old/alias) plan id,
  // or null if the id is not an alias of anything.
  findCanonicalId(planId) {
    return this.findCanonical.get(planId)?.canonical_plan_id ?? null;
  }

  create({ aliasPlanId, canonicalPlanId, groupKey, reason, isLegacy = false }, { now = new Date().toISOString() } = {}) {
    this.insert.run({
      alias_plan_id: aliasPlanId,
      canonical_plan_id: canonicalPlanId,
      group_key: groupKey,
      reason,
      is_legacy: isLegacy ? 1 : 0,
      created_at: now,
    });
  }

  listForCanonical(canonicalPlanId) {
    return this.listForCanonicalStmt.all(canonicalPlanId).map((row) => row.alias_plan_id);
  }

  isAlias(planId) {
    return Boolean(this.isAliasStmt.get(planId));
  }

  isCanonical(planId) {
    return Boolean(this.isCanonicalStmt.get(planId));
  }

  isLegacy(aliasPlanId) {
    return this.isLegacyStmt.get(aliasPlanId)?.is_legacy === 1;
  }
}
