import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOutsideCatalonia,
  purgeOutsideCataloniaPlans,
} from '../backend/src/location/cataloniaScope.js';
import { withTestDatabase } from './helpers.js';

function insertPlan(db, fingerprint, location) {
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_title, permanent, province, comarca,
      municipality, locality, quality_score, status, created_at, updated_at
    ) VALUES ('event', ?, ?, 0, ?, ?, ?, ?, 70, 'active', ?, ?)
  `).run(
    fingerprint,
    fingerprint,
    location.province ?? null,
    location.comarca ?? null,
    location.municipality ?? null,
    location.locality ?? null,
    '2026-08-17T10:00:00.000Z',
    '2026-08-17T10:00:00.000Z',
  ).lastInsertRowid);
}

test('recognizes explicit administrative equivalents without using coordinates', () => {
  assert.equal(isOutsideCatalonia({ province: 'Fora Catalunya' }), true);
  assert.equal(isOutsideCatalonia({ comarca: 'Fora Espanya' }), true);
  assert.equal(isOutsideCatalonia({ province: 'Fuera de Cataluña' }), true);
  assert.equal(isOutsideCatalonia({ comarca: 'Outside Spain' }), true);
  assert.equal(isOutsideCatalonia({
    province: 'Girona', comarca: 'Baix Empordà', latitude: null, longitude: null,
  }), false);
});

test('purges only plans explicitly marked outside Catalonia', () => {
  withTestDatabase((db) => {
    const outsideId = insertPlan(db, 'outside', {
      province: 'Fora de Catalunya', comarca: 'Fora Estat Espanyol',
    });
    const validId = insertPlan(db, 'valid-without-coordinates', {
      province: 'Girona', comarca: 'Baix Emporda', municipality: 'Palafrugell',
    });
    const sourceId = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get().id;
    db.prepare(`
      INSERT INTO plan_sources (
        plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
      ) VALUES (?, ?, 'outside-source', '{}', ?, ?)
    `).run(outsideId, sourceId, '2026-08-17T10:00:00.000Z', '2026-08-17T10:00:00.000Z');

    assert.deepEqual(purgeOutsideCataloniaPlans(db), {
      plans: 1, planSources: 1, planCategories: 0,
    });
    assert.deepEqual(db.prepare('SELECT id FROM plans').all(), [{ id: validId }]);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});
