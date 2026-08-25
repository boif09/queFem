import { canonicalJson } from './plan.repository.js';
import { PlanOccurrenceRepository } from './planOccurrence.repository.js';

const PLAN_COLUMNS = [
  'kind', 'fingerprint', 'original_language', 'original_title', 'original_description',
  'title_ca', 'title_es', 'subtitle_ca', 'subtitle_es', 'description_ca', 'description_es',
  'start_date', 'end_date', 'schedule_text', 'permanent', 'price_text', 'is_free',
  'province', 'comarca', 'municipality', 'locality', 'address', 'postal_code', 'venue_name',
  'latitude', 'longitude', 'website_url', 'ticket_url', 'image_url', 'image_reuse_allowed',
  'family_friendly', 'indoor', 'outdoor', 'recommended_months', 'featured', 'quality_score', 'status',
];
const GEOGRAPHY_COLUMNS = [
  'resolution_status', 'latitude', 'longitude', 'municipality_code', 'municipality_name',
  'comarca_code', 'comarca_name', 'province_code', 'province_name', 'provider', 'dataset',
  'dataset_date', 'layer', 'snapshot_checksum',
];

function fieldsEqual(left, right, fields) {
  return fields.every((field) => left?.[field] === right?.[field]);
}

export class FeverPersistenceRepository {
  constructor(db) {
    this.db = db;
    this.occurrences = new PlanOccurrenceRepository(db);
    this.findSource = db.prepare(`SELECT ps.*, p.fingerprint FROM plan_sources ps
      JOIN plans p ON p.id=ps.plan_id WHERE ps.source_id=? AND ps.source_record_id=?`);
    this.findPlanByFingerprint = db.prepare('SELECT * FROM plans WHERE fingerprint=?');
    this.findPlan = db.prepare('SELECT * FROM plans WHERE id=?');
    this.findGeography = db.prepare('SELECT * FROM plan_source_geography WHERE plan_source_id=?');
    this.sourceCount = db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?');
    this.insertPlan = db.prepare(`INSERT INTO plans (${PLAN_COLUMNS.join(',')},created_at,updated_at)
      VALUES (${PLAN_COLUMNS.map((x) => `@${x}`).join(',')},@created_at,@updated_at)`);
    this.updatePlan = db.prepare(`UPDATE plans SET
      ${PLAN_COLUMNS.filter((x) => x !== 'fingerprint').map((x) => `${x}=@${x}`).join(',')},
      inactive_at=NULL,updated_at=@updated_at WHERE id=@id`);
    this.insertSource = db.prepare(`INSERT INTO plan_sources
      (plan_id,source_id,source_record_id,source_url,source_created_at,source_updated_at,
       source_payload_json,imported_at,last_seen_at)
      VALUES (@plan_id,@source_id,@source_record_id,@source_url,NULL,NULL,@source_payload_json,@now,@now)`);
    this.updateSourceContent = db.prepare(`UPDATE plan_sources SET source_url=@source_url,
      source_payload_json=@source_payload_json,last_seen_at=@now WHERE id=@id`);
    this.touchSource = db.prepare('UPDATE plan_sources SET last_seen_at=? WHERE id=? AND last_seen_at<>?');
    this.insertGeography = db.prepare(`INSERT INTO plan_source_geography (
      plan_source_id,resolution_status,latitude,longitude,municipality_code,municipality_name,
      comarca_code,comarca_name,province_code,province_name,provider,dataset,dataset_date,layer,
      snapshot_checksum,location_basis,created_at,updated_at
    ) VALUES (
      @plan_source_id,@resolution_status,@latitude,@longitude,@municipality_code,@municipality_name,
      @comarca_code,@comarca_name,@province_code,@province_name,@provider,@dataset,@dataset_date,@layer,
      @snapshot_checksum,'event_coordinates',@now,@now
    )`);
    this.updateGeography = db.prepare(`UPDATE plan_source_geography SET
      resolution_status=@resolution_status,latitude=@latitude,longitude=@longitude,
      municipality_code=@municipality_code,municipality_name=@municipality_name,
      comarca_code=@comarca_code,comarca_name=@comarca_name,
      province_code=@province_code,province_name=@province_name,
      provider=@provider,dataset=@dataset,dataset_date=@dataset_date,layer=@layer,
      snapshot_checksum=@snapshot_checksum,location_basis='event_coordinates',updated_at=@now
      WHERE plan_source_id=@plan_source_id`);
    this.allSources = db.prepare('SELECT id source_link_id,plan_id,source_record_id FROM plan_sources WHERE source_id=?');
    this.deleteSource = db.prepare('DELETE FROM plan_sources WHERE id=?');
    this.deactivatePlan = db.prepare("UPDATE plans SET status='inactive',inactive_at=?,updated_at=? WHERE id=?");
    this.keepPlanActive = db.prepare(`UPDATE plans SET status='active',inactive_at=NULL,updated_at=?
      WHERE id=? AND (status<>'active' OR inactive_at IS NOT NULL)`);
  }

