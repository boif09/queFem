import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlaceNameChanges, changeSetHash, computePlaceNameChanges, rollbackSql } from '../scripts/restore-place-accents.js';
import { withTestDatabase } from './helpers.js';

const STAMP = '2026-01-01T00:00:00.000Z';

function addPlan(db, { comarca, municipality, title = 'Test', fingerprint }) {
  return Number(db.prepare(`INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent,
    province, comarca, municipality, locality, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', ?, '2026-12-01', '2026-12-01', 0, 'Barcelona', ?, ?, 'Poble Sec', 70, 'active', ?, ?)`)
    .run(fingerprint ?? `fp|${Math.random()}`, title, comarca, municipality, STAMP, STAMP).lastInsertRowid);
}
const row = (db, id) => db.prepare('SELECT * FROM plans WHERE id = ?').get(id);

function seed(db) {
  const ids = {
    bad: addPlan(db, { comarca: 'Barcelones', municipality: 'Cornella de Llobregat' }),
    onlyComarca: addPlan(db, { comarca: 'Valles Oriental', municipality: 'Granollers' }),
    official: addPlan(db, { comarca: 'Barcelonès', municipality: 'Barcelona' }),
    lowerArticle: addPlan(db, { comarca: 'Maresme', municipality: 'el Masnou' }),
    unknown: addPlan(db, { comarca: 'Comarca Inventada', municipality: 'Poble Inventat' }),
    nulls: addPlan(db, { comarca: null, municipality: null }),
  };
  db.prepare('UPDATE plans SET locality = NULL WHERE id = ?').run(ids.nulls);
  return ids;
}

test('the dry-run computation lists only plans whose names differ from the official spelling and writes nothing', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const before = db.prepare('SELECT * FROM plans ORDER BY id').all();
    const { scanned, changes } = computePlaceNameChanges(db);
    assert.equal(scanned, 5, 'plans without any place name are not scanned');
    assert.deepEqual(changes.map(({ id }) => id), [ids.bad, ids.onlyComarca, ids.lowerArticle]);
    assert.deepEqual(changes[0].next, { comarca: 'Barcelonès', municipality: 'Cornellà de Llobregat' });
    assert.deepEqual(changes[1].next, { comarca: 'Vallès Oriental' }, 'a correct municipality is not rewritten');
    assert.deepEqual(changes[2].next, { municipality: 'El Masnou' });
    assert.deepEqual(db.prepare('SELECT * FROM plans ORDER BY id').all(), before);
  });
});

test('a locality is corrected only when it is an official municipality name, in the same change set', () => {
  withTestDatabase((db) => {
    const town = addPlan(db, { comarca: 'Baix Llobregat', municipality: 'Cornellà de Llobregat' });
    db.prepare('UPDATE plans SET locality = ? WHERE id = ?').run('Cornellà de llobregat', town);
    const fresh = computePlaceNameChanges(db);
    assert.deepEqual(fresh.changes.map(({ id, next }) => [id, next]), [[town, { locality: 'Cornellà de Llobregat' }]], 'the neighbourhood "Poble Sec" of the other plans is not a municipality');
    const applied = applyPlaceNameChanges(db, { expectedChanges: 1, expectedHash: changeSetHash(fresh.changes) });
    assert.equal(row(db, town).locality, 'Cornellà de Llobregat');
    db.exec(`BEGIN; ${rollbackSql(applied.changes).join('\n')}\n COMMIT;`);
    assert.equal(row(db, town).locality, 'Cornellà de llobregat', 'the rollback restores the previous locality');
  });
});

test('restricting the fields leaves the other columns out of the change set and out of the apply', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    db.prepare('UPDATE plans SET locality = ? WHERE id = ?').run('el masnou', ids.bad);
    const onlyLocality = computePlaceNameChanges(db, undefined, ['locality']);
    assert.deepEqual(onlyLocality.changes.map(({ id, next }) => [id, next]), [[ids.bad, { locality: 'El Masnou' }]]);
    applyPlaceNameChanges(db, { expectedChanges: 1, expectedHash: changeSetHash(onlyLocality.changes), fields: ['locality'] });
    assert.equal(row(db, ids.bad).locality, 'El Masnou');
    assert.equal(row(db, ids.bad).municipality, 'Cornella de Llobregat', 'municipality is untouched');
    assert.equal(row(db, ids.bad).comarca, 'Barcelones', 'comarca is untouched');
  });
});

