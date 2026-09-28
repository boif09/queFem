import assert from 'node:assert/strict';
import test from 'node:test';
import { GencatAgendaImporter } from '../backend/src/importers/gencatAgenda.importer.js';
import { normalizeForFingerprint } from '../backend/src/normalizers/text.normalizer.js';
import { normalizeVenueIdentity } from '../backend/src/deduplication/recurringProductionDetector.js';
import { RecurringProductionAppliedGroupRepository } from '../backend/src/db/repositories/recurringProductionAppliedGroup.repository.js';
import { withTestDatabase } from './helpers.js';

const TITLE = 'Gran Gala Flamenc';
const VENUE = 'Palau de la Música Catalana';
const GROUP_KEY = `gencat-agenda|${normalizeForFingerprint(TITLE, { removeArticles: true })}|${normalizeVenueIdentity(VENUE)}`;

function record({ codi, dataInici }) {
  return {
    codi,
    denominaci: TITLE,
    descripcio: 'Descripció original',
    data_inici: dataInici,
    data_fi: dataInici,
    tags_mbits: 'agenda:ambits/musica',
    municipi: 'agenda:ubicacions/barcelona/barcelones/barcelona',
    comarca: 'agenda:ubicacions/barcelona/barcelones',
    espai: VENUE,
    imatges: '/content/dam/agenda/not-reusable.jpg',
    data_creacio: '2026-08-01T10:00:00.000',
  };
}

function officialFetch(records) {
  return (input) => {
    const url = String(input);
    if (url.includes('/api/views/')) {
      return Promise.resolve(new Response(JSON.stringify({
        id: 'rhpv-yr4f', rowsUpdatedAt: 1786924800, columns: [{ fieldName: 'codi' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify(records), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
}

function seedPlan(db, { title, venue }) {
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, permanent,
      venue_name, municipality, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', ?, '2026-08-17', 0, ?, 'Barcelona', 70, 'active', ?, ?)
  `).run(`seed|${title}|${venue}|${Math.random()}`, title, venue, '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z').lastInsertRowid);
}

test('a NEW Gencat occurrence for an already-consolidated group (DB mapping) attaches to the canonical plan (getTargetPlanId hook), not a new plan row', async () => {
  await withTestDatabase(async (db) => {
    // Seed the "already consolidated" canonical plan + DB mapping directly
    // (as if scripts/consolidate-recurring-group.js had already run for this
    // group — the mapping now lives in recurring_production_applied_groups,
    // not a JSON file — Phase 4C.3A atomicity hardening).
    const canonicalPlanId = seedPlan(db, { title: TITLE, venue: VENUE });
    new RecurringProductionAppliedGroupRepository(db).create({
      groupKey: GROUP_KEY, source: 'gencat-agenda', canonicalPlanId, appliedBy: 'test',
    });
    const totalPlansBefore = db.prepare('SELECT COUNT(*) n FROM plans').get().n;

    const importer = new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([record({ codi: '20260901001', dataInici: '2026-09-01T00:00:00.000' })]),
      pageSize: 10,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const result = await importer.run();
    assert.deepEqual(result, { fetched: 1, inserted: 0, updated: 1, skipped: 0, invalid: 0, errors: 0 });

    const totalPlansAfter = db.prepare('SELECT COUNT(*) n FROM plans').get().n;
    assert.equal(totalPlansAfter, totalPlansBefore, 'no new fragmented plan was created for the new occurrence');

    const link = db.prepare(`
      SELECT ps.plan_id FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.source_record_id LIKE '20260901001@%'
    `).get();
    assert.equal(link.plan_id, canonicalPlanId);
  });
});

test('a Gencat record whose title/venue do NOT match any applied group imports normally via fingerprint lookup', async () => {
  await withTestDatabase(async (db) => {
    // A mapping exists for GROUP_KEY pointing at plan id 999999 (nonexistent
    // in this test DB would violate the FK, so seed a real unrelated plan) —
    // but this record's own title differs, so getTargetPlanId() must return
    // null and never even attempt to use it.
    const unrelatedCanonical = seedPlan(db, { title: TITLE, venue: VENUE });
    new RecurringProductionAppliedGroupRepository(db).create({
      groupKey: GROUP_KEY, source: 'gencat-agenda', canonicalPlanId: unrelatedCanonical, appliedBy: 'test',
    });
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi: '20260901002', dataInici: '2026-09-01T00:00:00.000' }), denominaci: 'Unrelated concert', espai: 'Other venue' }]),
      pageSize: 10,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const result = await importer.run();
    assert.deepEqual(result, { fetched: 1, inserted: 1, updated: 0, skipped: 0, invalid: 0, errors: 0 });
  });
});

test('no applied-group mapping at all (the normal state before any consolidation) imports normally via fingerprint lookup', async () => {
  await withTestDatabase(async (db) => {
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([record({ codi: '20260901003', dataInici: '2026-09-01T00:00:00.000' })]),
      pageSize: 10,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const result = await importer.run();
    assert.deepEqual(result, { fetched: 1, inserted: 1, updated: 0, skipped: 0, invalid: 0, errors: 0 });
  });
});
