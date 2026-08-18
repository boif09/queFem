export class TicketmasterReconciliationRepository {
  constructor(db) {
    this.db = db;
  }

  candidates(sourceId, today, horizonEnd) {
    return this.db.prepare(`
      SELECT ps.id source_link_id, ps.source_record_id, ps.plan_id
      FROM plan_sources ps JOIN plans p ON p.id = ps.plan_id
      WHERE ps.source_id = ?
        AND COALESCE(p.end_date, p.start_date) >= ? AND p.start_date <= ?
    `).all(sourceId, today, horizonEnd);
  }

  findSourceRecord(sourceId, sourceRecordId) {
    return this.db.prepare(`
      SELECT
        ps.id source_link_id,
        ps.source_record_id,
        ps.plan_id,
        COALESCE(p.title_ca, p.title_es, p.original_title) plan_title,
        p.status plan_status
      FROM plan_sources ps
      JOIN plans p ON p.id = ps.plan_id
      WHERE ps.source_id = ? AND ps.source_record_id = ?
    `).get(sourceId, sourceRecordId);
  }

  sourcesForPlan(planId) {
    return this.db.prepare(`
      SELECT s.key, s.name, ps.source_record_id
      FROM plan_sources ps
      JOIN sources s ON s.id = ps.source_id
      WHERE ps.plan_id = ?
      ORDER BY s.key, ps.source_record_id
    `).all(planId);
  }

  removeSourceLinks(rows, {
    dryRun = false,
    removedAt = new Date().toISOString(),
    afterRemoval,
  } = {}) {
    if (dryRun || rows.length === 0) return rows;
    const remove = this.db.prepare('DELETE FROM plan_sources WHERE id = ?');
    const sourceCount = this.db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id = ?');
    const deactivate = this.db.prepare(`
      UPDATE plans
      SET status = 'inactive', inactive_at = ?, updated_at = ?
      WHERE id = ?
    `);
    const keepActive = this.db.prepare(`
      UPDATE plans
      SET status = 'active', inactive_at = NULL, updated_at = ?
      WHERE id = ? AND (status = 'inactive' OR inactive_at IS NOT NULL)
    `);
    this.db.transaction(() => {
      for (const row of rows) {
        remove.run(row.source_link_id);
        if (sourceCount.get(row.plan_id).count === 0) deactivate.run(removedAt, removedAt, row.plan_id);
        else keepActive.run(removedAt, row.plan_id);
      }
      if (afterRemoval) afterRemoval(rows);
    })();
    return rows;
  }

  reconcile(sourceId, seenIds, today, horizonEnd, { dryRun = false, removedAt } = {}) {
    const missing = this.candidates(sourceId, today, horizonEnd)
      .filter((row) => !seenIds.has(String(row.source_record_id)));
    return this.removeSourceLinks(missing, { dryRun, ...(removedAt ? { removedAt } : {}) });
  }
}
