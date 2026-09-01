import { PlanDeduplicator } from '../../deduplication/planDeduplicator.js';

const PLAN_FIELDS = [
  'kind', 'fingerprint', 'original_language', 'original_title', 'original_description',
  'title_ca', 'title_es', 'subtitle_ca', 'subtitle_es', 'description_ca', 'description_es',
  'start_date', 'end_date', 'schedule_text', 'permanent', 'price_text', 'is_free',
  'province', 'comarca', 'municipality', 'locality', 'address', 'postal_code', 'venue_name',
  'latitude', 'longitude', 'website_url', 'ticket_url', 'image_url', 'image_reuse_allowed',
  'family_friendly', 'indoor', 'outdoor', 'recommended_months', 'featured', 'quality_score', 'status',
];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class PlanRepository {
  constructor(db) {
    this.db = db;
    this.deduplicator = new PlanDeduplicator(db);
    this.findSourceRecord = db.prepare(`
      SELECT * FROM plan_sources WHERE source_id = ? AND source_record_id = ?
    `);
    this.insertPlan = db.prepare(`
      INSERT INTO plans (${PLAN_FIELDS.join(', ')}, created_at, updated_at)
      VALUES (${PLAN_FIELDS.map((field) => `@${field}`).join(', ')}, @created_at, @updated_at)
    `);
    this.updatePlan = db.prepare(`
      UPDATE plans SET
        ${PLAN_FIELDS.filter((field) => field !== 'fingerprint').map((field) => `${field} = @${field}`).join(', ')},
        inactive_at = CASE WHEN @status = 'active' THEN NULL ELSE inactive_at END,
        updated_at = @updated_at
      WHERE id = @id
    `);
    this.fillPlan = db.prepare(`
      UPDATE plans SET
        ${PLAN_FIELDS.filter((field) => !['fingerprint', 'quality_score', 'status'].includes(field)).map((field) => `${field} = COALESCE(${field}, @${field})`).join(', ')},
        status = CASE WHEN status = 'inactive' AND @status = 'active' THEN 'active' ELSE status END,
        inactive_at = CASE WHEN @status = 'active' THEN NULL ELSE inactive_at END,
        quality_score = MAX(quality_score, @quality_score),
        updated_at = @updated_at
      WHERE id = @id
    `);
    this.insertSourceRecord = db.prepare(`
      INSERT INTO plan_sources (
        plan_id, source_id, source_record_id, source_url, source_created_at,
        source_updated_at, source_payload_json, imported_at, last_seen_at
      ) VALUES (
        @plan_id, @source_id, @source_record_id, @source_url, @source_created_at,
        @source_updated_at, @source_payload_json, @imported_at, @last_seen_at
      )
    `);
    this.updateSourceRecord = db.prepare(`
      UPDATE plan_sources SET
        source_url = @source_url,
        source_created_at = @source_created_at,
        source_updated_at = @source_updated_at,
        source_payload_json = @source_payload_json,
        imported_at = @imported_at,
        last_seen_at = @last_seen_at
      WHERE id = @id
    `);
    this.touchSourceRecord = db.prepare(`
      UPDATE plan_sources SET last_seen_at = ?, source_updated_at = ? WHERE id = ?
    `);
    this.reactivatePlan = db.prepare(`
      UPDATE plans
      SET status = 'active', inactive_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'inactive'
    `);
    this.findCategory = db.prepare('SELECT id FROM categories WHERE slug = ?');
    this.linkCategory = db.prepare(`
      INSERT OR IGNORE INTO plan_categories (plan_id, category_id) VALUES (?, ?)
    `);

    this.persistTransaction = db.transaction((entry) => this.persistWithinTransaction(entry));
  }

  persist(entry) {
    return this.persistTransaction(entry);
  }

  persistGroup(entry, sourceRecords) {
    return this.db.transaction(() => {
      let planId = entry.targetPlanId || null;
      let outcome = null;
      for (const [index, sourceRecord] of sourceRecords.entries()) {
        const current = this.persistWithinTransaction({
          ...entry, ...sourceRecord, targetPlanId: planId,
          preserveExistingPlan: entry.preserveExistingPlan || index > 0,
        });
        const linked = this.findSourceRecord.get(entry.sourceId, sourceRecord.sourceRecordId);
        planId = linked.plan_id;
        if (index === 0) outcome = current;
      }
      return { outcome, planId };
    })();
  }

  persistWithinTransaction(entry) {
    const now = new Date().toISOString();
    const sourcePayloadJson = canonicalJson(entry.sourcePayload);
    const existingSourceRecord = this.findSourceRecord.get(entry.sourceId, entry.sourceRecordId);

    if (existingSourceRecord && existingSourceRecord.source_payload_json === sourcePayloadJson && !entry.refreshCanonical) {
      if (!entry.provenanceOnly && entry.plan.status === 'active') this.reactivatePlan.run(now, existingSourceRecord.plan_id);
      this.touchSourceRecord.run(now, entry.sourceUpdatedAt, existingSourceRecord.id);
      return 'skipped';
    }

    let planId;
    let outcome;
    if (existingSourceRecord) {
      planId = existingSourceRecord.plan_id;
      if (!entry.provenanceOnly) {
        if (entry.preserveExistingPlan) this.fillPlan.run({ id: planId, ...entry.plan, updated_at: now });
        else this.updatePlan.run({ id: planId, ...entry.plan, updated_at: now });
      }
      this.updateSourceRecord.run({
        id: existingSourceRecord.id,
        source_url: entry.sourceUrl,
        source_created_at: entry.sourceCreatedAt,
        source_updated_at: entry.sourceUpdatedAt,
        source_payload_json: sourcePayloadJson,
        imported_at: now,
        last_seen_at: now,
      });
      outcome = 'updated';
    } else {
      const duplicate = entry.targetPlanId
        ? this.db.prepare('SELECT * FROM plans WHERE id = ?').get(entry.targetPlanId)
        : this.deduplicator.findByFingerprint(entry.plan.fingerprint);
      if (duplicate) {
        planId = duplicate.id;
        if (!entry.provenanceOnly) this.fillPlan.run({ id: planId, ...entry.plan, updated_at: now });
        outcome = 'updated';
      } else {
        planId = Number(this.insertPlan.run({ ...entry.plan, created_at: now, updated_at: now }).lastInsertRowid);
        outcome = 'inserted';
      }
      this.insertSourceRecord.run({
        plan_id: planId,
        source_id: entry.sourceId,
        source_record_id: entry.sourceRecordId,
        source_url: entry.sourceUrl,
        source_created_at: entry.sourceCreatedAt,
        source_updated_at: entry.sourceUpdatedAt,
        source_payload_json: sourcePayloadJson,
        imported_at: now,
        last_seen_at: now,
      });
    }

    if (!entry.provenanceOnly) {
      for (const slug of entry.categorySlugs) {
        const category = this.findCategory.get(slug);
        if (category) this.linkCategory.run(planId, category.id);
      }
    }
    return outcome;
  }
}
