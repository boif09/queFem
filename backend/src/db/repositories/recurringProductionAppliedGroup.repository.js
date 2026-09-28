// Authoritative runtime lookup for consolidated recurring-production groups
// (see migrations/015_add_recurring_production_applied_groups.sql). Written
// only from inside scripts/consolidate-recurring-group.js's single
// consolidation transaction, so it is never out of step with the plan_aliases/
// plan_sources/plan_occurrences writes it accompanies. Read by
// GencatAgendaImporter.getTargetPlanId() on every import.
export class RecurringProductionAppliedGroupRepository {
  constructor(db) {
    this.db = db;
    this.findCanonical = db.prepare('SELECT canonical_plan_id FROM recurring_production_applied_groups WHERE group_key = ?');
    this.insert = db.prepare(`
      INSERT INTO recurring_production_applied_groups (group_key, source, canonical_plan_id, applied_at, applied_by)
      VALUES (@group_key, @source, @canonical_plan_id, @applied_at, @applied_by)
    `);
    this.deleteStmt = db.prepare('DELETE FROM recurring_production_applied_groups WHERE group_key = ?');
    this.isAppliedStmt = db.prepare('SELECT 1 FROM recurring_production_applied_groups WHERE group_key = ?');
  }

  findCanonicalPlanId(groupKey) {
    return this.findCanonical.get(groupKey)?.canonical_plan_id ?? null;
  }

  isApplied(groupKey) {
    return Boolean(this.isAppliedStmt.get(groupKey));
  }

  create({ groupKey, source, canonicalPlanId, appliedBy }, { now = new Date().toISOString() } = {}) {
    this.insert.run({
      group_key: groupKey,
      source,
      canonical_plan_id: canonicalPlanId,
      applied_at: now,
      applied_by: appliedBy,
    });
  }

  delete(groupKey) {
    return this.deleteStmt.run(groupKey).changes;
  }
}
