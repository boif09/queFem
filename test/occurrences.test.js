import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { PlanOccurrenceRepository } from '../backend/src/db/repositories/planOccurrence.repository.js';
import { PlanQueryRepository } from '../backend/src/db/repositories/planQuery.repository.js';
import { purgeExpiredPlans } from '../backend/src/retention/eventRetention.js';
import { purgeTemporallyInvalidPlans } from '../backend/src/quality/temporalCoherence.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const IMPORTED_AT = '2026-08-25T10:00:00.000Z';

function insertPlan(db, key, startDate, endDate, { permanent = 0, quality = 80 } = {}) {
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, title_ca,
      start_date, end_date, permanent, province, comarca, municipality,
      quality_score, status, created_at, updated_at
    ) VALUES ('event', ?, 'ca', ?, ?, ?, ?, ?, 'Barcelona', 'Barcelones',
      'Barcelona', ?, 'active', ?, ?)
  `).run(key, key, key, startDate, endDate, permanent, quality, IMPORTED_AT, IMPORTED_AT).lastInsertRowid);
}

function insertSource(db, planId, recordId, sourceKey = 'gencat-agenda') {
  const sourceId = db.prepare('SELECT id FROM sources WHERE key = ?').get(sourceKey).id;
  return Number(db.prepare(`
    INSERT INTO plan_sources (
      plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
    ) VALUES (?, ?, ?, '{}', ?, ?)
  `).run(planId, sourceId, recordId, IMPORTED_AT, IMPORTED_AT).lastInsertRowid);
}

function occurrence(key, localDate, localTime = '10:00', overrides = {}) {
  return {
    occurrenceKey: key,
    startsAt: `${localDate}T${localTime}:00+02:00`,
    endsAt: null,
    localDate,
    localTime,
    timezone: 'Europe/Madrid',
    status: 'active',
    ...overrides,
  };
}

function appFor(db) {
  return createApp({
    db, defaultLanguage: 'ca', eventRetentionDays: 0, now: () => NOW,
    logger: { error() {} },
  });
}

test('occurrence repository upserts one or many sessions idempotently and preserves local time', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'repository-plan', '2026-08-25', '2026-08-25');
    const planSourceId = insertSource(db, planId, 'repository-source');
    const repository = new PlanOccurrenceRepository(db);
    assert.equal(repository.upsert(planSourceId, occurrence('morning', '2026-08-25'), { seenAt: IMPORTED_AT }), 'inserted');
    assert.deepEqual(repository.upsertMany(planSourceId, [
      occurrence('noon', '2026-08-25', '12:00'),
      occurrence('future', '2026-08-28', '18:30'),
    ], { seenAt: IMPORTED_AT }), ['inserted', 'inserted']);
    assert.equal(repository.upsert(planSourceId, occurrence('morning', '2026-08-25'), { seenAt: IMPORTED_AT }), 'unchanged');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences').get().count, 3);
    assert.deepEqual(repository.findUpcomingForPlanSource(planSourceId, '2026-08-25').map(({ occurrence_key: key, local_time: time }) => [key, time]), [
      ['morning', '10:00'], ['noon', '12:00'], ['future', '18:30'],
    ]);
    assert.deepEqual(repository.findUpcomingForPlan(planId, '2026-08-26').map(({ occurrence_key: key }) => key), ['future']);
    assert.equal(repository.hasActiveForPlanSource(planSourceId), true);
    assert.equal(repository.hasActiveForPlan(planId), true);
  });
});

test('occurrence repository reconciles sets, retires missing sessions and reactivates them', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'reconcile-plan', '2026-08-25', '2026-08-28');
    const planSourceId = insertSource(db, planId, 'reconcile-source');
    const repository = new PlanOccurrenceRepository(db);
    assert.deepEqual(repository.reconcile(planSourceId, [
      occurrence('keep', '2026-08-25'), occurrence('remove', '2026-08-28'),
    ], { seenAt: '2026-08-25T10:00:00Z' }), { inserted: 2, updated: 0, unchanged: 0, retired: 0 });
    assert.deepEqual(repository.reconcile(planSourceId, [occurrence('keep', '2026-08-25')], {
      seenAt: '2026-08-26T10:00:00Z',
    }), { inserted: 0, updated: 0, unchanged: 1, retired: 1 });
    assert.equal(db.prepare("SELECT status FROM plan_occurrences WHERE occurrence_key = 'remove'").get().status, 'inactive');
    assert.deepEqual(repository.reconcile(planSourceId, [
      occurrence('keep', '2026-08-25'), occurrence('remove', '2026-08-29'),
    ], { seenAt: '2026-08-27T10:00:00Z' }), { inserted: 0, updated: 1, unchanged: 1, retired: 0 });
    assert.deepEqual(db.prepare("SELECT status, local_date FROM plan_occurrences WHERE occurrence_key = 'remove'").get(), {
      status: 'active', local_date: '2026-08-29',
    });
    assert.throws(() => repository.reconcile(planSourceId, [occurrence('same', '2026-08-25'), occurrence('same', '2026-08-26')]), /duplicada/);
  });
});

test('date-only occurrences remain nullable, idempotent and reactivate with a stable opaque key', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'date-only-plan', '2026-08-25', '2026-08-25');
    const planSourceId = insertSource(db, planId, 'date-only-source');
    const repository = new PlanOccurrenceRepository(db);
    const dateOnly = occurrence('native-session-id', '2026-08-25', '10:00', {
      startsAt: null, localTime: null,
    });
    assert.equal(repository.upsert(planSourceId, dateOnly, { seenAt: IMPORTED_AT }), 'inserted');
    assert.equal(repository.upsert(planSourceId, dateOnly, { seenAt: IMPORTED_AT }), 'unchanged');
    assert.deepEqual(repository.reconcile(planSourceId, [dateOnly], { seenAt: '2026-08-26T10:00:00Z' }), {
      inserted: 0, updated: 0, unchanged: 1, retired: 0,
    });
    assert.deepEqual(db.prepare(`
      SELECT occurrence_key, starts_at, local_time, local_date, status
      FROM plan_occurrences WHERE plan_source_id = ?
    `).get(planSourceId), {
      occurrence_key: 'native-session-id', starts_at: null, local_time: null,
      local_date: '2026-08-25', status: 'active',
    });
    assert.deepEqual(repository.reconcile(planSourceId, [], { seenAt: '2026-08-27T10:00:00Z' }), {
      inserted: 0, updated: 0, unchanged: 0, retired: 1,
    });
    const corrected = { ...dateOnly, localDate: '2026-08-26' };
    assert.deepEqual(repository.reconcile(planSourceId, [corrected], { seenAt: '2026-08-28T10:00:00Z' }), {
      inserted: 0, updated: 1, unchanged: 0, retired: 0,
    });
    assert.deepEqual(db.prepare(`
      SELECT occurrence_key, starts_at, local_time, local_date, status
      FROM plan_occurrences WHERE plan_source_id = ?
    `).get(planSourceId), {
      occurrence_key: 'native-session-id', starts_at: null, local_time: null,
      local_date: '2026-08-26', status: 'active',
    });
  });
});

test('occurrence repository handles more than 1500 sessions transactionally', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'large-plan', '2026-08-25', '2030-12-31');
    const planSourceId = insertSource(db, planId, 'large-source');
    const repository = new PlanOccurrenceRepository(db);
    const sessions = Array.from({ length: 1501 }, (_, index) => {
      const date = new Date('2026-08-25T00:00:00.000Z');
      date.setUTCDate(date.getUTCDate() + index);
      return occurrence(`session-${index}`, date.toISOString().slice(0, 10));
    });
    const result = repository.reconcile(planSourceId, sessions, { seenAt: IMPORTED_AT });
    assert.deepEqual(result, { inserted: 1501, updated: 0, unchanged: 0, retired: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences WHERE plan_source_id = ?').get(planSourceId).count, 1501);
    const second = repository.reconcile(planSourceId, sessions, { seenAt: IMPORTED_AT });
    assert.deepEqual(second, { inserted: 0, updated: 0, unchanged: 1501, retired: 0 });
  });
});

test('foreign key, uniqueness and cascade keep occurrences scoped to their plan source', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'cascade-plan', '2026-08-25', '2026-08-25');
    const sourceOne = insertSource(db, planId, 'cascade-one');
    const sourceTwo = insertSource(db, planId, 'cascade-two', 'ticketmaster-discovery-feed');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(sourceOne, occurrence('shared-key', '2026-08-25'));
    repository.upsert(sourceTwo, occurrence('shared-key', '2026-08-26'));
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences').get().count, 2);
    assert.throws(() => db.prepare(`
      INSERT INTO plan_occurrences (
        plan_source_id, occurrence_key, starts_at, local_date, timezone,
        status, last_seen_at, created_at, updated_at
      ) VALUES (?, 'shared-key', '2026-08-25T10:00:00+02:00', '2026-08-25',
        'Europe/Madrid', 'active', ?, ?, ?)
    `).run(sourceOne, IMPORTED_AT, IMPORTED_AT, IMPORTED_AT), /UNIQUE/);
    assert.throws(() => repository.upsert(999999, occurrence('orphan', '2026-08-25')), /FOREIGN KEY/);
    db.prepare('DELETE FROM plan_sources WHERE id = ?').run(sourceOne);
    assert.deepEqual(db.prepare('SELECT plan_source_id FROM plan_occurrences').all(), [{ plan_source_id: sourceTwo }]);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(planId));
  });
});

test('local_date remains the explicit event day around midnight and DST changes', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'timezone-plan', '2026-03-29', '2026-10-25');
    const planSourceId = insertSource(db, planId, 'timezone-source');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsertMany(planSourceId, [
      occurrence('spring-midnight', '2026-03-29', '00:30', { startsAt: '2026-03-28T23:30:00Z' }),
      occurrence('autumn-midnight', '2026-10-25', '00:30', { startsAt: '2026-10-24T22:30:00Z' }),
    ]);
    assert.deepEqual(db.prepare(`
      SELECT occurrence_key, starts_at, local_date, timezone
      FROM plan_occurrences ORDER BY occurrence_key
    `).all(), [
      { occurrence_key: 'autumn-midnight', starts_at: '2026-10-24T22:30:00Z', local_date: '2026-10-25', timezone: 'Europe/Madrid' },
      { occurrence_key: 'spring-midnight', starts_at: '2026-03-28T23:30:00Z', local_date: '2026-03-29', timezone: 'Europe/Madrid' },
    ]);
  });
});

test('empty occurrences preserve legacy today, tomorrow, range and upcoming semantics exactly', async () => {
  await withTestDatabase(async (db) => {
    insertPlan(db, 'legacy-spanning', '2026-08-24', '2026-08-29');
    insertPlan(db, 'legacy-tomorrow', '2026-08-26', '2026-08-26');
    insertPlan(db, 'legacy-future', '2026-09-01', '2026-09-01');
    insertPlan(db, 'legacy-old', '2026-08-20', '2026-08-20');
    const app = appFor(db);
    const cases = [
      ['/api/plans?date=2026-08-25&limit=100', `start_date <= '2026-08-25' AND end_date >= '2026-08-25'`],
      ['/api/plans?date=2026-08-26&limit=100', `start_date <= '2026-08-26' AND end_date >= '2026-08-26'`],
      ['/api/plans?dateFrom=2026-08-28&dateTo=2026-08-30&limit=100', `start_date <= '2026-08-30' AND end_date >= '2026-08-28'`],
    ];
    for (const [url, legacyWhere] of cases) {
      const expected = db.prepare(`
        SELECT id FROM plans WHERE status = 'active' AND quality_score >= 35 AND (${legacyWhere}) ORDER BY id
      `).all().map(({ id }) => id);
      const response = await request(app).get(url);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.data.map(({ id }) => id).sort((a, b) => a - b), expected);
    }
    const expectedUpcoming = db.prepare(`
      SELECT id FROM plans WHERE status = 'active' AND quality_score >= 35
        AND start_date >= '2026-08-25' ORDER BY start_date, id
    `).all().map(({ id }) => id);
    const upcoming = await request(app).get('/api/plans?editorial=home-upcoming&dateFrom=2026-08-25&permanent=false&limit=100');
    assert.deepEqual(upcoming.body.data.map(({ id }) => id), expectedUpcoming);
  });
});

test('active occurrences are temporal truth for exact days, ranges and weekend without duplicate plans', async () => {
  await withTestDatabase(async (db) => {
    const planId = insertPlan(db, 'recurrent-past-start', '2026-06-01', '2026-06-30');
    const planSourceId = insertSource(db, planId, 'recurrent-source');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsertMany(planSourceId, [
      occurrence('today-a', '2026-08-25', '10:00'), occurrence('today-b', '2026-08-25', '12:00'),
      occurrence('tomorrow', '2026-08-26'), occurrence('weekend', '2026-08-29'),
      occurrence('inactive-range', '2026-08-27', '10:00', { status: 'inactive' }),
    ]);
    const app = appFor(db);
    for (const url of [
      '/api/plans?date=2026-08-25&limit=100',
      '/api/plans?date=2026-08-26&limit=100',
      '/api/plans?dateFrom=2026-08-28&dateTo=2026-08-30&limit=100',
      '/api/plans?editorial=home-weekend&dateFrom=2026-08-28&dateTo=2026-08-30&permanent=false&limit=100',
    ]) {
      const response = await request(app).get(url);
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.data.filter(({ id }) => id === planId).map(({ id }) => id), [planId]);
    }
    const missing = await request(app).get('/api/plans?date=2026-08-27&limit=100');
    assert.equal(missing.body.data.some(({ id }) => id === planId), false);
  });
});

test('upcoming orders recurrent plans by next active occurrence and legacy plans by start_date', async () => {
  await withTestDatabase(async (db) => {
    const recurrentFirst = insertPlan(db, 'recurrent-first', '2026-01-01', '2026-01-02');
    const recurrentLater = insertPlan(db, 'recurrent-later', '2026-01-01', '2026-01-02');
    const legacyMiddle = insertPlan(db, 'legacy-middle', '2026-08-27', '2026-08-27');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(insertSource(db, recurrentFirst, 'recurrent-first-source'), occurrence('next', '2026-08-26'));
    repository.upsert(insertSource(db, recurrentLater, 'recurrent-later-source'), occurrence('next', '2026-08-28'));
    const response = await request(appFor(db)).get('/api/plans?editorial=home-upcoming&dateFrom=2026-08-25&permanent=false&limit=100');
    assert.deepEqual(response.body.data.map(({ id }) => id), [recurrentFirst, legacyMiddle, recurrentLater]);
  });
});

test('occurrence-aware plans with only inactive history never fall back to legacy intervals', async () => {
  await withTestDatabase(async (db) => {
    const fallback = insertPlan(db, 'inactive-no-fallback', '2026-08-25', '2026-09-30');
    const oldOnly = insertPlan(db, 'active-old-truth', '2026-08-25', '2027-01-01');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(insertSource(db, fallback, 'inactive-no-fallback-source'), occurrence('inactive', '2026-09-01', '10:00', { status: 'inactive' }));
    repository.upsert(insertSource(db, oldOnly, 'active-old-source'), occurrence('old', '2026-08-20'));
    for (const url of [
      '/api/plans?date=2026-08-25&limit=100',
      '/api/plans?date=2026-08-26&limit=100',
      '/api/plans?dateFrom=2026-08-25&dateTo=2026-08-30&limit=100',
      '/api/plans?editorial=home-weekend&dateFrom=2026-08-28&dateTo=2026-08-30&permanent=false&limit=100',
      '/api/plans?editorial=home-upcoming&dateFrom=2026-08-25&permanent=false&limit=100',
    ]) {
      const response = await request(appFor(db)).get(url);
      assert.equal(response.body.data.some(({ id }) => id === fallback), false);
      assert.equal(response.body.data.some(({ id }) => id === oldOnly), false);
    }
  });
});

test('removing the occurrence-aware source cascades history and restores legacy semantics', async () => {
  await withTestDatabase(async (db) => {
    const planId = insertPlan(db, 'cascade-restores-legacy', '2026-08-25', '2026-08-26');
    const occurrenceSource = insertSource(db, planId, 'aware-source');
    insertSource(db, planId, 'remaining-legacy-source', 'ticketmaster-discovery-feed');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(occurrenceSource, occurrence('inactive', '2026-08-20', '10:00', { status: 'inactive' }));
    const app = appFor(db);
    assert.equal((await request(app).get('/api/plans?date=2026-08-25')).body.data.some(({ id }) => id === planId), false);
    db.prepare('DELETE FROM plan_sources WHERE id = ?').run(occurrenceSource);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences').get().count, 0);
    assert.equal((await request(app).get('/api/plans?date=2026-08-25')).body.data.some(({ id }) => id === planId), true);
  });
});

test('mixed general, quality, upcoming and weekend ordering uses occurrences without reviving inactive history', async () => {
  await withTestDatabase(async (db) => {
    const recurrent = insertPlan(db, 'mixed-recurrent', '2026-01-01', '2026-01-02');
    const legacy = insertPlan(db, 'mixed-legacy', '2026-08-27', '2026-08-29');
    const inactive = insertPlan(db, 'mixed-inactive', '2026-08-25', '2026-09-30');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(insertSource(db, recurrent, 'mixed-recurrent-source'), occurrence('next', '2026-08-26'));
    repository.upsert(insertSource(db, inactive, 'mixed-inactive-source'), occurrence('gone', '2026-09-01', '10:00', { status: 'inactive' }));
    const app = appFor(db);
    const upcoming = await request(app).get('/api/plans?editorial=home-upcoming&dateFrom=2026-08-25&permanent=false&limit=100');
    assert.deepEqual(upcoming.body.data.map(({ id }) => id), [recurrent, legacy]);
    const weekend = await request(app).get('/api/plans?editorial=home-weekend&dateFrom=2026-08-28&dateTo=2026-08-30&permanent=false&limit=100');
    assert.deepEqual(weekend.body.data.map(({ id }) => id), [legacy]);
    const general = await request(app).get('/api/plans?sort=date&limit=100');
    assert.deepEqual(general.body.data.map(({ id }) => id), [recurrent, legacy]);
    const quality = await request(app).get('/api/plans?sort=quality&limit=100');
    assert.deepEqual(quality.body.data.map(({ id }) => id), [recurrent, legacy]);
  });
});

test('occurrences from two sources are combined without cross-source reconciliation', async () => {
  await withTestDatabase(async (db) => {
    const planId = insertPlan(db, 'multisource-plan', '2026-01-01', '2026-01-02');
    const sourceOne = insertSource(db, planId, 'multi-one');
    const sourceTwo = insertSource(db, planId, 'multi-two', 'ticketmaster-discovery-feed');
    const repository = new PlanOccurrenceRepository(db);
    repository.reconcile(sourceOne, [occurrence('one', '2026-08-25')]);
    repository.reconcile(sourceTwo, [occurrence('two', '2026-08-26')]);
    repository.reconcile(sourceOne, []);
    assert.equal(db.prepare("SELECT status FROM plan_occurrences WHERE plan_source_id = ?").get(sourceOne).status, 'inactive');
    const tomorrow = await request(appFor(db)).get('/api/plans?date=2026-08-26&limit=100');
    assert.deepEqual(tomorrow.body.data.filter(({ id }) => id === planId).map(({ id }) => id), [planId]);
    db.prepare('DELETE FROM plan_sources WHERE id = ?').run(sourceTwo);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(planId));
    assert.equal(db.prepare('SELECT status FROM plans WHERE id = ?').get(planId).status, 'active');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences WHERE plan_source_id = ?').get(sourceTwo).count, 0);
  });
});

test('retention uses active occurrence dates and protects a recurrent plan with a future session', () => {
  withTestDatabase((db) => {
    const futurePlan = insertPlan(db, 'retention-future', '2024-01-01', '2024-01-02');
    const oldPlan = insertPlan(db, 'retention-old', '2026-08-25', '2027-01-01');
    const invalidSummaryPlan = insertPlan(db, 'retention-invalid-summary', '2924-01-01', '2924-01-02');
    const inactiveInvalidSummary = insertPlan(db, 'retention-inactive-invalid-summary', '2924-01-01', '2924-01-02');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(insertSource(db, futurePlan, 'retention-future-source'), occurrence('future', '2026-08-26'));
    repository.upsert(insertSource(db, oldPlan, 'retention-old-source'), occurrence('old', '2026-08-20'));
    repository.upsert(insertSource(db, invalidSummaryPlan, 'retention-invalid-source'), occurrence('valid-future', '2026-08-27'));
    repository.upsert(insertSource(db, inactiveInvalidSummary, 'retention-inactive-invalid-source'), occurrence('known-past', '2026-08-20', '10:00', { status: 'inactive' }));
    const temporal = purgeTemporallyInvalidPlans(db, { now: NOW });
    assert.equal(temporal.plans, 0);
    const expired = purgeExpiredPlans(db, { retentionDays: 0, now: NOW });
    assert.equal(expired.plans, 2);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(futurePlan));
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(oldPlan), undefined);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(invalidSummaryPlan));
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(inactiveInvalidSummary), undefined);
  });
});

test('retention separates legacy, active, inactive history and multiple sources', () => {
  withTestDatabase((db) => {
    const legacyFuture = insertPlan(db, 'retention-legacy', '2026-08-26', '2026-08-26');
    const activeFuture = insertPlan(db, 'retention-active', '2024-01-01', '2024-01-02');
    const inactivePast = insertPlan(db, 'retention-inactive', '2026-08-25', '2027-01-01');
    const mixedSources = insertPlan(db, 'retention-mixed', '2024-01-01', '2024-01-02');
    const repository = new PlanOccurrenceRepository(db);
    repository.upsert(insertSource(db, activeFuture, 'retention-active-source'), occurrence('future', '2026-08-26'));
    repository.upsert(insertSource(db, inactivePast, 'retention-inactive-source'), occurrence('past', '2026-08-20', '10:00', { status: 'inactive' }));
    repository.upsert(insertSource(db, mixedSources, 'retention-mixed-active'), occurrence('active', '2026-08-27'));
    repository.upsert(insertSource(db, mixedSources, 'retention-mixed-inactive', 'ticketmaster-discovery-feed'), occurrence('inactive-later', '2027-01-01', '10:00', { status: 'inactive' }));
    const result = purgeExpiredPlans(db, { retentionDays: 0, now: NOW });
    assert.equal(result.plans, 1);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(legacyFuture));
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(activeFuture));
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(inactivePast), undefined);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(mixedSources));
  });
});

test('critical occurrence lookup uses the source/date index', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, 'explain-plan', '2026-01-01', '2026-01-02');
    const sourceId = insertSource(db, planId, 'explain-source');
    const detail = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT 1 FROM plan_occurrences
      WHERE plan_source_id = ? AND status = 'active' AND local_date >= ? LIMIT 1
    `).all(sourceId, '2026-08-25').map(({ detail: value }) => value).join('\n');
    assert.match(detail, /idx_plan_occurrences_source_date/);
  });
});

