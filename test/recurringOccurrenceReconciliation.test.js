import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { PlanOccurrenceRepository } from '../backend/src/db/repositories/planOccurrence.repository.js';
import { maintainRecurringOccurrence } from '../backend/src/deduplication/recurringOccurrenceMaintenance.js';
import {
  evaluateBatchSafety,
  evaluateGroupSafety,
  existingActiveOccurrenceSessions,
  computeStaleOccurrenceCandidates,
  computeCanonicalDateRangeAfterRetirement,
  retireStaleOccurrences,
  MIN_ABSOLUTE_FETCHED,
  MAX_STALE_FRACTION_PER_GROUP,
} from '../backend/src/deduplication/recurringOccurrenceReconciliation.js';

const NOW = '2026-09-29T10:00:00.000Z';

function insertPlan(db, { title = 'Test Production', venue = 'Test Venue', startDate = '2026-10-01', endDate = startDate } = {}) {
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent,
      venue_name, municipality, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', ?, ?, ?, 0, ?, 'Barcelona', 70, 'active', ?, ?)
  `).run(`fp|${title}|${venue}|${Math.random()}`, title, startDate, endDate, venue, NOW, NOW).lastInsertRowid);
}

function insertGencatSource(db, planId, sourceRecordId) {
  const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  return Number(db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, '{}', ?, ?)
  `).run(planId, source.id, sourceRecordId, NOW, NOW).lastInsertRowid);
}

function insertOccurrence(db, planSourceId, occurrenceKey, localDate, status = 'active') {
  return Number(db.prepare(`
    INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, 'Europe/Madrid', ?, ?, ?, ?)
  `).run(planSourceId, occurrenceKey, localDate, status, NOW, NOW, NOW).lastInsertRowid);
}

// ============================================================================
// Section 2 / test C, D: batch safety evaluation
// ============================================================================

test('evaluateBatchSafety: a complete batch matching historical norms is safe (test A baseline)', () => {
  const result = evaluateBatchSafety({ errors: 0, fetched: 2000, recentFetchedCounts: [1966, 1980, 1992, 2050, 4018] });
  assert.equal(result.safe, true);
  assert.deepEqual(result.reasons, []);
});

test('evaluateBatchSafety: any per-record error makes the batch unsafe (test D)', () => {
  const result = evaluateBatchSafety({ errors: 3, fetched: 2000, recentFetchedCounts: [1966, 1980] });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.some((r) => r.includes('error')));
});

test('evaluateBatchSafety: fetched count below the absolute floor is unsafe (test C — catastrophic truncation)', () => {
  const result = evaluateBatchSafety({ errors: 0, fetched: 50, recentFetchedCounts: [1966, 1980] });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.some((r) => r.includes('absolute safety floor')));
  assert.ok(MIN_ABSOLUTE_FETCHED > 50);
});

test('evaluateBatchSafety: fetched count below the relative median floor is unsafe (test C — partial feed)', () => {
  // Above the absolute floor (1000), but well below half of a healthy recent median (3000).
  const result = evaluateBatchSafety({ errors: 0, fetched: 1200, recentFetchedCounts: [3000, 3000, 3000, 3000, 3000] });
  assert.equal(result.safe, false);
  assert.ok(result.reasons.some((r) => r.includes('recent median')));
});

test('evaluateBatchSafety: missing/invalid errors or fetched counts are treated as unsafe, not assumed zero', () => {
  assert.equal(evaluateBatchSafety({ errors: undefined, fetched: 2000, recentFetchedCounts: [] }).safe, false);
  assert.equal(evaluateBatchSafety({ errors: 0, fetched: undefined, recentFetchedCounts: [] }).safe, false);
});

// ============================================================================
// Section 4/7, test I: existing-occurrence identity reconstruction,
// including backward compatibility with pre-4C.6 occurrence_key format.
// ============================================================================

test('existingActiveOccurrenceSessions: reconstructs session identity from source_record_id, not occurrence_key (test I)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const oldFormatSourceRecordId = '20260402090@8d7f24d46bb04e59';
    const planSourceId = insertGencatSource(db, canonicalPlanId, oldFormatSourceRecordId);
    // Pre-4C.6 style: occurrence_key IS the full source_record_id, not the bare codi.
    insertOccurrence(db, planSourceId, oldFormatSourceRecordId, '2026-10-04');

    const sessions = existingActiveOccurrenceSessions(db, { canonicalPlanId, sourceKey: 'gencat-agenda' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, '20260402090', 'reconstructed from source_record_id, correctly ignoring the old-format occurrence_key string');
  });
});

