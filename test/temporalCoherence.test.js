import assert from 'node:assert/strict';
import test from 'node:test';
import {
  purgeTemporallyInvalidPlans,
  temporalCoherenceIssue,
} from '../backend/src/quality/temporalCoherence.js';
import { withTestDatabase } from './helpers.js';

const currentYear = 2026;

function event(startDate, endDate, permanent = 0) {
  return {
    kind: 'event', permanent, start_date: startDate, end_date: endDate,
  };
}

function insertPlan(db, fingerprint, plan) {
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_title, start_date, end_date, permanent,
      quality_score, status, created_at, updated_at
    ) VALUES ('event', ?, ?, ?, ?, ?, 70, 'active', ?, ?)
  `).run(
    fingerprint,
    fingerprint,
    plan.start_date,
    plan.end_date,
    plan.permanent,
    '2026-08-17T10:00:00.000Z',
    '2026-08-17T10:00:00.000Z',
  ).lastInsertRowid);
}

test('accepts normal multi-month and two-year events', () => {
  assert.equal(temporalCoherenceIssue(
    event('2026-03-01', '2026-11-30'), { currentYear },
  ), null);
  assert.equal(temporalCoherenceIssue(
    event('2026-08-17', '2028-08-17'), { currentYear },
  ), null);
});

test('rejects 2024-2924 and an end date before the start date', () => {
  assert.equal(
    temporalCoherenceIssue(event('2024-06-28', '2924-06-30'), { currentYear }).code,
    'EXTREME_FUTURE_DATE',
  );
  assert.equal(
    temporalCoherenceIssue(event('2026-10-02', '2026-10-01'), { currentYear }).code,
    'END_BEFORE_START',
  );
});

test('rejects non-permanent event durations over ten years conservatively', () => {
  assert.equal(
    temporalCoherenceIssue(event('2000-01-01', '2010-01-01'), { currentYear }),
    null,
  );
  assert.equal(
    temporalCoherenceIssue(event('2000-01-01', '2010-01-02'), { currentYear }).code,
    'EVENT_DURATION_EXCEEDS_10_YEARS',
  );
});

test('does not apply temporal restrictions to permanent plans', () => {
  assert.equal(temporalCoherenceIssue(
    event('1900-01-01', '2924-06-30', 1), { currentYear },
  ), null);
});

test('purges invalid dates and keeps valid and permanent plans', () => {
  withTestDatabase((db) => {
    const invalidId = insertPlan(db, 'espai-vapor', event('2024-06-28', '2924-06-30'));
    const validId = insertPlan(db, 'two-years', event('2026-08-17', '2028-08-17'));
    const permanentId = insertPlan(db, 'old-permanent', event('1900-01-01', '2924-06-30', 1));
    const sourceId = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get().id;
    db.prepare(`
      INSERT INTO plan_sources (
        plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
      ) VALUES (?, ?, 'invalid-date', '{}', ?, ?)
    `).run(invalidId, sourceId, '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');

    assert.deepEqual(purgeTemporallyInvalidPlans(db, {
      now: new Date('2026-08-17T12:00:00.000Z'),
    }), { plans: 1, planSources: 1, planCategories: 0 });
    assert.deepEqual(
      db.prepare('SELECT id FROM plans ORDER BY id').all().map(({ id }) => id),
      [validId, permanentId],
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});
