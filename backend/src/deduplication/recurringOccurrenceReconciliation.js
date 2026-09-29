// Phase 4C.6C: batch-level stale-occurrence reconciliation for already-applied
// Gencat recurring groups. Design-and-dry-run only — nothing in this module
// is wired into the live importer or ever writes without an explicit,
// separate caller choosing to. See scripts/reconcile-recurring-occurrences.js
// for the standalone dry-run tool built on top of this module.
//
// PROBLEM THIS SOLVES: Phase 4C.6B made the per-record importer correctly
// maintain plan_occurrences for NEW/changed sessions of an already-applied
// group, but it has no way to notice when Gencat stops publishing a
// previously-known session entirely — that occurrence would otherwise stay
// 'active' forever. This module defines, conservatively, when a batch's
// absence-evidence can be TRUSTED enough to retire an occurrence, and how to
// compute the resulting canonical date range — but performs no writes itself
// beyond the explicit retireStaleOccurrences() entry point, which every
// caller in this phase only ever invokes in dry-run/read mode.
//
// SAFETY PHILOSOPHY (per Phase 4C.6C task): false deletion is worse than
// missed cleanup. Every threshold here is deliberately conservative and
// grounded in real Gencat import history (511 real completed runs: fetched
// counts ranged 1966-4018, EVERY one of them had zero per-record errors —
// see evaluateBatchSafety()'s thresholds).
import { sessionIdentifier } from './recurringOccurrenceIdentity.js';

// Evidence-based from real production import_runs history (Phase 4C.6C
// analysis, 2026-09-29): 511 completed Gencat runs, fetched range 1966-4018,
// zero runs had errors > 0. MIN_ABSOLUTE_FETCHED sits far below the observed
// historical minimum (1966) so no genuine past successful run would ever be
// misclassified as unsafe, while still catching a catastrophically truncated
// response (e.g. an API outage that still returns HTTP 200 with a near-empty
// body). MIN_RELATIVE_FETCHED_FRACTION additionally protects against a
// slow, sustained partial degradation that a fixed floor alone wouldn't catch
// (e.g. the dataset naturally shrinking over months to just above the
// absolute floor, then a genuine partial-fetch bug crops up).
export const MIN_ABSOLUTE_FETCHED = 1000;
export const MIN_RELATIVE_FETCHED_FRACTION = 0.5;

// Section 2: "complete successful batch" definition. `errors` must be the
// count of ANY per-record processing error during this batch (not just fatal
// fetch errors) — deliberately stricter than the task's minimum bar, because
// a batch that had SOME bad records gives no positive evidence the REST of
// the feed was received intact either. `recentFetchedCounts` should be the
// `fetched` column from recent *completed* (not failed) historical runs,
// oldest-to-newest or in any order — only used to compute a median.
export function evaluateBatchSafety({ errors, fetched, recentFetchedCounts = [] }) {
  const reasons = [];
  if (!Number.isInteger(errors) || errors < 0) {
    reasons.push('errors count is missing or invalid — cannot confirm batch health');
  } else if (errors > 0) {
    reasons.push(`batch reported ${errors} error(s) — feed completeness cannot be trusted`);
  }
  if (!Number.isInteger(fetched) || fetched < 0) {
    reasons.push('fetched count is missing or invalid — cannot confirm feed size');
  } else {
    if (fetched < MIN_ABSOLUTE_FETCHED) {
      reasons.push(`fetched count ${fetched} is below the absolute safety floor of ${MIN_ABSOLUTE_FETCHED}`);
    }
    if (recentFetchedCounts.length > 0) {
      const sorted = [...recentFetchedCounts].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const floor = median * MIN_RELATIVE_FETCHED_FRACTION;
      if (fetched < floor) {
        reasons.push(`fetched count ${fetched} is below ${Math.round(MIN_RELATIVE_FETCHED_FRACTION * 100)}% of the recent median (${median}, from ${sorted.length} recent completed runs)`);
      }
    }
  }
  return { safe: reasons.length === 0, reasons };
}

// Section 4/7 (identity reconstruction, backward compatibility): reconstructs
// each EXISTING active occurrence's real-session identity from its
// representative plan_source's OWN source_record_id — never from
// occurrence_key directly. Groups consolidated before Phase 4C.6 used the
// full hash-suffixed source_record_id as occurrence_key; Phase 4C.6B's
// maintainRecurringOccurrence() preserves whatever key already exists rather
// than rewriting it — so occurrence_key format varies by group history and
// must never be assumed to equal the current sessionIdentifier() output.
// Section 8 (past occurrences): scoped to status='active' occurrences only —
// inactive/retired occurrences are already excluded from "upcoming" by
// definition and are never reconsidered here.
export function existingActiveOccurrenceSessions(db, { canonicalPlanId, sourceKey }) {
  const rows = db.prepare(`
    SELECT po.id AS occurrence_id, po.local_date, po.plan_source_id, ps.source_record_id
    FROM plan_occurrences po
    JOIN plan_sources ps ON ps.id = po.plan_source_id
    JOIN sources s ON s.id = ps.source_id
    WHERE ps.plan_id = ? AND s.key = ? AND po.status = 'active'
  `).all(canonicalPlanId, sourceKey);
  return rows.map((row) => ({ ...row, sessionId: sessionIdentifier(sourceKey, row.source_record_id) }));
}

