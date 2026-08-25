const STATUSES = new Set(['active', 'inactive']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} Ã©s obligatori.`);
  return value.trim();
}

function optionalText(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, name);
}

function validDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeOccurrence(occurrence) {
  const localDate = requiredText(occurrence.localDate, 'localDate');
  if (!validDate(localDate)) throw new TypeError('localDate ha de ser una data YYYY-MM-DD vÃ lida.');
  const localTime = optionalText(occurrence.localTime, 'localTime');
  if (localTime && !LOCAL_TIME.test(localTime)) throw new TypeError('localTime ha de tenir format HH:mm o HH:mm:ss.');
  const status = occurrence.status || 'active';
  if (!STATUSES.has(status)) throw new TypeError('status ha de ser active o inactive.');
  const startsAt = optionalText(occurrence.startsAt, 'startsAt');
  const endsAt = optionalText(occurrence.endsAt, 'endsAt');
  if (startsAt && (!ISO_INSTANT.test(startsAt) || Number.isNaN(Date.parse(startsAt)))) {
    throw new TypeError('startsAt ha de ser un instant ISO-8601 amb offset o Z.');
  }
  if (endsAt && (!ISO_INSTANT.test(endsAt) || Number.isNaN(Date.parse(endsAt)))) {
    throw new TypeError('endsAt ha de ser un instant ISO-8601 amb offset o Z.');
  }
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    throw new TypeError('endsAt no pot ser anterior a startsAt.');
  }
  return {
    occurrence_key: requiredText(occurrence.occurrenceKey, 'occurrenceKey'),
    starts_at: startsAt,
    ends_at: endsAt,
    local_date: localDate,
    local_time: localTime,
    timezone: requiredText(occurrence.timezone, 'timezone'),
    status,
  };
}

export class PlanOccurrenceRepository {
  constructor(db) {
    this.db = db;
    this.findByKey = db.prepare(`
      SELECT * FROM plan_occurrences WHERE plan_source_id = ? AND occurrence_key = ?
    `);
    this.insert = db.prepare(`
      INSERT INTO plan_occurrences (
        plan_source_id, occurrence_key, starts_at, ends_at, local_date, local_time,
        timezone, status, last_seen_at, created_at, updated_at
      ) VALUES (
        @plan_source_id, @occurrence_key, @starts_at, @ends_at, @local_date, @local_time,
        @timezone, @status, @last_seen_at, @created_at, @updated_at
      )
    `);
    this.update = db.prepare(`
      UPDATE plan_occurrences SET
        starts_at = @starts_at, ends_at = @ends_at, local_date = @local_date,
        local_time = @local_time, timezone = @timezone, status = @status,
        last_seen_at = @last_seen_at, updated_at = @updated_at
      WHERE id = @id
    `);
    this.touch = db.prepare(`
      UPDATE plan_occurrences SET last_seen_at = ?, updated_at = ? WHERE id = ?
    `);
    this.retire = db.prepare(`
      UPDATE plan_occurrences SET status = 'inactive', updated_at = ? WHERE id = ? AND status = 'active'
    `);
    this.upsertTransaction = db.transaction((planSourceId, occurrence, seenAt) => (
      this.upsertWithinTransaction(planSourceId, occurrence, seenAt)
    ));
    this.upsertManyTransaction = db.transaction((planSourceId, occurrences, seenAt) => (
      occurrences.map((occurrence) => this.upsertWithinTransaction(planSourceId, occurrence, seenAt))
    ));
    this.reconcileTransaction = db.transaction((planSourceId, occurrences, seenAt) => {
      const existing = this.db.prepare(`
        SELECT id, occurrence_key, status FROM plan_occurrences WHERE plan_source_id = ?
      `).all(planSourceId);
      const incomingKeys = new Set();
      const outcomes = [];
      for (const occurrence of occurrences) {
        const normalized = normalizeOccurrence(occurrence);
        if (incomingKeys.has(normalized.occurrence_key)) throw new TypeError('occurrenceKey duplicada al conjunt.');
        incomingKeys.add(normalized.occurrence_key);
        outcomes.push(this.upsertNormalized(planSourceId, normalized, seenAt));
      }
      let retired = 0;
      for (const row of existing) {
        if (!incomingKeys.has(row.occurrence_key)) retired += this.retire.run(seenAt, row.id).changes;
      }
      return {
        inserted: outcomes.filter((outcome) => outcome === 'inserted').length,
        updated: outcomes.filter((outcome) => outcome === 'updated').length,
        unchanged: outcomes.filter((outcome) => outcome === 'unchanged').length,
        retired,
      };
    });
  }

  upsert(planSourceId, occurrence, { seenAt = new Date().toISOString() } = {}) {
    return this.upsertTransaction(planSourceId, occurrence, seenAt);
  }

  upsertMany(planSourceId, occurrences, { seenAt = new Date().toISOString() } = {}) {
    if (!Array.isArray(occurrences)) throw new TypeError('occurrences ha de ser una llista.');
    return this.upsertManyTransaction(planSourceId, occurrences, seenAt);
  }

  reconcile(planSourceId, occurrences, { seenAt = new Date().toISOString() } = {}) {
    if (!Array.isArray(occurrences)) throw new TypeError('occurrences ha de ser una llista.');
    return this.reconcileTransaction(planSourceId, occurrences, seenAt);
  }

  upsertWithinTransaction(planSourceId, occurrence, seenAt) {
    return this.upsertNormalized(planSourceId, normalizeOccurrence(occurrence), seenAt);
  }

  upsertNormalized(planSourceId, occurrence, seenAt) {
    const existing = this.findByKey.get(planSourceId, occurrence.occurrence_key);
    const values = { ...occurrence, plan_source_id: planSourceId, last_seen_at: seenAt, updated_at: seenAt };
    if (!existing) {
      this.insert.run({ ...values, created_at: seenAt });
      return 'inserted';
    }
    const unchanged = ['starts_at', 'ends_at', 'local_date', 'local_time', 'timezone', 'status']
      .every((field) => existing[field] === occurrence[field]);
    if (unchanged) {
      this.touch.run(seenAt, seenAt, existing.id);
      return 'unchanged';
    }
    this.update.run({ ...values, id: existing.id });
    return 'updated';
  }

  hasActiveForPlanSource(planSourceId) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM plan_occurrences
      WHERE plan_source_id = ? AND status = 'active' LIMIT 1
    `).get(planSourceId));
  }

  hasActiveForPlan(planId) {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM plan_sources ps
      JOIN plan_occurrences occurrence ON occurrence.plan_source_id = ps.id
      WHERE ps.plan_id = ? AND occurrence.status = 'active' LIMIT 1
    `).get(planId));
  }

  findUpcomingForPlanSource(planSourceId, fromDate, { limit = 20 } = {}) {
    if (!validDate(fromDate)) throw new TypeError('fromDate ha de ser una data YYYY-MM-DD vÃ lida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit ha dâ€™estar entre 1 i 500.');
    return this.db.prepare(`
      SELECT * FROM plan_occurrences
      WHERE plan_source_id = ? AND status = 'active' AND local_date >= ?
      ORDER BY local_date, COALESCE(local_time, ''), id
      LIMIT ?
    `).all(planSourceId, fromDate, limit);
  }

  findUpcomingForPlan(planId, fromDate, { limit = 20 } = {}) {
    if (!validDate(fromDate)) throw new TypeError('fromDate ha de ser una data YYYY-MM-DD vÃ lida.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit ha dâ€™estar entre 1 i 500.');
    return this.db.prepare(`
      SELECT occurrence.*
      FROM plan_sources ps
      JOIN plan_occurrences occurrence ON occurrence.plan_source_id = ps.id
      WHERE ps.plan_id = ? AND occurrence.status = 'active' AND occurrence.local_date >= ?
      ORDER BY occurrence.local_date, COALESCE(occurrence.local_time, ''), occurrence.id
      LIMIT ?
    `).all(planId, fromDate, limit);
  }
}
