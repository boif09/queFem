// Incremental plan_occurrences maintenance for a single just-persisted
// plan_sources row belonging to an ALREADY-APPLIED recurring group
// (Phase 4C.6B). This is the ongoing counterpart to
// scripts/consolidate-recurring-group.js's one-off batch collapsing: the
// consolidation script only ever runs once per group, so without this, a
// brand new future Gencat record for an already-consolidated production
// would correctly attach to the canonical plan (see
// GencatAgendaImporter.getTargetPlanId()) but would never get a
// plan_occurrence row — making that new session invisible to
// occurrence-derived discovery/date semantics.
//
// Uses the SAME sessionIdentifier() as the consolidation script (imported
// from recurringOccurrenceIdentity.js) so the two can never disagree on what
// counts as "the same real session". Unlike the batch script, this works
// from ONE incoming record's own known date rather than re-deriving dates
// from `plans.start_date` — after consolidation every sibling plan_sources
// row shares the canonical plan's single start_date/end_date, so per-row
// dates can no longer be read back off the `plans` table.
import { sessionIdentifier } from './recurringOccurrenceIdentity.js';

const OCCURRENCE_TIMEZONE = 'Europe/Madrid';

// Every plan_sources row currently attached to `planId` for `sourceKey`
// whose sessionIdentifier matches the incoming record's is the SAME real
// session (whether it's an earlier-seen venue variant, or a stale row from
// before a payload hash change). The lowest plan_source.id among them is the
// representative — since plan_sources.id is AUTOINCREMENT and imports are
// processed strictly in order, the representative chosen the first time a
// session is ever seen can never change on a later import (a later-arriving
// row can never have a lower id), keeping this idempotent by construction —
// matching the batch script's own representative-selection rule exactly.
function findRepresentativePlanSourceId(db, { planId, sourceKey, sessionId }) {
  const siblings = db.prepare(`
    SELECT ps.id AS plan_source_id, ps.source_record_id
    FROM plan_sources ps
    JOIN sources s ON s.id = ps.source_id
    WHERE ps.plan_id = ? AND s.key = ?
  `).all(planId, sourceKey);
  const matchingIds = siblings
    .filter((row) => sessionIdentifier(sourceKey, row.source_record_id) === sessionId)
    .map((row) => row.plan_source_id);
  return matchingIds.length ? Math.min(...matchingIds) : null;
}

// Keeps the canonical plan's start_date/end_date summary fields honest
// against its full active occurrence set (mirrors
// applyConsolidation()'s updateCanonicalDates in the consolidation script).
// Most reads already prefer occurrence-derived dates once occurrences exist
// (see occurrenceSql.js), so this is a defensive consistency measure — not
// required for discovery/sort/retention correctness — specifically so a
// newly-imported future occurrence can never leave an older, now-stale
// canonical end_date behind for anything that reads the raw plan row
// directly.
function maintainCanonicalDateRange(db, planId, updatedAt) {
  const range = db.prepare(`
    SELECT MIN(o.local_date) AS start_date, MAX(o.local_date) AS end_date
    FROM plan_occurrences o
    JOIN plan_sources ps ON ps.id = o.plan_source_id
    WHERE ps.plan_id = ? AND o.status = 'active'
  `).get(planId);
  if (!range.start_date || !range.end_date) return;
  const current = db.prepare('SELECT start_date, end_date FROM plans WHERE id = ?').get(planId);
  if (current.start_date === range.start_date && current.end_date === range.end_date) return;
  db.prepare('UPDATE plans SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?')
    .run(range.start_date, range.end_date, updatedAt, planId);
}

// Called from GencatAgendaImporter.afterPersist() only when the record's
// groupKey has an applied-group mapping (see
// recurringProductionAppliedGroup.repository.js) — never for ordinary,
// non-applied Gencat records, which are unaffected by this module entirely.
// Groups consolidated by scripts/consolidate-recurring-group.js BEFORE
// Phase 4C.6 used the full hash-suffixed source_record_id as occurrence_key
// (Phase 4C.6 switched to the bare sessionIdentifier). Upserting with a
// freshly-computed sessionIdentifier key here would not find that
// already-existing row (different key string, same plan_source_id) and would
// insert a SECOND, duplicate occurrence for the same real session instead of
// updating it. The occurrence_key's exact value only needs to be a stable
// idempotency token scoped to its plan_source_id — not any particular
// format — so this always reuses whatever key the representative's
// occurrence already has, and only mints the (new, bare-codi) sessionId as a
// fallback when creating a real session's occurrence for the very first
// time.
function existingOccurrenceKey(db, planSourceId) {
  return db.prepare('SELECT occurrence_key FROM plan_occurrences WHERE plan_source_id = ? ORDER BY id LIMIT 1')
    .get(planSourceId)?.occurrence_key ?? null;
}

export function maintainRecurringOccurrence(db, occurrenceRepository, {
  planId, sourceKey, sourceRecordId, localDate, seenAt,
}) {
  const sessionId = sessionIdentifier(sourceKey, sourceRecordId);
  const representativePlanSourceId = findRepresentativePlanSourceId(db, { planId, sourceKey, sessionId });
  if (representativePlanSourceId === null) return; // defensive: the just-persisted row should always match itself
  const occurrenceKey = existingOccurrenceKey(db, representativePlanSourceId) ?? sessionId;
  occurrenceRepository.upsert(representativePlanSourceId, {
    occurrenceKey,
    localDate,
    timezone: OCCURRENCE_TIMEZONE,
    status: 'active',
  }, { seenAt });
  maintainCanonicalDateRange(db, planId, seenAt);
}