  persistProduct(sourceId, candidate, now) {
    const payloadJson = canonicalJson(candidate.sourcePayload);
    let source = this.findSource.get(sourceId, candidate.sourceRecordId);
    let planId;
    let outcome;
    let sharedPreserved = false;
    let planChanged = false;
    let sourceChanged = false;
    let geographyChanged = false;
    let planWrites = 0;
    let sourceWrites = 0;
    let geographyWrites = 0;
    if (source) {
      planId = source.plan_id;
      const sourceCount = this.sourceCount.get(planId).count;
      sharedPreserved = sourceCount > 1;
      const currentPlan = this.findPlan.get(planId);
      planChanged = !sharedPreserved && !fieldsEqual(currentPlan, candidate.plan, PLAN_COLUMNS);
      if (planChanged) planWrites += this.updatePlan.run({ id: planId, ...candidate.plan, updated_at: now }).changes;
      else if (sharedPreserved) planWrites += this.keepPlanActive.run(now, planId).changes;
      sourceChanged = source.source_payload_json !== payloadJson || source.source_url !== candidate.sourceUrl;
      if (sourceChanged) {
        sourceWrites += this.updateSourceContent.run({
          id: source.id, source_url: candidate.sourceUrl, source_payload_json: payloadJson, now,
        }).changes;
      } else sourceWrites += this.touchSource.run(now, source.id, now).changes;
    } else {
      const matchedPlan = this.findPlanByFingerprint.get(candidate.plan.fingerprint);
      if (matchedPlan) {
        planId = matchedPlan.id;
        sharedPreserved = this.sourceCount.get(planId).count > 0;
        planChanged = !sharedPreserved && !fieldsEqual(matchedPlan, candidate.plan, PLAN_COLUMNS);
        if (planChanged) planWrites += this.updatePlan.run({ id: planId, ...candidate.plan, updated_at: now }).changes;
        else if (sharedPreserved) planWrites += this.keepPlanActive.run(now, planId).changes;
        outcome = 'reactivated';
      } else {
        planId = Number(this.insertPlan.run({ ...candidate.plan, created_at: now, updated_at: now }).lastInsertRowid);
        planWrites += 1;
        outcome = 'inserted';
      }
      const result = this.insertSource.run({
        plan_id: planId, source_id: sourceId, source_record_id: candidate.sourceRecordId,
        source_url: candidate.sourceUrl, source_payload_json: payloadJson, now,
      });
      source = { id: Number(result.lastInsertRowid) };
      sourceWrites += 1;
    }
    const currentGeography = this.findGeography.get(source.id);
    geographyChanged = !currentGeography
      || !fieldsEqual(currentGeography, candidate.geography, GEOGRAPHY_COLUMNS);
    if (!currentGeography) {
      geographyWrites += this.insertGeography.run({ plan_source_id: source.id, ...candidate.geography, now }).changes;
    } else if (geographyChanged) {
      geographyWrites += this.updateGeography.run({ plan_source_id: source.id, ...candidate.geography, now }).changes;
    }
    const inactiveKeys = new Set(this.db.prepare(`SELECT occurrence_key FROM plan_occurrences
      WHERE plan_source_id=? AND status='inactive'`).all(source.id).map(({ occurrence_key: key }) => key));
    const occurrenceStats = this.occurrences.reconcile(source.id, candidate.occurrences, { seenAt: now });
    occurrenceStats.reactivated = candidate.occurrences
      .filter(({ occurrenceKey }) => inactiveKeys.has(occurrenceKey)).length;
    occurrenceStats.updated -= occurrenceStats.reactivated;
    const occurrenceChanged = occurrenceStats.inserted + occurrenceStats.updated
      + occurrenceStats.reactivated + occurrenceStats.retired > 0;
    if (!['inserted', 'reactivated'].includes(outcome)) {
      outcome = planChanged || sourceChanged || geographyChanged || occurrenceChanged ? 'updated' : 'unchanged';
    }
    return {
      outcome, planId, planSourceId: source.id, sharedPreserved, occurrenceStats,
      writes: {
        plans: planWrites, sources: sourceWrites, geography: geographyWrites,
        occurrences: occurrenceStats.inserted + occurrenceStats.updated
          + occurrenceStats.reactivated + occurrenceStats.retired,
      },
    };
  }

  retireAbsent(sourceId, desiredIds, now) {
    const rows = this.allSources.all(sourceId).filter((row) => !desiredIds.has(String(row.source_record_id)));
    let plansInactivated = 0;
    let sharedPlansPreserved = 0;
    for (const row of rows) {
      this.deleteSource.run(row.source_link_id);
      if (this.sourceCount.get(row.plan_id).count === 0) {
        plansInactivated += this.deactivatePlan.run(now, now, row.plan_id).changes;
      } else {
        sharedPlansPreserved += 1;
        this.keepPlanActive.run(now, row.plan_id);
      }
    }
    return { sourcesRemoved: rows.length, plansInactivated, sharedPlansPreserved };
  }

  sourceRecordIds(sourceId) {
    return new Set(this.allSources.all(sourceId).map(({ source_record_id: id }) => String(id)));
  }
}