test('existingActiveOccurrenceSessions: only considers status=active occurrences (test 7 — past/inactive occurrences untouched)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const planSourceId = insertGencatSource(db, canonicalPlanId, '20260101001@aaaaaaaaaaaaaaaa');
    insertOccurrence(db, planSourceId, '20260101001', '2026-01-01', 'inactive');
    const sessions = existingActiveOccurrenceSessions(db, { canonicalPlanId, sourceKey: 'gencat-agenda' });
    assert.equal(sessions.length, 0, 'an already-inactive occurrence is never reconsidered');
  });
});

// ============================================================================
// Tests A, B, G, H: stale-candidate comparison
// ============================================================================

test('computeStaleOccurrenceCandidates: complete batch, all sessions still present -> removes nothing (test A)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001001@aaaaaaaaaaaaaaaa');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001002@bbbbbbbbbbbbbbbb');
    insertOccurrence(db, ps1, '20261001001', '2026-10-01');
    insertOccurrence(db, ps2, '20261001002', '2026-10-08');

    const seenSessionIds = new Set(['20261001001', '20261001002']);
    const { candidates, blocked } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds });
    assert.equal(candidates.length, 0);
    assert.equal(blocked.length, 0);
  });
});

test('computeStaleOccurrenceCandidates: one future session disappears from the feed -> stale candidate (test B)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001001@aaaaaaaaaaaaaaaa');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001002@bbbbbbbbbbbbbbbb');
    insertOccurrence(db, ps1, '20261001001', '2026-10-01');
    insertOccurrence(db, ps2, '20261001002', '2026-10-08');

    const seenSessionIds = new Set(['20261001001']); // codi 002 no longer in the feed
    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sessionId, '20261001002');
  });
});

test('computeStaleOccurrenceCandidates: multi-venue session — presence via ANY venue variant counts as seen (test G)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const codi = '20261001010';
    const ps1 = insertGencatSource(db, canonicalPlanId, `${codi}@aaaaaaaaaaaaaaaa`);
    insertGencatSource(db, canonicalPlanId, `${codi}@bbbbbbbbbbbbbbbb`); // second venue variant, no occurrence of its own
    insertOccurrence(db, ps1, codi, '2026-10-01'); // representative's occurrence

    // The feed pull only classified ONE of the two venue-variant records this
    // time (e.g. pagination order), but the codi itself is present — still seen.
    const seenSessionIds = new Set([codi]);
    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds });
    assert.equal(candidates.length, 0, 'the session is present via at least one venue variant, must not be flagged stale');
  });
});

test('computeStaleOccurrenceCandidates: genuinely distinct same-day codis are independent (test H)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001020@aaaaaaaaaaaaaaaa');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001021@bbbbbbbbbbbbbbbb');
    insertOccurrence(db, ps1, '20261001020', '2026-10-01');
    insertOccurrence(db, ps2, '20261001021', '2026-10-01');

    // Only one of the two same-day sessions is still in the feed.
    const seenSessionIds = new Set(['20261001020']);
    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sessionId, '20261001021', 'the other same-day session is untouched, independently evaluated');
  });
});

test('computeStaleOccurrenceCandidates: a hash-changed payload for the same codi is still seen, not stale (test E)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const codi = '20261001030';
    const ps1 = insertGencatSource(db, canonicalPlanId, `${codi}@aaaaaaaaaaaaaaaa`);
    insertOccurrence(db, ps1, codi, '2026-10-01');
    // A later import brought a changed payload -> new plan_sources row, but
    // the same bare codi. The feed pull's seen-set is built from bare codis,
    // so this is trivially still "seen" regardless of which exact hash suffix
    // the current record carries.
    insertGencatSource(db, canonicalPlanId, `${codi}@cccccccccccccccc`);

    const seenSessionIds = new Set([codi]);
    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds });
    assert.equal(candidates.length, 0);
  });
});

