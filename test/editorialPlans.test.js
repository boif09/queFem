import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { withTestDatabase } from './helpers.js';

function insertPlan(db, fingerprint, title, startDate, endDate, permanent = 0) {
  const now = '2026-08-21T10:00:00.000Z';
  const planId = Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, title_ca,
      start_date, end_date, permanent, province, comarca, municipality,
      quality_score, status, created_at, updated_at
    ) VALUES (?, ?, 'ca', ?, ?, ?, ?, ?, 'Girona', 'Baix Emporda', 'Begur', 80, 'active', ?, ?)
  `).run(
    permanent ? 'place' : 'event', fingerprint, title, title,
    startDate, endDate, permanent, now, now,
  ).lastInsertRowid);
  db.prepare(`INSERT INTO plan_sources
    (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
    SELECT ?,id,?,'{}',?,? FROM sources WHERE key='gencat-agenda'`
  ).run(planId, `editorial-${planId}`, now, now);
  return planId;
}

test('modos editoriales temporales de Home', async () => {
  await withTestDatabase(async (db) => {
    const ids = {
      insideFirst: insertPlan(db, 'inside-first', 'Comença dissabte A', '2026-08-22', '2026-08-22'),
      insideTie: insertPlan(db, 'inside-tie', 'Comença dissabte B', '2026-08-22', '2026-08-23'),
      insideSunday: insertPlan(db, 'inside-sunday', 'Comença diumenge', '2026-08-23', '2026-08-23'),
      immediatelyBefore: insertPlan(db, 'immediately-before', 'Comença divendres', '2026-08-21', '2026-08-22'),
      monthsBefore: insertPlan(db, 'months-before', 'Comença fa mesos', '2026-05-01', '2026-08-23'),
      yearBefore: insertPlan(db, 'year-before', 'Comença fa més d’un any', '2025-01-01', '2026-08-23'),
      future: insertPlan(db, 'future', 'Comença dilluns', '2026-08-24', '2026-08-24'),
      permanent: insertPlan(db, 'permanent', 'Pla permanent', null, null, 1),
    };
    const app = createApp({
      db,
      defaultLanguage: 'ca',
      eventRetentionDays: 0,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      logger: { error() {} },
    });
    const get = (path) => request(app).get(path);

    const weekend = await get('/api/plans?editorial=home-weekend&dateFrom=2026-08-22&dateTo=2026-08-23&permanent=false&sort=date&limit=20');
    assert.equal(weekend.status, 200);
    assert.deepEqual(weekend.body.data.map(({ id }) => id), [
      ids.insideFirst,
      ids.insideTie,
      ids.insideSunday,
      ids.immediatelyBefore,
      ids.monthsBefore,
      ids.yearBefore,
    ]);
    assert.ok(weekend.body.data.every(({ permanent }) => permanent === false));

    const limitedWeekend = await get('/api/plans?editorial=home-weekend&dateFrom=2026-08-22&dateTo=2026-08-23&permanent=false&limit=3');
    assert.deepEqual(limitedWeekend.body.data.map(({ id }) => id), [
      ids.insideFirst,
      ids.insideTie,
      ids.insideSunday,
    ]);

    const upcoming = await get('/api/plans?editorial=home-upcoming&dateFrom=2026-08-21&permanent=false&sort=date&limit=20');
    assert.equal(upcoming.status, 200);
    assert.deepEqual(upcoming.body.data.map(({ id }) => id), [
      ids.immediatelyBefore,
      ids.insideFirst,
      ids.insideTie,
      ids.insideSunday,
      ids.future,
    ]);
    assert.ok(upcoming.body.data.every(({ start_date: startDate, permanent }) => (
      startDate >= '2026-08-21' && permanent === false
    )));

    const permanent = await get('/api/plans?permanent=true&sort=quality');
    assert.deepEqual(permanent.body.data.map(({ id }) => id), [ids.permanent]);

    const discoveryRange = await get('/api/plans?dateFrom=2026-08-22&dateTo=2026-08-23&sort=date&limit=20');
    assert.deepEqual(discoveryRange.body.data.map(({ id }) => id), [
      ids.yearBefore,
      ids.monthsBefore,
      ids.immediatelyBefore,
      ids.insideFirst,
      ids.insideTie,
      ids.insideSunday,
      ids.permanent,
    ]);

    assert.equal((await get('/api/plans?editorial=home-weekend&dateFrom=2026-08-22')).status, 400);
    assert.equal((await get('/api/plans?editorial=home-upcoming&dateFrom=2026-08-21&permanent=true')).status, 400);
    assert.equal((await get('/api/plans?editorial=unknown&dateFrom=2026-08-21')).status, 400);
  });
});
