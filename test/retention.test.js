import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../backend/src/config.js';
import {
  isPlanRetained,
  purgeExpiredPlans,
  retentionCutoff,
} from '../backend/src/retention/eventRetention.js';
import { withTestDatabase } from './helpers.js';

function insertPlan(db, { fingerprint, startDate, endDate, permanent = 0 }) {
  const result = db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_title, start_date, end_date, permanent,
      quality_score, status, created_at, updated_at
    ) VALUES ('event', ?, ?, ?, ?, ?, 70, 'active', ?, ?)
  `).run(
    fingerprint,
    fingerprint,
    startDate,
    endDate,
    permanent,
    '2026-08-17T10:00:00.000Z',
    '2026-08-17T10:00:00.000Z',
  );
  return Number(result.lastInsertRowid);
}

test('uses no retention by default and calculates cutoffs using the Catalonia calendar date', () => {
  assert.equal(retentionCutoff(90, new Date('2026-08-17T12:00:00.000Z')), '2026-05-19');
  assert.equal(retentionCutoff(0, new Date('2026-08-17T12:00:00.000Z')), '2026-08-17');
  assert.equal(loadConfig({}).eventRetentionDays, 0);
  assert.equal(loadConfig({ EVENT_RETENTION_DAYS: '0' }).eventRetentionDays, 0);
  assert.throws(() => retentionCutoff(-1), /enter no negatiu/);
});

test('retains cutoff-day, undated and permanent plans', () => {
  assert.equal(isPlanRetained({ permanent: 0, end_date: '2026-05-18' }, '2026-05-19'), false);
  assert.equal(isPlanRetained({ permanent: 0, end_date: '2026-05-19' }, '2026-05-19'), true);
  assert.equal(isPlanRetained({ permanent: 0, start_date: null, end_date: null }, '2026-05-19'), true);
  assert.equal(isPlanRetained({ permanent: 1, end_date: '2020-01-01' }, '2026-05-19'), true);
});

test('purges only expired events and removes their dependent records atomically', () => {
  withTestDatabase((db) => {
    const expiredId = insertPlan(db, {
      fingerprint: 'expired', startDate: '2020-01-01', endDate: '2020-01-02',
    });
    const retainedId = insertPlan(db, {
      fingerprint: 'cutoff', startDate: '2026-08-16', endDate: '2026-08-17',
    });
    const permanentId = insertPlan(db, {
      fingerprint: 'permanent', startDate: '2020-01-01', endDate: '2020-01-02', permanent: 1,
    });
    const sourceId = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get().id;
    db.prepare(`
      INSERT INTO plan_sources (
        plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
      ) VALUES (?, ?, 'expired-source', '{}', ?, ?)
    `).run(expiredId, sourceId, '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');
    db.prepare(`
      INSERT INTO plan_categories (plan_id, category_id)
      SELECT ?, id FROM categories WHERE slug = 'cultura'
    `).run(expiredId);

    const summary = purgeExpiredPlans(db, {
      retentionDays: 0,
      now: new Date('2026-08-17T12:00:00.000Z'),
    });

    assert.deepEqual(summary, {
      cutoff: '2026-08-17', plans: 1, planSources: 1, planCategories: 1,
    });
    assert.deepEqual(
      db.prepare('SELECT id FROM plans ORDER BY id').all().map(({ id }) => id),
      [retainedId, permanentId],
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_categories').get().count, 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

test('with retention 0 removes yesterday and keeps today, future and old permanent plans', () => {
  withTestDatabase((db) => {
    const endedYesterdayId = insertPlan(db, {
      fingerprint: 'ended-yesterday', startDate: '2026-08-15', endDate: '2026-08-16',
    });
    const noEndYesterdayId = insertPlan(db, {
      fingerprint: 'started-yesterday', startDate: '2026-08-16', endDate: null,
    });
    const endsTodayId = insertPlan(db, {
      fingerprint: 'ends-today', startDate: '2026-08-16', endDate: '2026-08-17',
    });
    const futureId = insertPlan(db, {
      fingerprint: 'future', startDate: '2026-08-18', endDate: '2026-08-19',
    });
    const permanentId = insertPlan(db, {
      fingerprint: 'old-permanent', startDate: '2020-01-01', endDate: '2020-01-02', permanent: 1,
    });

    const summary = purgeExpiredPlans(db, {
      retentionDays: 0,
      now: new Date('2026-08-17T12:00:00.000Z'),
    });

    assert.equal(summary.cutoff, '2026-08-17');
    assert.equal(summary.plans, 2);
    assert.deepEqual(
      db.prepare('SELECT id FROM plans ORDER BY id').all().map(({ id }) => id),
      [endsTodayId, futureId, permanentId],
    );
    assert.ok(![endedYesterdayId, noEndYesterdayId].some((id) => (
      db.prepare('SELECT 1 FROM plans WHERE id = ?').get(id)
    )));
  });
});
