// Phase 4C.6C: standalone, READ-ONLY dry-run tool for stale recurring-
// occurrence reconciliation. Never writes to the database — there is
// deliberately no --apply flag yet (see backend/src/deduplication/
// recurringOccurrenceReconciliation.js's module header for the full
// rationale and the Phase 4C.6D write-path design this phase recommends but
// does not implement).
//
// What it does:
//   1. Performs one fresh, complete fetch of the live Gencat feed (the exact
//      same fetch()/normalize()/resolveAppliedCanonicalPlanId() logic the
//      real importer uses — reused directly from GencatAgendaImporter,
//      never persisting anything).
//   2. Evaluates whether THIS fetch is safe evidence for reconciliation
//      (evaluateBatchSafety(), grounded in real import_runs history).
//   3. If safe: for every currently-applied Gencat recurring group, compares
//      its existing active plan_occurrences against the real-session
//      identities seen in this fetch, reporting stale candidates, canonical
//      date-range implications, and any blocked/ambiguous cases.
//   4. If unsafe: reports why and stops — no group analysis is attempted.
//
// Usage: node scripts/reconcile-recurring-occurrences.js --dry-run
// (--dry-run is required and is currently the ONLY supported mode.)
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { GencatAgendaImporter } from '../backend/src/importers/gencatAgenda.importer.js';
import { sessionIdentifier } from '../backend/src/deduplication/recurringOccurrenceIdentity.js';
import {
  evaluateBatchSafety,
  evaluateGroupSafety,
  computeStaleOccurrenceCandidates,
  computeCanonicalDateRangeAfterRetirement,
} from '../backend/src/deduplication/recurringOccurrenceReconciliation.js';

const RECENT_RUNS_FOR_MEDIAN = 10;

function recentFetchedCounts(db, sourceId) {
  return db.prepare(`
    SELECT fetched FROM import_runs
    WHERE source_id = ? AND status = 'completed'
    ORDER BY id DESC LIMIT ?
  `).all(sourceId, RECENT_RUNS_FOR_MEDIAN).map((r) => r.fetched);
}

function appliedGencatGroups(db) {
  return db.prepare(`
    SELECT group_key, canonical_plan_id FROM recurring_production_applied_groups WHERE source = 'gencat-agenda'
  `).all();
}

async function fetchAndClassify(importer) {
  // Reuses the importer's own fetch()/normalize()/getExternalId()/
  // resolveAppliedCanonicalPlanId() exactly as the real import does — this
  // function never calls persist()/afterPersist(), so it makes zero writes.
  const classified = [];
  let fetched = 0;
  let errors = 0;
  for await (const record of importer.fetch()) {
    fetched += 1;
    try {
      const normalized = importer.normalize(record);
      if (!normalized) continue;
      const canonicalPlanId = importer.resolveAppliedCanonicalPlanId(normalized.plan);
      if (!canonicalPlanId) continue;
      const sourceRecordId = importer.getExternalId(record);
      classified.push({ canonicalPlanId, sessionId: sessionIdentifier('gencat-agenda', sourceRecordId), localDate: normalized.plan.start_date });
    } catch {
      errors += 1;
    }
  }
  return { fetched, errors, classified };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--dry-run')) {
    console.error('This tool only supports --dry-run. Usage: node scripts/reconcile-recurring-occurrences.js --dry-run');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const db = openDatabase(config.databasePath, { readonly: true });
  try {
    const source = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get();
    if (!source) throw new Error('gencat-agenda source is not registered.');

    console.log('=== Phase 4C.6C — Stale Recurring Occurrence Reconciliation (DRY RUN, no writes) ===\n');
    console.log('Performing a fresh, complete Gencat feed fetch for this analysis...');
    const importer = new GencatAgendaImporter({ db, pageSize: config.gencatPageSize, imagesEnabled: false });
    const { fetched, errors, classified } = await fetchAndClassify(importer);
    const recent = recentFetchedCounts(db, source.id);

    const safety = evaluateBatchSafety({ errors, fetched, recentFetchedCounts: recent });
    console.log(`Fetched: ${fetched}  Errors: ${errors}  Recent completed-run fetched counts: [${recent.join(', ')}]`);
    console.log(`Batch safety: ${safety.safe ? 'SAFE' : 'UNSAFE'}`);
    if (!safety.safe) {
      for (const reason of safety.reasons) console.log(`  - ${reason}`);
      console.log('\nSkipping reconciliation entirely for this run — no group was analyzed.');
      return;
    }

    const groups = appliedGencatGroups(db);
    console.log(`\nApplied Gencat recurring groups evaluated: ${groups.length}`);

    const seenByCanonical = new Map();
    for (const item of classified) {
      if (!seenByCanonical.has(item.canonicalPlanId)) seenByCanonical.set(item.canonicalPlanId, new Set());
      seenByCanonical.get(item.canonicalPlanId).add(item.sessionId);
    }

    let totalCandidates = 0;
    let totalBlocked = 0;
    for (const group of groups) {
      const seenSessionIds = seenByCanonical.get(group.canonical_plan_id) || new Set();
      const existingCount = db.prepare(`
        SELECT COUNT(*) n FROM plan_occurrences po JOIN plan_sources ps ON ps.id = po.plan_source_id
        WHERE ps.plan_id = ? AND po.status = 'active'
      `).get(group.canonical_plan_id).n;
      const { candidates, blocked } = computeStaleOccurrenceCandidates(db, {
        canonicalPlanId: group.canonical_plan_id,
        sourceKey: 'gencat-agenda',
        seenSessionIds,
      });
      const groupSafety = evaluateGroupSafety({ candidateCount: candidates.length, existingActiveCount: existingCount });

      console.log(`\n--- ${group.group_key} (canonical ${group.canonical_plan_id}) ---`);
      console.log(`  Existing active occurrences: ${existingCount}`);
      console.log(`  Sessions seen in this feed pull: ${seenSessionIds.size}`);
      console.log(`  Stale candidates: ${candidates.length}`);
      if (candidates.length) {
        for (const c of candidates) console.log(`    - occurrence ${c.occurrence_id}: sessionId=${c.sessionId} local_date=${c.local_date} (plan_source ${c.plan_source_id})`);
      }
      if (blocked.length) {
        totalBlocked += blocked.length;
        console.log(`  Blocked (ambiguous, NOT eligible for retirement): ${blocked.length}`);
        for (const b of blocked) console.log(`    - occurrence ${b.occurrence_id}: ${b.reason}`);
      }
      if (!groupSafety.safe) {
        console.log(`  GROUP SAFETY: BLOCKED — ${groupSafety.reasons.join('; ')}`);
        continue;
      }
      totalCandidates += candidates.length;
      if (candidates.length > 0) {
        const proposedRange = computeCanonicalDateRangeAfterRetirement(db, group.canonical_plan_id, candidates.map((c) => c.occurrence_id));
        console.log(`  Proposed canonical date range after retirement: ${proposedRange.changed ? `${proposedRange.start_date} .. ${proposedRange.end_date} (CHANGED)` : 'unchanged'} (${proposedRange.remaining} would remain active)`);
      }
    }

    console.log(`\n=== Summary: ${totalCandidates} stale candidate(s), ${totalBlocked} blocked case(s), across ${groups.length} applied group(s). No writes were made (dry-run only). ===`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Reconciliation dry-run failed: ${error.message}`);
  process.exitCode = 1;
});