test('representative plan range query keeps occurrence subqueries indexed', () => {
  withTestDatabase((db) => {
    insertPlan(db, 'explain-legacy', '2026-08-25', '2026-08-30');
    const recurrent = insertPlan(db, 'explain-recurrent', '2026-01-01', '2026-01-02');
    const inactive = insertPlan(db, 'explain-inactive', '2026-08-25', '2026-09-30');
    const occurrenceRepository = new PlanOccurrenceRepository(db);
    occurrenceRepository.upsertMany(insertSource(db, recurrent, 'explain-recurrent-source'), [
      occurrence('first', '2026-08-26'), occurrence('second', '2026-08-29'),
    ]);
    occurrenceRepository.upsert(insertSource(db, inactive, 'explain-inactive-source'),
      occurrence('inactive', '2026-08-28', '10:00', { status: 'inactive' }));
    const queryRepository = new PlanQueryRepository(db, { eventRetentionDays: 0, now: () => NOW });
    const where = queryRepository.buildWhere({ dateFrom: '2026-08-25', dateTo: '2026-08-30' });
    const details = db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM plans p WHERE ${where.sql}`)
      .all(...where.parameters).map(({ detail }) => detail);
    assert.ok(details.some((detail) => /(?:SCAN|SEARCH) p\b/.test(detail)));
    assert.ok(details.some((detail) => detail.includes('idx_plan_sources_plan')));
    assert.ok(details.some((detail) => detail.includes('idx_plan_occurrences_source_date')));
    assert.equal(details.some((detail) => /SCAN (?:occurrence_o|plan_occurrences)/.test(detail)), false);
  });
});
