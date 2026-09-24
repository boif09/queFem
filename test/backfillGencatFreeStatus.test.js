import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { computeCandidates, applyBackfill } from '../scripts/backfill-gencat-free-status.js';

const NOW = '2026-09-24T10:00:00.000Z';

function insertPlan(db, values) {
  return Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, start_date, end_date,
      permanent, is_free, price_text, province, quality_score, status, created_at, updated_at
    ) VALUES (
      'event', @fingerprint, 'ca', @original_title, @start_date, @end_date,
      0, @is_free, @price_text, 'Girona', 70, 'active', @created_at, @updated_at
    )
  `).run({
    start_date: '2026-10-01',
    end_date: '2026-10-01',
    price_text: null,
    created_at: NOW,
    updated_at: NOW,
    ...values,
  }).lastInsertRowid);
}

function insertSource(db, planId, sourceKey, sourceRecordId, payload) {
  const source = db.prepare('SELECT id FROM sources WHERE key = ?').get(sourceKey);
  db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(planId, source.id, sourceRecordId, JSON.stringify(payload), NOW, NOW);
}

function gencatPayload(overrides) {
  return {
    codi: '2026000001',
    denominaci: 'Activitat de prova',
    descripcio: 'Descripció',
    data_inici: '2026-10-01T00:00:00.000',
    municipi: 'agenda:ubicacions/girona/baix-emporda/palafrugell',
    gratuita: 'No',
    entrades: null,
    ...overrides,
  };
}

test('a single-source Gencat plan with a stale wrongly-free value becomes a 1->0 candidate', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'a', original_title: 'A', is_free: 1, price_text: 'Preu: 16€ per família/grup' });
    insertSource(db, planId, 'gencat-agenda', 'g-1', gencatPayload({
      codi: '2026000001', denominaci: 'A', gratuita: 'Sí', entrades: 'Preu: 16€ per família/grup',
    }));

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].plan_id, planId);
    assert.equal(candidates[0].current_is_free, 1);
    assert.equal(candidates[0].new_is_free, 0);
  });
});

test('a single-source Gencat plan with a stale wrongly-paid value becomes a 0->1 candidate', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'b', original_title: 'B', is_free: 0, price_text: 'Entrada gratuïta' });
    insertSource(db, planId, 'gencat-agenda', 'g-2', gencatPayload({
      codi: '2026000002', denominaci: 'B', gratuita: 'No', entrades: 'Entrada gratuïta',
    }));

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].current_is_free, 0);
    assert.equal(candidates[0].new_is_free, 1);
  });
});

test('an ambiguous/mixed recomputed result is skipped, never a candidate', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'c', original_title: 'C', is_free: 0, price_text: null });
    insertSource(db, planId, 'gencat-agenda', 'g-3', gencatPayload({
      codi: '2026000003', denominaci: 'C', gratuita: 'No',
      entrades: 'Activitat gratuïta inclosa en el preu de l’entrada',
    }));

    const { candidates, skipped } = computeCandidates(db);
    assert.equal(candidates.length, 0);
    assert.equal(skipped.ambiguous, 1);
  });
});

test('a plan whose canonical value already matches the recomputed value is not a candidate', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'd', original_title: 'D', is_free: 1, price_text: 'Entrada gratuïta' });
    insertSource(db, planId, 'gencat-agenda', 'g-4', gencatPayload({
      codi: '2026000004', denominaci: 'D', gratuita: 'Sí', entrades: 'Entrada gratuïta',
    }));

    const { candidates, skipped } = computeCandidates(db);
    assert.equal(candidates.length, 0);
    assert.equal(skipped.unchanged, 1);
  });
});

test('a multi-source plan is never a candidate, even if the Gencat source alone would qualify', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'e', original_title: 'E (5387-style)', is_free: 1, price_text: 'Accés lliure a la festa. Amb tiquet: 5 €' });
    insertSource(db, planId, 'gencat-agenda', 'g-5a', gencatPayload({
      codi: '2026000005', denominaci: 'E', gratuita: 'Sí', entrades: '',
    }));
    insertSource(db, planId, 'gencat-agenda', 'g-5b', gencatPayload({
      codi: '2026000005', denominaci: 'E', gratuita: 'No', entrades: 'Accés lliure a la festa. Amb tiquet: 5 €',
    }));

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 0, 'multi-source plans must never be touched, matching the 5387 exclusion');
  });
});

test('a DIBA-only single-source plan is never a candidate', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'f', original_title: 'F', is_free: null, price_text: null });
    insertSource(db, planId, 'diba-museus', 'd-1', { preu: null });

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 0, 'matches the 4735 exclusion: DIBA plans are out of scope for this backfill');
  });
});

test('a recomputed FREE result that still trips the independent risk sweep is skipped, not proposed', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'g', original_title: 'G', is_free: 0, price_text: null });
    insertSource(db, planId, 'gencat-agenda', 'g-6', gencatPayload({
      codi: '2026000006', denominaci: 'G', gratuita: 'No',
      // Not caught by the deployed CONDITIONAL_RE (only the narrower "targeta
      // de soci/club/membre/fidelitat" is a keyword there), but the script's
      // own broader independent sweep (bare "targeta") is a second,
      // deliberately more conservative gate.
      entrades: 'Entrada gratuïta. Es pot pagar amb targeta a la cafeteria.',
    }));

    const { candidates, skipped } = computeCandidates(db);
    assert.equal(candidates.length, 0);
    assert.equal(skipped.riskSweep, 1);
  });
});

test('an unparseable source payload is skipped, not proposed', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'h', original_title: 'H', is_free: 0, price_text: null });
    const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
    db.prepare(`
      INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
      VALUES (?, ?, 'g-7', 'not valid json {{{', ?, ?)
    `).run(planId, source.id, NOW, NOW);

    const { candidates, skipped } = computeCandidates(db);
    assert.equal(candidates.length, 0);
    assert.equal(skipped.parseError, 1);
  });
});

test('applyBackfill writes only is_free, touches no unrelated column, and its rollback SQL exactly restores the prior state', () => {
  withTestDatabase((db) => {
    const paidToFreeId = insertPlan(db, {
      fingerprint: 'j', original_title: 'J', is_free: 0, price_text: 'Entrada gratuïta',
      start_date: '2026-11-01', end_date: '2026-11-01',
    });
    insertSource(db, paidToFreeId, 'gencat-agenda', 'g-9', gencatPayload({
      codi: '2026000009', denominaci: 'J', gratuita: 'No', entrades: 'Entrada gratuïta',
    }));
    const freeToPaidId = insertPlan(db, {
      fingerprint: 'k', original_title: 'K', is_free: 1, price_text: 'Preu: 16€ per família/grup',
      start_date: '2026-11-02', end_date: '2026-11-02',
    });
    insertSource(db, freeToPaidId, 'gencat-agenda', 'g-10', gencatPayload({
      codi: '2026000010', denominaci: 'K', gratuita: 'Sí', entrades: 'Preu: 16€ per família/grup',
    }));
    // A control plan that must not be touched by this run at all.
    const untouchedId = insertPlan(db, {
      fingerprint: 'l', original_title: 'L', is_free: 1, price_text: 'Entrada gratuïta',
      start_date: '2026-11-03', end_date: '2026-11-03',
    });
    insertSource(db, untouchedId, 'gencat-agenda', 'g-11', gencatPayload({
      codi: '2026000011', denominaci: 'L', gratuita: 'Sí', entrades: 'Entrada gratuïta',
    }));

    const before = db.prepare('SELECT id, is_free, price_text, original_title, updated_at FROM plans ORDER BY id').all();

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 2);

    const { changed } = applyBackfill(db, candidates);
    assert.equal(changed, 2);

    const after = db.prepare('SELECT id, is_free, price_text, original_title, updated_at FROM plans ORDER BY id').all();
    const afterById = new Map(after.map((row) => [row.id, row]));

    assert.equal(afterById.get(paidToFreeId).is_free, 1);
    assert.equal(afterById.get(freeToPaidId).is_free, 0);
    assert.equal(afterById.get(untouchedId).is_free, 1, 'a plan with no eligible change must stay exactly as it was');

    // Only is_free may differ; every other column, for every row, is byte-identical.
    for (const beforeRow of before) {
      const afterRow = afterById.get(beforeRow.id);
      assert.equal(afterRow.price_text, beforeRow.price_text);
      assert.equal(afterRow.original_title, beforeRow.original_title);
      assert.equal(afterRow.updated_at, beforeRow.updated_at);
    }

    // The rollback artifact's SQL, applied verbatim, must exactly undo the write.
    const rollbackStatements = candidates.map((c) => `UPDATE plans SET is_free = ${c.current_is_free === null ? 'NULL' : c.current_is_free} WHERE id = ${c.plan_id};`);
    for (const statement of rollbackStatements) db.exec(statement);
    const restored = db.prepare('SELECT id, is_free FROM plans ORDER BY id').all();
    for (const beforeRow of before) {
      const restoredRow = restored.find((r) => r.id === beforeRow.id);
      assert.equal(restoredRow.is_free, beforeRow.is_free, `plan ${beforeRow.id} did not roll back to its exact prior is_free value`);
    }
  });
});

test('applyBackfill refuses to write if the fresh in-transaction candidate set no longer matches the pre-check list (closes a TOCTOU window)', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'm', original_title: 'M', is_free: 0, price_text: 'Entrada gratuïta' });
    insertSource(db, planId, 'gencat-agenda', 'g-12', gencatPayload({
      codi: '2026000012', denominaci: 'M', gratuita: 'No', entrades: 'Entrada gratuïta',
    }));

    const { candidates: precheck } = computeCandidates(db);
    assert.equal(precheck.length, 1);

    // Simulate a concurrent import committing a payload change between the
    // outer pre-check and the write: the plan is no longer eligible (its
    // canonical value already matches what the payload would now produce).
    db.prepare('UPDATE plans SET is_free = 1 WHERE id = ?').run(planId);

    assert.throws(
      () => applyBackfill(db, precheck),
      /fresh in-transaction candidate set.*differs from the pre-check set/,
    );
    // No partial write: the row is exactly what the simulated concurrent
    // import left it as, not reverted, not overwritten.
    assert.equal(db.prepare('SELECT is_free FROM plans WHERE id = ?').get(planId).is_free, 1);
  });
});

test('a NULL -> 1 candidate is produced when the canonical value was never resolved', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'i', original_title: 'I', is_free: null, price_text: null });
    insertSource(db, planId, 'gencat-agenda', 'g-8', gencatPayload({
      codi: '2026000008', denominaci: 'I', gratuita: 'No', entrades: 'Activitat gratuïta',
    }));

    const { candidates } = computeCandidates(db);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].current_is_free, null);
    assert.equal(candidates[0].new_is_free, 1);
  });
});
