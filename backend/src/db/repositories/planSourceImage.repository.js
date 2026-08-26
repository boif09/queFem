const ROLES = ['card', 'detail'];

function sameImage(row, image) {
  return row.url === image.url
    && row.ratio === image.ratio
    && row.width === image.width
    && row.height === image.height
    && row.is_fallback === Number(image.isFallback)
    && row.attribution === image.attribution;
}

export class PlanSourceImageRepository {
  constructor(db) {
    this.db = db;
  }

  findActiveTicketmasterSources() {
    return this.db.prepare(`
      SELECT ps.id plan_source_id, ps.plan_id, ps.source_record_id event_id
      FROM plan_sources ps
      JOIN sources s ON s.id = ps.source_id
      JOIN plans p ON p.id = ps.plan_id
      WHERE s.key = 'ticketmaster-discovery-feed'
        AND s.enabled = 1
        AND p.status = 'active'
      ORDER BY ps.id
    `).all();
  }

  findTicketmasterSourcesForRefresh(cutoff, { force = false } = {}) {
    const active = this.findActiveTicketmasterSources();
    if (force) return { total: active.length, sources: active };
    const refresh = this.db.prepare(`
      SELECT
        COUNT(*) image_count,
        MIN(last_seen_at) oldest_seen
      FROM plan_source_images
      WHERE plan_source_id = ?
    `);
    return {
      total: active.length,
      sources: active.filter((source) => {
        const state = refresh.get(source.plan_source_id);
        return state.image_count < 2 || !state.oldest_seen || state.oldest_seen <= cutoff;
      }),
    };
  }

  findServableTicketmasterImage(imageId) {
    return this.findServableImage(imageId, 'ticketmaster-discovery-feed');
  }

  findServableImage(imageId, sourceKey) {
    return this.db.prepare(`
      SELECT psi.id, psi.url
      FROM plan_source_images psi
      JOIN plan_sources ps ON ps.id = psi.plan_source_id
      JOIN sources s ON s.id = ps.source_id
      JOIN plans p ON p.id = ps.plan_id
      WHERE psi.id = ?
        AND s.key = ?
        AND s.enabled = 1
        AND p.status = 'active'
    `).get(imageId, sourceKey);
  }

  findAllImageIds() {
    return this.db.prepare('SELECT id FROM plan_source_images ORDER BY id').all().map(({ id }) => id);
  }

  findImageIdsForPlanSource(planSourceId) {
    return this.db.prepare('SELECT id FROM plan_source_images WHERE plan_source_id = ? ORDER BY id')
      .all(planSourceId).map(({ id }) => id);
  }

  persistSelections(planSourceId, selections, now = new Date().toISOString()) {
    return this.db.transaction(() => {
      const summary = { created: 0, updated: 0, unchanged: 0, removed: 0 };
      for (const role of ROLES) {
        const image = selections[role];
        const existing = this.db.prepare(`
          SELECT * FROM plan_source_images WHERE plan_source_id = ? AND role = ?
        `).get(planSourceId, role);
        if (!image) {
          if (existing) summary.removed += this.db.prepare('DELETE FROM plan_source_images WHERE id = ?').run(existing.id).changes;
          continue;
        }
        if (!existing) {
          this.db.prepare(`
            INSERT INTO plan_source_images (
              plan_source_id, role, url, ratio, width, height, is_fallback,
              attribution, last_seen_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(planSourceId, role, image.url, image.ratio, image.width, image.height,
            Number(image.isFallback), image.attribution, now, now, now);
          summary.created += 1;
        } else if (sameImage(existing, image)) {
          this.db.prepare('UPDATE plan_source_images SET last_seen_at = ? WHERE id = ?').run(now, existing.id);
          summary.unchanged += 1;
        } else {
          this.db.prepare(`
            UPDATE plan_source_images SET
              url = ?, ratio = ?, width = ?, height = ?, is_fallback = ?,
              attribution = ?, last_seen_at = ?, updated_at = ?
            WHERE id = ?
          `).run(image.url, image.ratio, image.width, image.height, Number(image.isFallback),
            image.attribution, now, now, existing.id);
          summary.updated += 1;
        }
      }
      return summary;
    })();
  }
}