// Section 5 (source-row evidence): for each stale CANDIDATE, also reports
// whether its representative plan_source is still recent (last_seen_at
// within this batch's own timestamp window) — a candidate whose plan_source
// was ALSO just touched by this same batch is a contradiction (the session
// looks both "seen" via its source row and "absent" via our session
// reconstruction) and must never be silently retired; it is surfaced as a
// blocked candidate requiring investigation instead.
function sourceRowStillFresh(db, planSourceId, batchStartedAt) {
  const row = db.prepare('SELECT last_seen_at FROM plan_sources WHERE id = ?').get(planSourceId);
  return Boolean(row && batchStartedAt && row.last_seen_at >= batchStartedAt);
}

// Section 3/4: core comparison. `seenSessionIds` is the set of real-session
// identities (sessionIdentifier() output) observed in THIS group's records
// during the current complete, safe batch. Returns every existing active
// occurrence NOT in that set, split into safe candidates (retire-eligible)
// and blocked ones (source-row evidence contradicts staleness — see above).
export function computeStaleOccurrenceCandidates(db, { canonicalPlanId, sourceKey, seenSessionIds, batchStartedAt = null }) {
  const existing = existingActiveOccurrenceSessions(db, { canonicalPlanId, sourceKey });
  const missing = existing.filter((row) => !seenSessionIds.has(row.sessionId));
  const candidates = [];
  const blocked = [];
  for (const row of missing) {
    if (batchStartedAt && sourceRowStillFresh(db, row.plan_source_id, batchStartedAt)) {
      blocked.push({ ...row, reason: 'representative plan_source was touched by this same batch — contradicts staleness, refusing to guess' });
    } else {
      candidates.push(row);
    }
  }
  return { candidates, blocked };
}

// Section 10 (mass-deletion safeguards): a single group suddenly losing MOST
// or ALL of its occurrences in one batch is far more likely to indicate a
// tracking bug or an unusually-shaped feed response than 5+ real productions
// being cancelled simultaneously. Conservative, evidence-free thresholds
// (no historical "mass loss" event exists in production to calibrate
// against, so these lean maximally cautious per the task's own instruction
// not to invent large arbitrary numbers) — any candidate set failing this
// check is reported but NOT eligible for retirement without a human looking
// at it first.
export const MAX_STALE_FRACTION_PER_GROUP = 0.5;

export function evaluateGroupSafety({ candidateCount, existingActiveCount }) {
  if (existingActiveCount === 0) return { safe: true, reasons: [] };
  const fraction = candidateCount / existingActiveCount;
  if (fraction > MAX_STALE_FRACTION_PER_GROUP) {
    return {
      safe: false,
      reasons: [`${candidateCount}/${existingActiveCount} (${Math.round(fraction * 100)}%) of active occurrences would be retired — exceeds the ${Math.round(MAX_STALE_FRACTION_PER_GROUP * 100)}% per-group safety ceiling, refusing to guess`],
    };
  }
  return { safe: true, reasons: [] };
}

// Section 9: recomputes a canonical plan's start_date/end_date from its
// REMAINING active occurrence set after a hypothetical (or real) retirement —
// same MIN/MAX-over-active-occurrences semantics introduced in Phase 4C.6B's
// maintainCanonicalDateRange(). If the retirement would leave ZERO active
// occurrences, start_date/end_date are deliberately left UNCHANGED (not
// nulled) — occurrenceSql.js's effectiveOccurrenceEndDate() already falls
// back, in that exact order, to (1) MAX date across ANY occurrence including
// now-inactive ones, then (2) the plan's own end_date/start_date columns —
// so leaving them as the last known real values is the correct, already-
// supported degradation path, not a gap this module needs to invent policy
// for. The canonical plan itself is never deleted or deactivated here: it
// stays protected by planAliasGuard exactly as it is today, indefinitely.
export function computeCanonicalDateRangeAfterRetirement(db, canonicalPlanId, retiredOccurrenceIds) {
  const placeholders = retiredOccurrenceIds.length ? retiredOccurrenceIds.map(() => '?').join(',') : null;
  const excludeClause = placeholders ? `AND po.id NOT IN (${placeholders})` : '';
  const range = db.prepare(`
    SELECT MIN(po.local_date) AS start_date, MAX(po.local_date) AS end_date, COUNT(*) AS remaining
    FROM plan_occurrences po
    JOIN plan_sources ps ON ps.id = po.plan_source_id
    WHERE ps.plan_id = ? AND po.status = 'active' ${excludeClause}
  `).get(canonicalPlanId, ...retiredOccurrenceIds);
  if (!range.start_date || !range.end_date) {
    return { changed: false, remaining: range.remaining, start_date: null, end_date: null, reason: 'no active occurrences would remain — canonical start_date/end_date left unchanged (protected plan, existing fallback semantics apply)' };
  }
  const current = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
  const changed = current.start_date !== range.start_date || current.end_date !== range.end_date;
  return { changed, remaining: range.remaining, start_date: range.start_date, end_date: range.end_date };
}

// The actual (currently dry-run-only, per Phase 4C.6C scope) write entry
// point — kept separate and tiny so a future phase can authorize calling it
// for real without needing to re-review the analysis logic above. Every
// occurrence retirement plus the canonical date-range update happens in ONE
// transaction, so a failure partway through never leaves a group half-
// reconciled (section 15: transactional safety).
export function retireStaleOccurrences(db, occurrenceRepository, { canonicalPlanId, candidates, seenAt }) {
  return db.transaction(() => {
    for (const candidate of candidates) occurrenceRepository.retireById(candidate.occurrence_id, seenAt);
    const range = computeCanonicalDateRangeAfterRetirement(db, canonicalPlanId, []);
    if (range.changed) {
      db.prepare('UPDATE plans SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?')
        .run(range.start_date, range.end_date, seenAt, canonicalPlanId);
    }
    return { retired: candidates.length, canonicalDateRange: range };
  })();
}
