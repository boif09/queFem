// Phase 4C.6D: wires Phase 4C.6C's stale-occurrence reconciliation logic into
// the normal Gencat import lifecycle in SHADOW MODE — it evaluates and logs
// what it WOULD retire, but never calls retireById(), never updates canonical
// dates, and never mutates plan_occurrences. There is no runtime flag that
// turns this into a write path; enabling real writes is a future phase
// (4C.6E) that will call scripts/reconcile-recurring-occurrences.js's logic
// (or a promoted version of this module) explicitly, not a toggle here.
//
// stale = sessions dated today or later that vanished from the feed (a possible cancellation: the real signal);
// expired = sessions already held that left the feed as expected (counted, never a candidate); blocked = anything
// the safety checks refuse to judge.
//
// Reuses every piece of Phase 4C.6C's core module verbatim — no reconciliation
// logic is duplicated between the standalone CLI, this shadow path, and any
// future write path.
import {
  evaluateBatchSafety,
  evaluateGroupSafety,
  computeStaleOccurrenceCandidates,
  computeCanonicalDateRangeAfterRetirement,
} from './recurringOccurrenceReconciliation.js';

const RECENT_RUNS_FOR_MEDIAN = 10;

// Gencat only publishes current events (the importer asks for data_fi >= today), so a session that has already been
// held always drops out of the feed. That is expected, not a signal: only a session dated today or later that
// vanishes can mean a cancellation. Dates are plain Europe/Madrid calendar days.
export function madridToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function appliedGencatGroups(db) {
  return db.prepare(`
    SELECT group_key, canonical_plan_id FROM recurring_production_applied_groups WHERE source = 'gencat-agenda'
  `).all();
}

// Called from importGencat.js AFTER importer.run() has already resolved
// successfully — a throw from this function must never be interpreted as the
// import itself having failed (the import's own writes already committed,
// record by record, before this ever runs), but it must also never be
// silently swallowed (see importGencat.js's own try/catch around this call).
export function runGencatShadowReconciliation(db, {
  sourceId, runId, seenRecurringSessions, logger = console, today = madridToday(),
}) {
  const run = db.prepare('SELECT fetched, errors, started_at FROM import_runs WHERE id = ?').get(runId);
  if (!run) throw new Error(`[recurring-shadow] could not load import_runs row ${runId} for shadow evaluation.`);

  const recentFetchedCounts = db.prepare(`
    SELECT fetched FROM import_runs WHERE source_id = ? AND status = 'completed' ORDER BY id DESC LIMIT ?
  `).all(sourceId, RECENT_RUNS_FOR_MEDIAN).map((r) => r.fetched);

  const safety = evaluateBatchSafety({ errors: run.errors, fetched: run.fetched, recentFetchedCounts });
  const ts = new Date().toISOString();
  if (!safety.safe) {
    logger.log(`[recurring-shadow] ts=${ts} runId=${runId} fetched=${run.fetched} verdict=UNSAFE reason="${safety.reasons.join('; ')}" — skipped entirely.`);
    return;
  }

  const groups = appliedGencatGroups(db);
  let totalStale = 0;
  let totalExpired = 0;
  let totalBlocked = 0;
  const detailLines = [];

  for (const group of groups) {
    const seenSessionIds = seenRecurringSessions.get(group.canonical_plan_id) || new Set();
    // The mass-loss ceiling compares sessions that vanished while still upcoming against the upcoming ones, so the
    // natural passing of dates can never trip it.
    const existingCount = db.prepare(`
      SELECT COUNT(*) n FROM plan_occurrences po JOIN plan_sources ps ON ps.id = po.plan_source_id
      WHERE ps.plan_id = ? AND po.status = 'active' AND po.local_date >= ?
    `).get(group.canonical_plan_id, today).n;
    const { candidates: allCandidates, blocked } = computeStaleOccurrenceCandidates(db, {
      canonicalPlanId: group.canonical_plan_id,
      sourceKey: 'gencat-agenda',
      seenSessionIds,
      batchStartedAt: run.started_at,
    });
    const candidates = allCandidates.filter((candidate) => candidate.local_date >= today);
    totalExpired += allCandidates.length - candidates.length;
    totalBlocked += blocked.length;

    if (candidates.length === 0 && blocked.length === 0) continue;

    const groupSafety = evaluateGroupSafety({ candidateCount: candidates.length, existingActiveCount: existingCount });
    if (!groupSafety.safe) {
      totalBlocked += candidates.length;
      detailLines.push(`[recurring-shadow]   group=${group.group_key} canonical=${group.canonical_plan_id} existing=${existingCount} seen=${seenSessionIds.size} BLOCKED reason="${groupSafety.reasons.join('; ')}"`);
      continue;
    }
    if (candidates.length > 0) {
      totalStale += candidates.length;
      const range = computeCanonicalDateRangeAfterRetirement(db, group.canonical_plan_id, candidates.map((c) => c.occurrence_id));
      const proposedRange = range.changed ? `${range.start_date}..${range.end_date}` : 'unchanged';
      detailLines.push(`[recurring-shadow]   group=${group.group_key} canonical=${group.canonical_plan_id} existing=${existingCount} seen=${seenSessionIds.size} WOULD_RETIRE=${candidates.length} sessions=[${candidates.map((c) => c.sessionId).join(',')}] proposedCanonicalRange=${proposedRange} (no write performed)`);
    }
    if (blocked.length > 0) {
      detailLines.push(`[recurring-shadow]   group=${group.group_key} canonical=${group.canonical_plan_id} blockedCandidates=${blocked.length} reason="${blocked[0].reason}"`);
    }
  }

  if (totalStale === 0 && totalBlocked === 0) {
    logger.log(`[recurring-shadow] ts=${ts} runId=${runId} fetched=${run.fetched} verdict=SAFE groups=${groups.length} stale=0 blocked=0 expired=${totalExpired}`);
    return;
  }
  logger.log(`[recurring-shadow] ts=${ts} runId=${runId} fetched=${run.fetched} verdict=SAFE groups=${groups.length} stale=${totalStale} blocked=${totalBlocked} expired=${totalExpired}`);
  for (const line of detailLines) logger.log(line);
}
