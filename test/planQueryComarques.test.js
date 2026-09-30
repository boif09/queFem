import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { PlanQueryRepository } from '../backend/src/db/repositories/planQuery.repository.js';

// Real-world pattern (confirmed in production): Gencat only ever supplies a
// de-accented URL slug for comarca ("barcelones"), which cannot be
// losslessly restored to the correct Catalan spelling ("Barcelonès") — other
// sources (Fever, DIBA) publish the accented name directly. Both spellings
// end up stored side by side in plans.comarca.
const NOW = '2026-08-17T10:00:00.000Z';

function makeRepository(db) {
  // Fixed "now" matching the fixture dates below — PlanQueryRepository
  // defaults to real wall-clock time for its retention cutoff, which would
  // otherwise treat these fixed 2026-08-20 fixture dates as expired.
  return new PlanQueryRepository(db, { now: () => new Date(NOW) });
}

function insertPlan(db, { comarca, province = 'Barcelona', municipality = null, sourceKey = 'gencat-agenda' }) {
  const planId = Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent,
      province, comarca, municipality, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', 'Test', '2026-08-20', '2026-08-20', 0, ?, ?, ?, 70, 'active', ?, ?)
  `).run(`fp|${comarca}|${municipality}|${sourceKey}|${Math.random()}`, province, comarca, municipality, NOW, NOW).lastInsertRowid);
  const source = db.prepare('SELECT id FROM sources WHERE key = ?').get(sourceKey);
  db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, '{}', ?, ?)
  `).run(planId, source.id, `rec-${planId}-${Math.random()}`, NOW, NOW);
  return planId;
}

test('findComarques: accented and unaccented spellings of the same comarca collapse into one entry', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Barcelones' }); // gencat-agenda style, de-accented
    insertPlan(db, { comarca: 'Barcelonès', sourceKey: 'ticketmaster-discovery-feed' }); // correctly accented, from an already-enabled source
    insertPlan(db, { comarca: 'Barcelonès', sourceKey: 'ticketmaster-discovery-feed' }); // a second one, same spelling

    const repository = makeRepository(db);
    const comarques = repository.findComarques();
    assert.equal(comarques.length, 1, 'must not appear as two separate dropdown entries');
    assert.equal(comarques[0].comarca, 'Barcelonès', 'the accented (correct) spelling is shown as the representative');
    assert.equal(comarques[0].province, 'Barcelona');
  });
});

test('findComarques: comarques that never had an accent-variant duplicate are unaffected', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Bages', province: 'Barcelona' });
    insertPlan(db, { comarca: 'Anoia', province: 'Barcelona' });

    const repository = makeRepository(db);
    const comarques = repository.findComarques();
    assert.deepEqual(comarques.map((c) => c.comarca).sort(), ['Anoia', 'Bages']);
  });
});

test('findComarques: province filter still works correctly alongside the accent-fold grouping', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Barcelones', province: 'Barcelona' });
    insertPlan(db, { comarca: 'Barcelonès', province: 'Barcelona', sourceKey: 'ticketmaster-discovery-feed' });
    insertPlan(db, { comarca: 'Girones', province: 'Girona' });

    const repository = makeRepository(db);
    const filtered = repository.findComarques('Barcelona');
    assert.deepEqual(filtered.map((c) => c.comarca), ['Barcelonès']);
  });
});

test('findMunicipalities: selecting the deduplicated comarca still returns municipalities from BOTH underlying spellings (test: filters stay correct)', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Barcelones', municipality: 'Barcelona' }); // gencat, unaccented
    insertPlan(db, { comarca: 'Barcelonès', municipality: 'Sabadell', sourceKey: 'ticketmaster-discovery-feed' }); // accented, from an already-enabled source

    const repository = makeRepository(db);
    // Simulates the frontend picking the (now single, accented) dropdown entry.
    const municipalities = repository.findMunicipalities({ comarca: 'Barcelonès' });
    assert.deepEqual(
      municipalities.map((m) => m.municipality).sort(),
      ['Barcelona', 'Sabadell'],
      'must include municipalities from plans stored under EITHER spelling, not just an exact string match',
    );
  });
});

test('findMunicipalities: also works when passed the unaccented spelling (defensive, matches normalize_location symmetry)', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Barcelones', municipality: 'Barcelona' });
    insertPlan(db, { comarca: 'Barcelonès', municipality: 'Sabadell', sourceKey: 'ticketmaster-discovery-feed' });

    const repository = makeRepository(db);
    const municipalities = repository.findMunicipalities({ comarca: 'Barcelones' });
    assert.deepEqual(municipalities.map((m) => m.municipality).sort(), ['Barcelona', 'Sabadell']);
  });
});

test('findComarques and findMunicipalities remain consistent with the main plan-listing filter\'s own accent-insensitive matching', () => {
  withTestDatabase((db) => {
    insertPlan(db, { comarca: 'Alt Emporda', province: 'Girona', municipality: 'Figueres' });
    insertPlan(db, { comarca: 'Alt Empordà', province: 'Girona', municipality: 'Roses', sourceKey: 'ticketmaster-discovery-feed' });

    const repository = makeRepository(db);
    const comarques = repository.findComarques();
    assert.equal(comarques.length, 1);
    const municipalities = repository.findMunicipalities({ comarca: comarques[0].comarca });
    assert.deepEqual(municipalities.map((m) => m.municipality).sort(), ['Figueres', 'Roses']);

    // The main plan-listing filter (buildWhere -> normalize_location(p.comarca) = normalize_location(?))
    // must also find both plans for this same comarca value, confirming consistency end to end.
    const where = repository.buildWhere({ comarca: comarques[0].comarca });
    const count = db.prepare(`SELECT COUNT(*) n FROM plans p WHERE ${where.sql}`)
      .get(...where.parameters).n;
    assert.equal(count, 2);
  });
});
