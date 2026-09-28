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

  // Phase 4C.6B fallback for multi-venue groups (Memoria en temps de
  // guerra..., Espais de poder...): a genuinely new Gencat record for an
  // already-applied group won't always match the EXACT (source, title, venue)
  // key the group was originally applied under, because each raw record's own
  // `espai` differs per venue leg while the applied group's key is fixed to
  // whichever single venue the canonical plan ended up with. Matching by
  // title alone is only safe when it is unambiguous: if the same title was
  // ever separately applied under a genuinely DIFFERENT venue as its own,
  // distinct production, this refuses to guess (fail-closed) rather than
  // risk misattributing a record to the wrong production.
  findCanonicalPlanIdByTitle(source, normalizedTitle) {
    const rows = this.db.prepare('SELECT group_key, canonical_plan_id FROM recurring_production_applied_groups').all();
    const matches = rows.filter((row) => {
      const [rowSource, rowTitle] = row.group_key.split('|');
      return rowSource === source && rowTitle === normalizedTitle;
    });
    return matches.length === 1 ? matches[0].canonical_plan_id : null;
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
