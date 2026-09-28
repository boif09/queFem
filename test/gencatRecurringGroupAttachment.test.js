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
    // Regression (Phase 4C.6B): ordinary, non-applied Gencat records must
    // never get a plan_occurrence row created for them by this mechanism.
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_occurrences').get().n, 0);
  });
});

// ============================================================================
// Phase 4C.6B — recurring-occurrence maintenance during normal Gencat import.
//
// The consolidation script (scripts/consolidate-recurring-group.js) only ever
// runs once per group; these tests cover what keeps plan_occurrences correct
// for an already-applied group on every ORDINARY import afterwards, using
// fixtures modeled on the currently-consolidated groups (Gran Gala Flamenc
// etc.) and on the multi-venue groups from Phase 4C.6 (Memoria/Espais).
// ============================================================================

// Mirrors what a REAL applied group looks like right after
// scripts/consolidate-recurring-group.js has run: the canonical plan's
// start_date/end_date are backed by an actual plan_occurrence (not just bare
// plan columns with nothing behind them), attached through a seeded
// plan_source with a distinct pre-existing codi.
function seedAppliedGroup(db, { title = TITLE, venue = VENUE, startDate = '2026-08-17', seedCodi = '20260101099' } = {}) {
  const canonicalPlanId = seedPlan(db, { title, venue });
  db.prepare('UPDATE plans SET start_date = ?, end_date = ? WHERE id = ?').run(startDate, startDate, canonicalPlanId);
  const gencatSource = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  const now = '2026-08-01T10:00:00.000Z';
  const seededSourceId = Number(db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, '{}', ?, ?)
  `).run(canonicalPlanId, gencatSource.id, `${seedCodi}@0000000000000000`, now, now).lastInsertRowid);
  db.prepare(`
    INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, 'Europe/Madrid', 'active', ?, ?, ?)
  `).run(seededSourceId, seedCodi, startDate, now, now, now);
  const groupKey = `gencat-agenda|${normalizeForFingerprint(title, { removeArticles: true })}|${normalizeVenueIdentity(venue)}`;
  new RecurringProductionAppliedGroupRepository(db).create({ groupKey, source: 'gencat-agenda', canonicalPlanId, appliedBy: 'test' });
  return canonicalPlanId;
}

test('a genuinely new future date for an already-applied group creates exactly one new plan_occurrence and extends canonical end_date', async () => {
  await withTestDatabase(async (db) => {
    const canonicalPlanId = seedAppliedGroup(db, { startDate: '2026-08-17' });
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([record({ codi: '20261201010', dataInici: '2026-12-01T00:00:00.000' })]),
      pageSize: 10,
      now: () => new Date('2026-11-01T12:00:00.000Z'),
    });
    await importer.run();

    const occurrences = db.prepare(`
      SELECT o.local_date, o.occurrence_key FROM plan_occurrences o
      JOIN plan_sources ps ON ps.id = o.plan_source_id
      WHERE ps.plan_id = ? AND o.occurrence_key = '20261201010'
    `).all(canonicalPlanId);
    assert.equal(occurrences.length, 1, 'exactly one new occurrence was added for the new session');
    assert.equal(occurrences[0].local_date, '2026-12-01');

    const totalOccurrences = db.prepare(`
      SELECT COUNT(*) n FROM plan_occurrences po JOIN plan_sources ps ON ps.id = po.plan_source_id WHERE ps.plan_id = ?
    `).get(canonicalPlanId).n;
    assert.equal(totalOccurrences, 2, 'the pre-existing seeded occurrence is untouched, plus the one new one');

    // Canonical end_date must not remain stale/earlier than the new occurrence.
    const plan = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
    assert.equal(plan.start_date, '2026-08-17', 'start_date untouched — still the earliest occurrence');
    assert.equal(plan.end_date, '2026-12-01', 'end_date extended to the new occurrence');
  });
});

test('re-importing the exact same record (unchanged payload) is idempotent: no duplicate occurrence', async () => {
  await withTestDatabase(async (db) => {
    const canonicalPlanId = seedAppliedGroup(db);
    const records = [record({ codi: '20261201011', dataInici: '2026-12-01T00:00:00.000' })];
    const runImport = () => new GencatAgendaImporter({
      db, fetchImpl: officialFetch(records), pageSize: 10, now: () => new Date('2026-11-01T12:00:00.000Z'),
    }).run();

    const first = await runImport();
    assert.deepEqual(first, { fetched: 1, inserted: 0, updated: 1, skipped: 0, invalid: 0, errors: 0 });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_occurrences').get().n, 2, 'the seeded occurrence plus the one new one');

    const second = await runImport();
    assert.equal(second.skipped, 1, 'unchanged payload is a fast no-op at the persist layer');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_occurrences').get().n, 2, 'no duplicate occurrence from the re-import');

    const sourceCount = db.prepare(`
      SELECT COUNT(*) n FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ? AND ps.source_record_id LIKE '20261201011@%'
    `).get(canonicalPlanId).n;
    assert.equal(sourceCount, 1, 'no duplicate plan_sources row either');
  });
});

test('a new venue variant of an already-known session does NOT create a duplicate occurrence (multi-venue, Espais-de-poder-shaped)', async () => {
  await withTestDatabase(async (db) => {
    const canonicalPlanId = seedAppliedGroup(db, { venue: 'Torre Bellesguard' });
    const codi = '20261201012';
    // First venue variant arrives in one import...
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi, dataInici: '2026-12-01T00:00:00.000' }), espai: 'Torre Bellesguard' }]),
      pageSize: 10,
      now: () => new Date('2026-11-01T12:00:00.000Z'),
    }).run();
    const firstSource = db.prepare(`
      SELECT ps.id FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ? AND ps.source_record_id LIKE '${codi}@%'
    `).get(canonicalPlanId);
    assert.ok(firstSource, 'the first venue variant attached to the canonical plan');

    // ...a SECOND venue variant of the exact same real session (same codi,
    // same date, DIFFERENT venue — its OWN recurringGroupKey therefore
    // differs from the applied group's exact key; must be matched via the
    // title-only fallback, see resolveAppliedCanonicalPlanId()) arrives in a
    // LATER import.
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi, dataInici: '2026-12-01T00:00:00.000' }), espai: 'Museu Monestir de Pedralbes', adre_a: 'Baixada del monestir, 9' }]),
      pageSize: 10,
      now: () => new Date('2026-11-02T12:00:00.000Z'),
    }).run();

    const sourceCount = db.prepare(`
      SELECT COUNT(*) n FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ? AND ps.source_record_id LIKE '${codi}@%'
    `).get(canonicalPlanId).n;
    assert.equal(sourceCount, 2, 'both venue-variant plan_sources rows are preserved for provenance, and BOTH attached to canonical (not a new fragmented plan)');

    const occurrences = db.prepare(`
      SELECT o.plan_source_id, o.occurrence_key FROM plan_occurrences o
      JOIN plan_sources ps ON ps.id = o.plan_source_id
      WHERE ps.plan_id = ? AND o.occurrence_key = ?
    `).all(canonicalPlanId, codi);
    assert.equal(occurrences.length, 1, 'still exactly one occurrence for the one real session');
    assert.equal(occurrences[0].plan_source_id, firstSource.id, 'the representative stays the first-seen (lowest id) plan_source');
  });
});

test('two genuinely different sessions (different codi) on the SAME date remain 2 distinct occurrences', async () => {
  await withTestDatabase(async (db) => {
    const canonicalPlanId = seedAppliedGroup(db);
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([
        record({ codi: '20261201020', dataInici: '2026-12-01T00:00:00.000' }),
        record({ codi: '20261201021', dataInici: '2026-12-01T00:00:00.000' }),
      ]),
      pageSize: 10,
      now: () => new Date('2026-11-01T12:00:00.000Z'),
    }).run();

    const occurrences = db.prepare(`
      SELECT o.occurrence_key, o.local_date FROM plan_occurrences o
      JOIN plan_sources ps ON ps.id = o.plan_source_id
      WHERE ps.plan_id = ? AND o.occurrence_key IN ('20261201020', '20261201021')
      ORDER BY o.occurrence_key
    `).all(canonicalPlanId);
    assert.equal(occurrences.length, 2, 'a date-only dedupe would have wrongly collapsed these into one');
    assert.deepEqual(occurrences.map((o) => o.occurrence_key), ['20261201020', '20261201021']);
    assert.ok(occurrences.every((o) => o.local_date === '2026-12-01'));
  });
});

test('a hash-changed payload for the same real session (same codi/date) updates in place, no duplicate occurrence', async () => {
  await withTestDatabase(async (db) => {
    const canonicalPlanId = seedAppliedGroup(db);
    const codi = '20261201030';
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi, dataInici: '2026-12-01T00:00:00.000' }), descripcio: 'Original description' }]),
      pageSize: 10,
      now: () => new Date('2026-11-01T12:00:00.000Z'),
    }).run();
    const firstSource = db.prepare(`
      SELECT ps.id FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ? AND ps.source_record_id LIKE '${codi}@%'
    `).get(canonicalPlanId);
    assert.ok(firstSource);

    // A later import brings a CHANGED payload for the exact same codi/date —
    // getExternalId() mints a NEW source_record_id (different hash), so this
    // is a genuinely new plan_sources row, not an update of the old one.
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi, dataInici: '2026-12-01T00:00:00.000' }), descripcio: 'Updated description with more detail' }]),
      pageSize: 10,
      now: () => new Date('2026-11-05T12:00:00.000Z'),
    }).run();

    const sourceCount = db.prepare(`
      SELECT COUNT(*) n FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ? AND ps.source_record_id LIKE '${codi}@%'
    `).get(canonicalPlanId).n;
    assert.equal(sourceCount, 2, 'the old and new payload variants are both preserved as provenance');

    const occurrences = db.prepare(`
      SELECT po.plan_source_id, po.occurrence_key FROM plan_occurrences po
      JOIN plan_sources ps ON ps.id = po.plan_source_id
      WHERE ps.plan_id = ? AND po.occurrence_key = ?
    `).all(canonicalPlanId, codi);
    assert.equal(occurrences.length, 1, 'one real session stays one occurrence despite the hash change');
    assert.equal(occurrences[0].plan_source_id, firstSource.id, 'representative stays the original lowest id');
  });
});

test('a group consolidated BEFORE Phase 4C.6 (occurrence_key = full source_record_id, the pre-4C.6 format) is still maintained correctly, no duplicate occurrence', async () => {
  await withTestDatabase(async (db) => {
    // Seed an applied group the way scripts/consolidate-recurring-group.js
    // actually wrote it before Phase 4C.6 switched occurrence_key from the
    // full hash-suffixed source_record_id to the bare sessionIdentifier —
    // e.g. exactly how Gran Gala Flamenc (Phase 4C.3B) looks in real
    // production today. A production-copy end-to-end test against the real
    // Gran Gala Flamenc data caught this: upserting with a freshly-computed
    // bare-codi key here would not match the existing full-key row and would
    // insert a duplicate instead of updating it.
    const canonicalPlanId = seedPlan(db, { title: TITLE, venue: VENUE });
    const gencatSource = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
    const now = '2026-08-01T10:00:00.000Z';
    const oldFormatSourceRecordId = '20260402090@8d7f24d46bb04e59';
    const seededSourceId = Number(db.prepare(`
      INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
      VALUES (?, ?, ?, '{}', ?, ?)
    `).run(canonicalPlanId, gencatSource.id, oldFormatSourceRecordId, now, now).lastInsertRowid);
    db.prepare(`
      INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
      VALUES (?, ?, '2026-10-04', 'Europe/Madrid', 'active', ?, ?, ?)
    `).run(seededSourceId, oldFormatSourceRecordId, now, now, now); // pre-4C.6: occurrence_key = full source_record_id
    new RecurringProductionAppliedGroupRepository(db).create({ groupKey: GROUP_KEY, source: 'gencat-agenda', canonicalPlanId, appliedBy: 'test' });

    // A later, ordinary re-import of the exact same real session (same bare
    // codi "20260402090", same date) with a slightly different payload (a
    // genuine venue-variant style row, or simply an updated field) — this
    // must reuse the EXISTING pre-4C.6 occurrence row, not mint a new one
    // under the new bare-codi key format.
    await new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch([{ ...record({ codi: '20260402090', dataInici: '2026-10-04T00:00:00.000' }), descripcio: 'Slightly different payload' }]),
      pageSize: 10,
      now: () => new Date('2026-09-28T12:00:00.000Z'),
    }).run();

    const occurrences = db.prepare(`
      SELECT po.id, po.occurrence_key, po.plan_source_id FROM plan_occurrences po
      JOIN plan_sources ps ON ps.id = po.plan_source_id
      WHERE ps.plan_id = ?
    `).all(canonicalPlanId);
    assert.equal(occurrences.length, 1, 'must still be exactly one occurrence for this real session — no duplicate under a mismatched key format');
    assert.equal(occurrences[0].occurrence_key, oldFormatSourceRecordId, 'the pre-existing (old-format) key is preserved, not replaced');
    assert.equal(occurrences[0].plan_source_id, seededSourceId, 'reused the original representative plan_source');

    const sourceCount = db.prepare(`
      SELECT COUNT(*) n FROM plan_sources ps JOIN sources s ON s.id = ps.source_id
      WHERE s.key = 'gencat-agenda' AND ps.plan_id = ?
    `).get(canonicalPlanId).n;
    assert.equal(sourceCount, 2, 'both the original and the new payload variant are preserved as provenance');
  });
});