test('a moved-date codi is handled by the ALREADY-DEPLOYED incremental maintainer, not by reconciliation (test F)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const codi = '20261001040';
    const psOld = insertGencatSource(db, canonicalPlanId, `${codi}@aaaaaaaaaaaaaaaa`);
    // Establish the occurrence at the OLD date via the real incremental
    // maintainer, exactly as a live import would.
    const repository = new PlanOccurrenceRepository(db);
    maintainRecurringOccurrence(db, repository, { planId: canonicalPlanId, sourceKey: 'gencat-agenda', sourceRecordId: `${codi}@aaaaaaaaaaaaaaaa`, localDate: '2026-10-01', seenAt: NOW });
    assert.equal(db.prepare('SELECT local_date FROM plan_occurrences WHERE plan_source_id = ?').get(psOld).local_date, '2026-10-01');

    // A later import brings the SAME codi at a NEW date (a genuine upstream
    // date correction) — the real importer updates the SAME occurrence row
    // in place (Phase 4C.6B behavior), so there is nothing left for
    // reconciliation to do: no stale occurrence is ever created for the old
    // date in the first place.
    insertGencatSource(db, canonicalPlanId, `${codi}@dddddddddddddddd`);
    maintainRecurringOccurrence(db, repository, { planId: canonicalPlanId, sourceKey: 'gencat-agenda', sourceRecordId: `${codi}@dddddddddddddddd`, localDate: '2026-11-15', seenAt: NOW });

    const occurrences = db.prepare(`
      SELECT po.local_date FROM plan_occurrences po JOIN plan_sources ps ON ps.id = po.plan_source_id WHERE ps.plan_id = ?
    `).all(canonicalPlanId);
    assert.equal(occurrences.length, 1, 'still exactly one occurrence for this codi, now at the new date');
    assert.equal(occurrences[0].local_date, '2026-11-15');

    // Reconciliation with the codi correctly reported as seen finds nothing stale.
    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds: new Set([codi]) });
    assert.equal(candidates.length, 0);
  });
});

// ============================================================================
// Section 5: source-row evidence / blocked candidates
// ============================================================================

test('computeStaleOccurrenceCandidates: a candidate whose plan_source was JUST touched by this batch is blocked, not retired', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const batchStartedAt = '2026-09-29T10:00:00.000Z';
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001050@aaaaaaaaaaaaaaaa');
    db.prepare('UPDATE plan_sources SET last_seen_at = ? WHERE id = ?').run('2026-09-29T10:05:00.000Z', ps1); // touched AFTER batch start
    insertOccurrence(db, ps1, '20261001050', '2026-10-01');

    const { candidates, blocked } = computeStaleOccurrenceCandidates(db, {
      canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds: new Set(), batchStartedAt,
    });
    assert.equal(candidates.length, 0);
    assert.equal(blocked.length, 1, 'contradiction (source row fresh but session not in seen-set) must block, not silently retire');
  });
});

// ============================================================================
// Section 10: mass-deletion safeguard
// ============================================================================

test('evaluateGroupSafety: blocks retirement when too large a fraction of a group would be removed', () => {
  const unsafe = evaluateGroupSafety({ candidateCount: 8, existingActiveCount: 10 });
  assert.equal(unsafe.safe, false);
  assert.ok(unsafe.reasons[0].includes('%'));

  const safe = evaluateGroupSafety({ candidateCount: 1, existingActiveCount: 10 });
  assert.equal(safe.safe, true);

  assert.ok(MAX_STALE_FRACTION_PER_GROUP < 1, 'must never allow removing literally everything unchecked');
});

test('evaluateGroupSafety: a group with zero existing occurrences is trivially safe (nothing to remove)', () => {
  assert.equal(evaluateGroupSafety({ candidateCount: 0, existingActiveCount: 0 }).safe, true);
});

// ============================================================================
// Section 9, test J: canonical date-range recomputation, including the
// "all future occurrences disappear" lifecycle case.
// ============================================================================

test('computeCanonicalDateRangeAfterRetirement: recomputes MIN/MAX over the remaining active set', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db, { startDate: '2026-10-01', endDate: '2026-12-01' });
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001060@aaaaaaaaaaaaaaaa');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001061@bbbbbbbbbbbbbbbb');
    const occ1 = insertOccurrence(db, ps1, '20261001060', '2026-10-01');
    insertOccurrence(db, ps2, '20261001061', '2026-12-01');

    const range = computeCanonicalDateRangeAfterRetirement(db, canonicalPlanId, [occ1]);
    assert.equal(range.changed, true);
    assert.equal(range.start_date, '2026-12-01');
    assert.equal(range.end_date, '2026-12-01');
    assert.equal(range.remaining, 1);
  });
});

