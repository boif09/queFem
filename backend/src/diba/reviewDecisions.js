// Decisions taken on the private review page (table diba_review_decisions, migration 018).
export class DibaReviewDecisionRepository {
  constructor(db) {
    this.db = db;
    this.available = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'diba_review_decisions'").get());
    if (!this.available) return;
    this.insert = db.prepare(`INSERT INTO diba_review_decisions
      (item_id, source_key, source_record_id, decision, alias_plan_id, canonical_plan_id, rollback_sql, note, decided_by, decided_at)
      VALUES (@item_id, @source_key, @source_record_id, @decision, @alias_plan_id, @canonical_plan_id, @rollback_sql, @note, @decided_by, @decided_at)`);
    this.byItem = db.prepare('SELECT * FROM diba_review_decisions WHERE item_id = ? ORDER BY id');
    this.bySource = db.prepare('SELECT * FROM diba_review_decisions WHERE source_key = ? AND source_record_id = ?');
    this.all = db.prepare('SELECT * FROM diba_review_decisions ORDER BY id DESC');
    this.keepSeparateRows = db.prepare("SELECT * FROM diba_review_decisions WHERE decision = 'KEEP_SEPARATE' ORDER BY id");
    this.deleteKeepSeparate = db.prepare("DELETE FROM diba_review_decisions WHERE item_id = ? AND decision = 'KEEP_SEPARATE'");
  }

  record({ itemId, members, decision, aliasPlanId = null, canonicalPlanId = null, rollbackSql = null, note = null, decidedBy, now = new Date().toISOString() }) {
    const write = this.db.transaction(() => {
      for (const { sourceKey, sourceRecordId } of members) {
        if (this.bySource.get(sourceKey, String(sourceRecordId))) throw new Error(`A decision already exists for ${sourceKey}:${sourceRecordId}.`);
        this.insert.run({
          item_id: itemId, source_key: sourceKey, source_record_id: String(sourceRecordId), decision,
          alias_plan_id: aliasPlanId, canonical_plan_id: canonicalPlanId, rollback_sql: rollbackSql, note, decided_by: decidedBy, decided_at: now,
        });
      }
    });
    write();
  }

  forItem(itemId) { return this.available ? this.byItem.all(itemId) : []; }

  recent(limit = 25) { return this.available ? this.all.all().slice(0, limit) : []; }

  decidedItemIds() { return new Set(this.available ? this.all.all().map((row) => row.item_id) : []); }

  // Only a still-reversible KEEP_SEPARATE decision can be undone; a merge needs its rollback SQL.
  undoKeepSeparate(itemId) {
    if (!this.available) return 0;
    if (this.byItem.all(itemId).some((row) => row.decision === 'MERGED')) throw new Error('A merged item cannot be undone from the page.');
    return this.deleteKeepSeparate.run(itemId).changes;
  }

  // The importer reads these exactly like entries of data-policy/diba-link-overrides.json.
  keepSeparateOverrides() {
    if (!this.available) return [];
    return this.keepSeparateRows.all().map((row) => ({
      source: { sourceKey: row.source_key, sourceRecordId: row.source_record_id },
      decision: 'KEEP_SEPARATE',
      reason: row.note || 'Confirmed as a distinct event on the private review page.',
      reviewedAt: row.decided_at.slice(0, 10), reviewer: row.decided_by, expectedPlanId: null,
    }));
  }
}

// File overrides always win: a record that already has a reviewed decision in Git keeps it.
export function withReviewPageOverrides(fileOverrides, repository) {
  const known = new Set(fileOverrides.decisions.map(({ source }) => `${source.sourceKey}:${source.sourceRecordId}`));
  const extra = repository.keepSeparateOverrides().filter(({ source }) => !known.has(`${source.sourceKey}:${source.sourceRecordId}`));
  return { version: 1, decisions: [...fileOverrides.decisions, ...extra] };
}
