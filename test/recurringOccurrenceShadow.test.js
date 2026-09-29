import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { runGencatShadowReconciliation } from '../backend/src/deduplication/recurringOccurrenceShadow.js';
import { RecurringProductionAppliedGroupRepository } from '../backend/src/db/repositories/recurringProductionAppliedGroup.repository.js';

const NOW = '2026-09-29T10:00:00.000Z';

function insertPlan(db, { title = 'Test Production', venue = 'Test Venue', startDate = '2026-10-01', endDate = startDate } = {}) {
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_language, original_title, start_date, end_date, permanent,
      venue_name, municipality, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'ca', ?, ?, ?, 0, ?, 'Barcelona', 70, 'active', ?, ?)
  `).run(`fp|${title}|${venue}|${Math.random()}`, title, startDate, endDate, venue, NOW, NOW).lastInsertRowid);
}

function insertGencatSource(db, planId, sourceRecordId, lastSeenAt = NOW) {
  const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
  return Number(db.prepare(`
    INSERT INTO plan_sources (plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at)
    VALUES (?, ?, ?, '{}', ?, ?)
  `).run(planId, source.id, sourceRecordId, NOW, lastSeenAt).lastInsertRowid);
}

function insertOccurrence(db, planSourceId, occurrenceKey, localDate, status = 'active') {
  return Number(db.prepare(`
    INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, 'Europe/Madrid', ?, ?, ?, ?)
  `).run(planSourceId, occurrenceKey, localDate, status, NOW, NOW, NOW).lastInsertRowid);
}

function insertImportRun(db, sourceId, { fetched, errors, status = 'completed', startedAt = NOW }) {
  return Number(db.prepare(`
    INSERT INTO import_runs (source_id, started_at, finished_at, status, fetched, inserted, updated, skipped, invalid, errors)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
  `).run(sourceId, startedAt, NOW, status, fetched, errors).lastInsertRowid);
}

function applyGroup(db, { title, venue, canonicalPlanId }) {
  const groupKey = `gencat-agenda|${title}|${venue}`;
  new RecurringProductionAppliedGroupRepository(db).create({ groupKey, source: 'gencat-agenda', canonicalPlanId, appliedBy: 'test' });
  return groupKey;
}

function fakeLogger() {
  const lines = [];
  return { log: (msg) => lines.push(msg), error: (msg) => lines.push(msg), lines };
}

function gencatSourceId(db) {
  return db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get().id;
}

// ============================================================================
// A/B: safe complete batch runs; zero stale -> concise summary only.
// ============================================================================

test('shadow: safe complete batch with zero stale sessions logs one concise SAFE summary line (test A, E)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001001@aaaaaaaaaaaaaaaa');
    insertOccurrence(db, ps1, '20261001001', '2026-10-01');
    applyGroup(db, { title: 'prod', venue: 'venue', canonicalPlanId });
    for (let i = 0; i < 10; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, {
      sourceId, runId, seenRecurringSessions: new Map([[canonicalPlanId, new Set(['20261001001'])]]), logger,
    });
    assert.equal(logger.lines.length, 1, 'zero stale: one concise summary line is enough');
    assert.match(logger.lines[0], /\[recurring-shadow\].*verdict=SAFE.*stale=0.*blocked=0/);

    assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE plan_source_id = ?').get(ps1).status, 'active', 'zero mutations (test L)');
  });
});

// ============================================================================
// B/C: unsafe batches (low volume, record errors) are skipped entirely.
// ============================================================================

test('shadow: an abnormally low fetched count skips reconciliation entirely, logging why (test B)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001002@aaaaaaaaaaaaaaaa');
    insertOccurrence(db, ps1, '20261001002', '2026-10-01');
    applyGroup(db, { title: 'prod2', venue: 'venue2', canonicalPlanId });
    for (let i = 0; i < 10; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 50, errors: 0 });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, { sourceId, runId, seenRecurringSessions: new Map(), logger });
    assert.equal(logger.lines.length, 1);
    assert.match(logger.lines[0], /verdict=UNSAFE/);
    assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE plan_source_id = ?').get(ps1).status, 'active', 'no group was ever evaluated');
  });
});

test('shadow: any batch-level record error skips reconciliation entirely (test C)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 2 });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, { sourceId, runId, seenRecurringSessions: new Map(), logger });
    assert.match(logger.lines[0], /verdict=UNSAFE/);
    assert.match(logger.lines[0], /error/);
  });
});

// test D ("fatal importer failure -> shadow never runs") is structural: see
// importGencat.js — runGencatShadowReconciliation() is only ever called AFTER
// `await importer.run()` resolves without throwing; a thrown/fatal import
// never reaches that line at all. Covered by inspection, not a unit test
// (there is nothing to call if run() never returns).

// ============================================================================
// F: a real stale candidate is logged as WOULD_RETIRE but never touched.
// ============================================================================

test('shadow: a stale session is logged as WOULD_RETIRE, occurrence remains active, no canonical date write (test F, L)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db, { startDate: '2026-10-01', endDate: '2026-12-01' });
    // The vanishing session's plan_source was last touched well BEFORE this
    // batch — exactly what a real stale case looks like (this run never saw
    // it again, so it was never re-touched).
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001010@aaaaaaaaaaaaaaaa', '2026-08-01T00:00:00.000Z');
    const ps2 = insertGencatSource(db, canonicalPlanId, '20261001011@bbbbbbbbbbbbbbbb');
    const occ1 = insertOccurrence(db, ps1, '20261001010', '2026-10-01');
    insertOccurrence(db, ps2, '20261001011', '2026-12-01');
    applyGroup(db, { title: 'prod3', venue: 'venue3', canonicalPlanId });
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    // Only session 20261001011 was seen this run — 20261001010 has vanished.
    runGencatShadowReconciliation(db, {
      sourceId, runId, seenRecurringSessions: new Map([[canonicalPlanId, new Set(['20261001011'])]]), logger,
    });

    assert.ok(logger.lines.some((l) => l.includes('stale=1')));
    assert.ok(logger.lines.some((l) => l.includes('WOULD_RETIRE=1') && l.includes('20261001010')));
    assert.ok(logger.lines.some((l) => l.includes('no write performed')));

    const occurrence = db.prepare('SELECT status FROM plan_occurrences WHERE id = ?').get(occ1);
    assert.equal(occurrence.status, 'active', 'shadow mode never retires anything');
    const plan = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
    assert.equal(plan.start_date, '2026-10-01', 'canonical dates are never touched by shadow mode');
    assert.equal(plan.end_date, '2026-12-01');
  });
});

// ============================================================================
// G: mass-loss guard blocks a group; H: source-row contradiction blocks a
// candidate. Neither ever writes.
// ============================================================================

test('shadow: a group losing more than 50% of its occurrences is blocked, not retired (test G)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db);
    const sourceIds = [];
    for (let i = 0; i < 4; i += 1) {
      // All but the surviving session (index 0) predate this batch, exactly
      // like a genuine "no longer in the feed" case.
      const lastSeenAt = i === 0 ? NOW : '2026-08-01T00:00:00.000Z';
      const ps = insertGencatSource(db, canonicalPlanId, `2026100102${i}@aaaaaaaaaaaaaaaa`, lastSeenAt);
      insertOccurrence(db, ps, `2026100102${i}`, '2026-10-01');
      sourceIds.push(ps);
    }
    applyGroup(db, { title: 'prod4', venue: 'venue4', canonicalPlanId });
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    // Only 1 of 4 sessions still seen -> 3/4 = 75% loss, exceeds the 50% ceiling.
    runGencatShadowReconciliation(db, {
      sourceId, runId, seenRecurringSessions: new Map([[canonicalPlanId, new Set(['20261001020'])]]), logger,
    });
    assert.ok(logger.lines.some((l) => l.includes('BLOCKED')));
    assert.ok(logger.lines.some((l) => l.includes('blocked=3')));
    for (const ps of sourceIds) {
      assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE plan_source_id = ?').get(ps).status, 'active');
    }
  });
});

test('shadow: a source-row contradiction blocks the candidate without retiring it (test H)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const batchStartedAt = '2026-09-29T10:00:00.000Z';
    const canonicalPlanId = insertPlan(db);
    const ps1 = insertGencatSource(db, canonicalPlanId, '20261001030@aaaaaaaaaaaaaaaa', '2026-09-29T10:05:00.000Z'); // touched AFTER batch start
    const occ1 = insertOccurrence(db, ps1, '20261001030', '2026-10-01');
    applyGroup(db, { title: 'prod5', venue: 'venue5', canonicalPlanId });
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0, startedAt: batchStartedAt });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, { sourceId, runId, seenRecurringSessions: new Map(), logger });
    assert.ok(logger.lines.some((l) => l.includes('blockedCandidates=1')));
    assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE id = ?').get(occ1).status, 'active');
  });
});

// ============================================================================
// I/J: multi-venue and old-format-key correctness inside the shadow path.
// ============================================================================

test('shadow: a multi-venue session present via any variant is never a false stale (test I)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db);
    const codi = '20261001040';
    const ps1 = insertGencatSource(db, canonicalPlanId, `${codi}@aaaaaaaaaaaaaaaa`);
    insertGencatSource(db, canonicalPlanId, `${codi}@bbbbbbbbbbbbbbbb`);
    insertOccurrence(db, ps1, codi, '2026-10-01');
    applyGroup(db, { title: 'prod6', venue: 'venue6', canonicalPlanId });
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, {
      sourceId, runId, seenRecurringSessions: new Map([[canonicalPlanId, new Set([codi])]]), logger,
    });
    assert.ok(logger.lines[0].includes('stale=0'));
  });
});

test('shadow: an old-format (pre-4C.6) occurrence_key is correctly reconciled (test J)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const canonicalPlanId = insertPlan(db);
    const oldFormatId = '20261001050@aaaaaaaaaaaaaaaa';
    const ps1 = insertGencatSource(db, canonicalPlanId, oldFormatId);
    insertOccurrence(db, ps1, oldFormatId, '2026-10-01'); // pre-4C.6: occurrence_key = full source_record_id
    applyGroup(db, { title: 'prod7', venue: 'venue7', canonicalPlanId });
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    // Seen-set uses the bare codi (as the live importer always reports it).
    runGencatShadowReconciliation(db, {
      sourceId, runId, seenRecurringSessions: new Map([[canonicalPlanId, new Set(['20261001050'])]]), logger,
    });
    assert.ok(logger.lines[0].includes('stale=0'), 'correctly recognized despite the old occurrence_key format');
  });
});

// ============================================================================
// K: ordinary non-applied Gencat plans are structurally never evaluated.
// ============================================================================

test('shadow: an ordinary non-applied Gencat plan is never evaluated or touched (test K)', () => {
  withTestDatabase((db) => {
    const sourceId = gencatSourceId(db);
    const ordinaryPlanId = insertPlan(db, { title: 'Ordinary show' });
    const ps1 = insertGencatSource(db, ordinaryPlanId, '20261001060@aaaaaaaaaaaaaaaa');
    insertOccurrence(db, ps1, '20261001060', '2026-10-01'); // hypothetical; ordinary plans don't normally get occurrences
    for (let i = 0; i < 5; i += 1) insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });
    const runId = insertImportRun(db, sourceId, { fetched: 2000, errors: 0 });

    const logger = fakeLogger();
    runGencatShadowReconciliation(db, { sourceId, runId, seenRecurringSessions: new Map(), logger });
    assert.match(logger.lines[0], /groups=0/, 'no applied groups exist, the ordinary plan is never in scope at all');
    assert.equal(db.prepare('SELECT status FROM plan_occurrences WHERE plan_source_id = ?').get(ps1).status, 'active');
  });
});