test('computeCanonicalDateRangeAfterRetirement: if ALL active occurrences would be removed, canonical dates are left UNCHANGED (test J)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db, { startDate: '2026-10-01', endDate: '2026-10-01' });
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001070@aaaaaaaaaaaaaaaa');
    const occ1 = insertOccurrence(db, ps1, '20261001070', '2026-10-01');

    const range = computeCanonicalDateRangeAfterRetirement(db, canonicalPlanId, [occ1]);
    assert.equal(range.changed, false, 'nothing left to compute a range from — deliberately not nulling out the last known dates');
    assert.equal(range.remaining, 0);

    const plan = db.prepare('SELECT status, start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
    assert.equal(plan.status, 'active', 'the canonical plan itself is never deactivated by this module');
    assert.equal(plan.start_date, '2026-10-01', 'left as the last known value, relying on occurrenceSql.js\'s existing any-occurrence/raw-column fallback');
  });
});

// ============================================================================
// retireStaleOccurrences: the actual (dry-run-only-called-in-this-phase)
// write path, transactional safety.
// ============================================================================

test('retireStaleOccurrences: retires the given occurrences and updates canonical dates atomically', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db, { startDate: '2026-10-01', endDate: '2026-12-01' });
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001080@aaaaaaaaaaaaaaaa');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001081@bbbbbbbbbbbbbbbb');
    const occ1 = insertOccurrence(db, ps1, '20261001080', '2026-10-01');
    insertOccurrence(db, ps2, '20261001081', '2026-12-01');

    const repository = new PlanOccurrenceRepository(db);
    const result = retireStaleOccurrences(db, repository, {
      canonicalPlanId,
      candidates: [{ occurrence_id: occ1 }],
      seenAt: NOW,
    });
    assert.equal(result.retired, 1);
    assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE id = ?').get(occ1).status, 'inactive', 'marked inactive, not physically deleted');
    assert.equal(db.prepare('SELECT id FROM plan_sources WHERE id = ?').get(ps1).id, ps1, 'the underlying plan_source/provenance is never touched');
    const plan = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
    assert.equal(plan.start_date, '2026-12-01', 'canonical start_date correctly advances to the remaining occurrence');
  });
});

// ============================================================================
// Regression: no effect on ordinary non-applied Gencat plans, or on other
// sources (Fever/DIBA/Ticketmaster).
// ============================================================================

test('reconciliation functions only ever touch the explicitly-scoped canonical plan id, never anything else', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db, { title: 'Applied production' });
    const unrelatedPlanId = insertPlan(db, { title: 'Unrelated ordinary Gencat plan' });
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001090@aaaaaaaaaaaaaaaa');
    const psUnrelated = insertGencatSource(db, unrelatedPlanId, '20261001091@bbbbbbbbbbbbbbbb');
    insertOccurrence(db, ps1, '20261001090', '2026-10-01');
    insertOccurrence(db, psUnrelated, '20261001091', '2026-10-01');

    const { candidates } = computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey: 'gencat-agenda', seenSessionIds: new Set() });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].plan_source_id, ps1, 'only the explicitly-scoped canonical plan is ever considered, never the unrelated one');
  });
});

test('reconciliation ignores occurrences from other sources entirely (Fever/DIBA/Ticketmaster unaffected)', () => {
  withTestDatabase((db) => {
    const canonicalPlanId = insertPlan(db);
    const gencatSource = insertGencatSource(db, canonicalPlanId, '20261001100@aaaaaaaaaaaaaaaa');
    insertOccurrence(db, gencatSource, '20261001100', '2026-10-01');

    const feverSource = db.prepare("SELECT id FROM sources WHERE key LIKE 'fever%' LIMIT 1").get();
    if (feverSource) {
      const feverPs = Number(db.prepare(`
        INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
        VALUES (?, ?, 'fever-unrelated-record', '{}', ?, ?)
      `).run(canonicalPlanId, feverSource.id, NOW, NOW).lastInsertRowid);
      insertOccurrence(db, feverPs, 'fever-session-key', '2026-10-15');
    }

    const sessions = existingActiveOccurrenceSessions(db, { canonicalPlanId, sourceKey: 'gencat-agenda' });
    assert.equal(sessions.length, 1, 'only the gencat-agenda-sourced occurrence is considered, any Fever occurrence on the same plan is untouched');
  });
});
