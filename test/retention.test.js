import assert from 'node:assert/strict';
import test from 'node:test';
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

test('calculates the 90-day cutoff using the Catalonia calendar date', () => {
  assert.equal(retentionCutoff(90, new Date('2026-08-17T12:00:00.000Z')), '2026-05-19');
  assert.throws(() => retentionCutoff(0), /enter positiu/);
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
      fingerprint: 'cutoff', startDate: '2026-05-18', endDate: '2026-05-19',
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
      retentionDays: 90,
      now: new Date('2026-08-17T12:00:00.000Z'),
    });

    assert.deepEqual(summary, {
      cutoff: '2026-05-19', plans: 1, planSources: 1, planCategories: 1,
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
