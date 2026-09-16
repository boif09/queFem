const ROLES = ['card', 'detail'];

function sameImage(row, image) {
  return row.url === image.url
    && row.ratio === image.ratio
    && row.width === image.width
    && row.height === image.height
    && row.is_fallback === Number(image.isFallback)
    && row.attribution === image.attribution
    && row.attribution_known === Number(image.attributionKnown ?? true);
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
        AND (s.key <> 'gencat-agenda' OR s.allows_images = 1)
        AND psi.attribution_known = 1
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

  findResolutionBySourceRecord(sourceId, sourceRecordId) {
    return this.db.prepare(`
      SELECT psi.*,
        (SELECT COUNT(*) FROM plan_source_images state_psi
          WHERE state_psi.plan_source_id = psi.plan_source_id) role_count
      FROM plan_source_images psi
      JOIN plan_sources ps ON ps.id = psi.plan_source_id
      WHERE ps.source_id = ? AND ps.source_record_id = ?
      ORDER BY CASE psi.role WHEN 'card' THEN 0 ELSE 1 END
      LIMIT 1
    `).get(sourceId, sourceRecordId) || null;
  }

  findGencatHistoricalImageStates(sourceId, sourceRecordIds, cutoff) {
    const uniqueIds = [...new Set(sourceRecordIds)];
    const rows = [];
    // SQLite reserves some bind parameters internally. Keep this comfortably
    // below its default limit while still avoiding a query per source record.
    const batchSize = 900;
    for (let index = 0; index < uniqueIds.length; index += batchSize) {
      const ids = uniqueIds.slice(index, index + batchSize);
      if (!ids.length) continue;
      rows.push(...this.db.prepare(`
        SELECT
          ps.source_record_id,
          p.status,
          p.start_date,
          p.end_date,
          p.permanent,
          image.url AS image_url,
          image.attribution_known AS attribution_known,
          image.updated_at AS image_updated_at,
          EXISTS (
            SELECT 1
            FROM plan_sources visibility_ps
            JOIN sources visibility_s ON visibility_s.id = visibility_ps.source_id
            WHERE visibility_ps.plan_id = p.id AND visibility_s.enabled = 1
          ) AS has_enabled_source,
          EXISTS (
            SELECT 1
            FROM plan_sources occurrence_ps
            JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
            JOIN sources occurrence_s ON occurrence_s.id = occurrence_ps.source_id
            WHERE occurrence_ps.plan_id = p.id AND occurrence_s.enabled = 1
          ) AS has_enabled_occurrence_history,
          (
            SELECT MIN(occurrence_o.local_date)
            FROM plan_sources occurrence_ps
            JOIN plan_occurrences occurrence_o ON occurrence_o.plan_source_id = occurrence_ps.id
            JOIN sources occurrence_s ON occurrence_s.id = occurrence_ps.source_id
            WHERE occurrence_ps.plan_id = p.id
              AND occurrence_s.enabled = 1
              AND occurrence_o.status = 'active'
              AND occurrence_o.local_date >= ?
          ) AS next_active_occurrence
        FROM plan_sources ps
        JOIN plans p ON p.id = ps.plan_id
        LEFT JOIN plan_source_images image ON image.id = (
          SELECT state_image.id
          FROM plan_source_images state_image
          WHERE state_image.plan_source_id = ps.id
          ORDER BY CASE state_image.role WHEN 'card' THEN 0 ELSE 1 END
          LIMIT 1
        )
        WHERE ps.source_id = ? AND ps.source_record_id IN (${ids.map(() => '?').join(', ')})
      `).all(cutoff, sourceId, ...ids));
    }
    return new Map(rows.map((row) => [row.source_record_id, row]));
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
              attribution, attribution_known, last_seen_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(planSourceId, role, image.url, image.ratio, image.width, image.height,
            Number(image.isFallback), image.attribution, Number(image.attributionKnown ?? true), now, now, now);
          summary.created += 1;
        } else if (sameImage(existing, image)) {
          const timestampColumn = image.attributionKnown === false ? 'last_seen_at = ?, updated_at = ?' : 'last_seen_at = ?';
          const parameters = image.attributionKnown === false ? [now, now, existing.id] : [now, existing.id];
          this.db.prepare(`UPDATE plan_source_images SET ${timestampColumn} WHERE id = ?`).run(...parameters);
          summary.unchanged += 1;
        } else {
          this.db.prepare(`
            UPDATE plan_source_images SET
              url = ?, ratio = ?, width = ?, height = ?, is_fallback = ?,
              attribution = ?, attribution_known = ?, last_seen_at = ?, updated_at = ?
            WHERE id = ?
          `).run(image.url, image.ratio, image.width, image.height, Number(image.isFallback),
            image.attribution, Number(image.attributionKnown ?? true), now, now, existing.id);
          summary.updated += 1;
        }
      }
      return summary;
    })();
  }
}