test('apply updates only comarca, municipality and locality, keeps updated_at and every other column, and is idempotent', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const before = db.prepare('SELECT * FROM plans ORDER BY id').all();
    const { changes } = computePlaceNameChanges(db);
    applyPlaceNameChanges(db, { expectedChanges: changes.length, expectedHash: changeSetHash(changes) });
    assert.equal(row(db, ids.bad).comarca, 'Barcelonès');
    assert.equal(row(db, ids.bad).municipality, 'Cornellà de Llobregat');
    assert.equal(row(db, ids.lowerArticle).municipality, 'El Masnou');
    for (const previous of before) {
      const now = row(db, previous.id);
      const { comarca: _c, municipality: _m, ...restBefore } = previous;
      const { comarca: _c2, municipality: _m2, ...restNow } = now;
      assert.deepEqual(restNow, restBefore, `plan ${previous.id}: nothing but comarca/municipality may change`);
    }
    assert.equal(row(db, ids.official).comarca, 'Barcelonès');
    assert.equal(row(db, ids.unknown).comarca, 'Comarca Inventada');
    assert.equal(computePlaceNameChanges(db).changes.length, 0, 'a second run finds nothing');
  });
});

test('apply aborts without writing when the expected count no longer matches', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const hash = changeSetHash(computePlaceNameChanges(db).changes);
    assert.throws(() => applyPlaceNameChanges(db, { expectedChanges: 99, expectedHash: hash }), /Expected 99 changes but found 3/);
    assert.equal(row(db, ids.bad).comarca, 'Barcelones');
  });
});

test('apply aborts when the change set differs even though the count is the same', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    const dryRun = computePlaceNameChanges(db);
    // One pending correction disappears and a different one appears: still 3 changes, but not the reviewed ones.
    db.prepare('UPDATE plans SET comarca = ?, municipality = ? WHERE id = ?').run('Barcelonès', 'Cornellà de Llobregat', ids.bad);
    addPlan(db, { comarca: 'Segria', municipality: 'Lleida' });
    const drifted = computePlaceNameChanges(db);
    assert.equal(drifted.changes.length, dryRun.changes.length, 'same count');
    assert.throws(() => applyPlaceNameChanges(db, { expectedChanges: dryRun.changes.length, expectedHash: changeSetHash(dryRun.changes) }), /set of changes differs/);
    assert.equal(row(db, ids.onlyComarca).comarca, 'Valles Oriental', 'nothing was written');
  });
});

test('a failure after the first update rolls the whole run back', () => {
  withTestDatabase((db) => {
    const ids = seed(db);
    db.exec(`CREATE TRIGGER fail_on_second BEFORE UPDATE ON plans WHEN NEW.id = ${ids.lowerArticle} BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    assert.throws(() => applyPlaceNameChanges(db, { expectedChanges: 3, expectedHash: changeSetHash(computePlaceNameChanges(db).changes) }), /boom/);
    assert.equal(row(db, ids.bad).comarca, 'Barcelones', 'earlier updates are undone');
    assert.equal(row(db, ids.onlyComarca).comarca, 'Valles Oriental');
  });
});

test('the generated rollback SQL restores the previous names exactly, including quotes and nulls', () => {
  withTestDatabase((db) => {
    const apostrophe = addPlan(db, { comarca: "Pla D'Urgell", municipality: "Esterri D'Aneu" });
    const before = row(db, apostrophe);
    const fresh = applyPlaceNameChanges(db, { expectedChanges: 1, expectedHash: changeSetHash(computePlaceNameChanges(db).changes) });
    assert.equal(row(db, apostrophe).comarca, "Pla d'Urgell");
    assert.equal(row(db, apostrophe).municipality, "Esterri d'Àneu");
    db.exec(`BEGIN; ${rollbackSql(fresh.changes).join('\n')}\n COMMIT;`);
    assert.equal(row(db, apostrophe).comarca, before.comarca);
    assert.equal(row(db, apostrophe).municipality, before.municipality);
  });
});

test('the rollback leaves alone a name that was changed again after the correction', () => {
  withTestDatabase((db) => {
    const id = addPlan(db, { comarca: 'Barcelones', municipality: 'Alcarras' });
    const fresh = applyPlaceNameChanges(db, { expectedChanges: 1, expectedHash: changeSetHash(computePlaceNameChanges(db).changes) });
    db.prepare('UPDATE plans SET municipality = ? WHERE id = ?').run('Lleida', id);
    db.exec(`BEGIN; ${rollbackSql(fresh.changes).join('\n')}\n COMMIT;`);
    assert.equal(row(db, id).comarca, 'Barcelones', 'the untouched correction is reverted');
    assert.equal(row(db, id).municipality, 'Lleida', 'the newer value is not overwritten with the pre-correction one');
  });
});

test('malformed expected values are refused by the command line', async () => {
  const { execFileSync } = await import('node:child_process');
  const run = (...args) => { try { execFileSync(process.execPath, ['scripts/restore-place-accents.js', ...args], { stdio: 'pipe', env: { ...process.env, DATABASE_PATH: ':memory:' } }); return ''; } catch (error) { return String(error.stderr); } };
  assert.match(run('--apply', '--expected-changes=1406oops', '--expected-hash=0123456789ab'), /requires --expected-changes/);
  assert.match(run('--apply', '--expected-changes=3'), /requires --expected-changes/);
});
