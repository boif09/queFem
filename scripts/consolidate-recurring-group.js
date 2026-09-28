// Generic, human-authorized tool to consolidate ONE recurring-production
// candidate group (see backend/src/deduplication/recurringProductionDetector.js)
// into a single canonical plan, preserving every old public plan id as a
// durable 301-redirect alias (see migrations/013_add_plan_aliases.sql).
//
// This does NOT automatically apply any group. It requires:
//   1. a human ACCEPT decision on file for the exact groupKey
//      (data-policy/recurring-production-decisions.json), and
//   2. the detector to STILL classify that group SAFE_AUTOMATIC against
//      CURRENT data at the moment of the (re-)check inside the transaction.
// Either missing condition aborts with zero writes.
//
// The importer-facing groupKey -> canonicalPlanId mapping
// (recurring_production_applied_groups, migrations/015_...sql) is written
// INSIDE the same SQLite transaction as every other write below — it is
// authoritative runtime state, not an auxiliary file, so it can never commit
// out of step with the alias/relink/occurrence/category writes it
// accompanies (Phase 4C.3A atomicity hardening; this replaced an earlier
// JSON-file-based mapping plus its own lock file, both now removed — SQLite's
// own transaction/file locking already serializes concurrent writers, and
// the group_key PRIMARY KEY makes a duplicate apply attempt fail loudly).
//
// Default is a read-only dry-run. Nothing is written unless --apply is passed.
//
// --legacy-alias-id=<id> (repeatable; Phase 4C.3A legacy-URL hardening):
// by the time a recurring group is actually consolidated, retention may
// already have deleted the `plans` row for one of its OLD occurrences —
// confirmed in production for Gran Gala Flamenc, where 2 of the group's
// original 16 public plan ids were already gone by consolidation time. The
// detector can only ever see current `plans` rows, so it cannot rediscover
// those ids on its own — and this script deliberately does NOT try to infer
// them from a numeric range either. Preserving those old public URLs as
// redirects requires the operator to supply the exact ids explicitly, backed
// by prior verified evidence (e.g. a production audit that recorded the
// group's original full id range before any of it was purged). Future
// recurring-group consolidations should expect this same situation and
// likewise require explicit, evidence-backed legacy ids — never inferred.
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';
import { PlanOccurrenceRepository } from '../backend/src/db/repositories/planOccurrence.repository.js';
import { RecurringProductionAppliedGroupRepository } from '../backend/src/db/repositories/recurringProductionAppliedGroup.repository.js';
import { detectRecurringProductionCandidates } from '../backend/src/deduplication/recurringProductionDetector.js';
import { decisionsByGroupKey } from '../backend/src/deduplication/recurringProductionDecisions.js';
import { groupSourceRowsIntoOccurrences } from '../backend/src/deduplication/recurringOccurrenceIdentity.js';
import { loadCandidateRecords } from '../backend/src/jobs/detectRecurringProductions.js';

const OCCURRENCE_TIMEZONE = 'Europe/Madrid';

// Phase 4C.6B: the real-session identity (sessionIdentifier) and batch
// grouping logic (groupSourceRowsIntoOccurrences) now live in
// backend/src/deduplication/recurringOccurrenceIdentity.js, shared with
// GencatAgendaImporter's ongoing occurrence maintenance
// (recurringOccurrenceMaintenance.js) for records that arrive AFTER this
// script has already consolidated a group — so the one-off batch collapse
// done here and the incremental maintenance done on every future import can
// never drift apart on what counts as "the same real session". Re-exported
// here so existing callers/tests importing it from this script keep working.
export { groupSourceRowsIntoOccurrences };

// Pure, read-only: re-derives the exact group (by groupKey) from CURRENT
// data and validates every precondition. Used identically for --dry-run and
// as the fresh in-transaction re-check under --apply (closes the TOCTOU
// window the same way scripts/backfill-gencat-free-status.js does).
export function computeConsolidationPlan(db, { groupKey, canonicalPlanId, decisionsPath, legacyAliasIds: rawLegacyAliasIds = [] }) {
  const problems = [];
  const [source] = groupKey.split('|');
  // Deduplicated, sorted, explicit-only (task requirement: "duplicates in
  // CLI input must fail or deduplicate deterministically" — chosen:
  // deduplicate, since a repeated --legacy-alias-id is an operator slip, not
  // a sign of corrupted state). Never inferred from a numeric range — these
  // are historical public IDs retention already deleted, verified only by
  // explicit human input backed by prior evidence (e.g. a production audit).
  //
  // Validated here, independently of the CLI's own parseArguments() check —
  // this function is also called directly (by tests, and potentially by a
  // future non-CLI caller) that would otherwise bypass that validation
  // entirely. Since plan_aliases.alias_plan_id no longer has a foreign key
  // to `plans` (migration 016), a garbage value here would not be caught by
  // the database either (self-review finding, this hardening pass).
  for (const value of new Set(rawLegacyAliasIds)) {
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`legacy-alias-id must be a positive integer, got ${JSON.stringify(value)}.`);
    }
  }
  const legacyAliasIds = [...new Set(rawLegacyAliasIds)].filter((v) => Number.isInteger(v) && v > 0).sort((a, b) => a - b);

  const decision = decisionsByGroupKey(decisionsPath).get(groupKey);
  if (!decision || decision.decision !== 'ACCEPT') {
    problems.push(`No human ACCEPT decision on file for groupKey "${groupKey}" in data-policy/recurring-production-decisions.json.`);
  }

  // Explicit, clearly-worded duplicate-apply guard. The detector-based check
  // below would also catch a genuine re-apply attempt indirectly (once a
  // group is consolidated its alias plans become inactive and can never be
  // re-detected as members of the same candidate group), but that failure
  // mode reads as "group not found" rather than "already applied" — this
  // makes the actual reason explicit for an operator (task requirement:
  // "two attempts to apply the same group must fail safely or be
  // idempotently recognized").
  const appliedGroupRepository = new RecurringProductionAppliedGroupRepository(db);
  if (appliedGroupRepository.isApplied(groupKey)) {
    problems.push(`Group "${groupKey}" has already been applied (canonical plan ${appliedGroupRepository.findCanonicalPlanId(groupKey)}). Refusing to apply it again.`);
  }

  const records = loadCandidateRecords(db, { sources: [source] });
  const group = detectRecurringProductionCandidates(records).find((g) => g.groupKey === groupKey);
  if (!group) {
    problems.push(`Group "${groupKey}" is no longer detected as a recurring-production candidate against current data.`);
    return { ok: false, problems };
  }
  if (group.classification !== 'SAFE_AUTOMATIC') {
    problems.push(`Group "${groupKey}" is currently classified ${group.classification}, not SAFE_AUTOMATIC. Reasons: ${group.reasons.join(' | ')}`);
  }
  if (!group.planIds.includes(canonicalPlanId)) {
    problems.push(`canonical-plan-id ${canonicalPlanId} is not a member of the detected group (members: ${group.planIds.join(', ')}).`);
  }

  const aliasPlanIds = group.planIds.filter((id) => id !== canonicalPlanId).sort((a, b) => a - b);
  const expectedPlanCount = group.planIds.length;

  const aliasRepository = new PlanAliasRepository(db);
  for (const id of [canonicalPlanId, ...aliasPlanIds]) {
    if (aliasRepository.isAlias(id)) problems.push(`Plan ${id} is already an alias of another plan; refusing to touch it.`);
    if (aliasRepository.isCanonical(id) && id !== canonicalPlanId) problems.push(`Plan ${id} is already a canonical target of another consolidation.`);
  }

  const canonicalRow = db.prepare('SELECT id, status, start_date, end_date FROM plans WHERE id = ?').get(canonicalPlanId);
  if (!canonicalRow) problems.push(`Canonical plan ${canonicalPlanId} does not exist.`);
  else if (canonicalRow.status !== 'active') problems.push(`Canonical plan ${canonicalPlanId} is not active (status=${canonicalRow.status}).`);

  // Legacy alias IDs (Phase 4C.3A legacy-URL hardening): historical public
  // plan ids that retention already deleted BEFORE this group was ever
  // consolidated (confirmed real in production for Gran Gala Flamenc — 2 of
  // its original 16 ids were gone by the time it was actually consolidated).
  // Every safety rule here is deliberately conservative: a legacy id is only
  // ever a URL-preservation record, never a data-merge target, so it must
  // categorically NOT reference anything the detector or the alias table
  // already knows about — if it does, it isn't "legacy" at all and this
  // script refuses to guess what the operator actually meant.
  for (const id of legacyAliasIds) {
    if (id === canonicalPlanId) {
      problems.push(`legacy-alias-id ${id} must not equal the canonical plan id.`);
      continue;
    }
    if (aliasPlanIds.includes(id)) {
      problems.push(`legacy-alias-id ${id} is already part of the currently-detected group — it is not legacy, omit it and it will be aliased automatically.`);
      continue;
    }
    const existingPlan = db.prepare('SELECT id FROM plans WHERE id = ?').get(id);
    if (existingPlan) {
      problems.push(`legacy-alias-id ${id} currently exists as a plans row (and is not part of the detected group) — refusing to hijack an unrelated existing plan.`);
      continue;
    }
    if (aliasRepository.isAlias(id)) {
      problems.push(`legacy-alias-id ${id} is already an alias of plan ${aliasRepository.findCanonicalId(id)} — refusing to re-point it.`);
      continue;
    }
    if (aliasRepository.isCanonical(id)) {
      problems.push(`legacy-alias-id ${id} is already a canonical target of another consolidation — aliasing it here would create a cycle.`);
    }
  }

  // Every plan_sources row for every member plan of the group, with the
  // owning plan's OWN start_date captured (this is the per-occurrence date,
  // since each fragmented Gencat plan represents exactly one occurrence —
  // the root cause this whole phase exists to fix). Aborts (does not
  // silently skip) if any member plan carries a plan_sources row from a
  // DIFFERENT source than the group's own — that would mean unexpected
  // topology this script is not safe to resolve automatically.
  const memberIds = [canonicalPlanId, ...aliasPlanIds];
  const placeholders = memberIds.map(() => '?').join(',');
  const sourceRows = db.prepare(`
    SELECT ps.id AS plan_source_id, ps.plan_id, ps.source_record_id, s.key AS source_key, p.start_date AS plan_start_date
    FROM plan_sources ps
    JOIN sources s ON s.id = ps.source_id
    JOIN plans p ON p.id = ps.plan_id
    WHERE ps.plan_id IN (${placeholders})
    ORDER BY ps.id
  `).all(...memberIds);
  const contaminating = sourceRows.filter((row) => row.source_key !== source);
  if (contaminating.length) {
    problems.push(`Cross-source contamination: plan_sources ${contaminating.map((r) => r.plan_source_id).join(', ')} belong to a different source than "${source}".`);
  }

  if (expectedPlanCount !== undefined && group.planIds.length !== expectedPlanCount) {
    // Unreachable in practice (expectedPlanCount is derived from group.planIds
    // itself above) — kept as an explicit, named invariant rather than an
    // implicit assumption, matching this repo's established style.
    problems.push('Internal inconsistency computing expected plan count.');
  }

  // Group plan_sources rows into REAL occurrences (Phase 4C.6): every row is
  // still relinked to the canonical plan below (provenance/attribution/images
  // are untouched), but multiple rows that are really the same session
  // collapse into exactly one plan_occurrence — see
  // groupSourceRowsIntoOccurrences()/sessionIdentifier() above.
  const occurrences = groupSourceRowsIntoOccurrences(sourceRows);
  if (occurrences.some((o) => !o.localDate)) {
    problems.push('At least one member plan has a null start_date; cannot derive an occurrence date for it.');
  }

  return {
    ok: problems.length === 0,
    problems,
    groupKey,
    source,
    canonicalPlanId,
    aliasPlanIds,
    legacyAliasIds,
    // Used for the plan_aliases row-creation loop, the alias-count invariant
    // check, and the rollback DELETE — anywhere "every alias, whether a
    // currently-relinked plan or a legacy URL-only record" is the right
    // scope. Relinking/deactivation/category-merge intentionally stay scoped
    // to `aliasPlanIds` only, since legacy ids have no plans row to touch.
    allAliasPlanIds: [...aliasPlanIds, ...legacyAliasIds].sort((a, b) => a - b),
    expectedPlanCount,
    sourceRows,
    occurrences,
    canonicalDates: {
      // Documentation-only summary fields on the canonical plan row itself.
      // Discovery/sort/retention all derive dates from plan_occurrences once
      // occurrences exist (confirmed: occurrenceSql.js's
      // activeOccurrenceDate/effectiveOccurrenceEndDate fully override
      // plans.start_date/end_date whenever any active occurrence exists) —
      // these two columns are never read for filtering/sorting in that case,
      // only kept honest for anything reading the raw plan row directly.
      start_date: occurrences.map((o) => o.localDate).filter(Boolean).sort()[0] || canonicalRow?.start_date || null,
      end_date: occurrences.map((o) => o.localDate).filter(Boolean).sort().at(-1) || canonicalRow?.end_date || null,
    },
  };
}

function printPlanReport(plan) {
  console.log(`Recurring-group consolidation — groupKey: ${plan.groupKey}`);
  console.log(`Source: ${plan.source}`);
  console.log(`Canonical plan id: ${plan.canonicalPlanId}`);
  console.log(`Alias plan ids (${plan.aliasPlanIds.length}): ${plan.aliasPlanIds.join(', ')}`);
  console.log(`Legacy alias ids (${plan.legacyAliasIds.length}): ${plan.legacyAliasIds.join(', ') || '(none)'}`);
  console.log(`Total aliases (${plan.allAliasPlanIds.length}): ${plan.allAliasPlanIds.join(', ')}`);
  console.log(`plan_sources to relink: ${plan.sourceRows.length}`);
  console.log(`plan_occurrences to create: ${plan.occurrences.length}`);
  if (plan.occurrences.length !== plan.sourceRows.length) {
    console.log(`  (${plan.sourceRows.length - plan.occurrences.length} plan_sources row(s) collapsed into an existing real session — same session, multiple venue filings.)`);
  }
  console.log(`Canonical start_date/end_date after: ${plan.canonicalDates.start_date} .. ${plan.canonicalDates.end_date}`);
  if (plan.problems.length) {
    console.log('PROBLEMS (would abort with zero writes):');
    for (const p of plan.problems) console.log(`  - ${p}`);
  } else {
    console.log('No problems found. Safe to --apply.');
  }
}

// Writes only if the plan recomputed FRESH inside this transaction still
// matches the outer pre-check (same TOCTOU-closing pattern as
// scripts/backfill-gencat-free-status.js's applyBackfill()).
export function applyConsolidation(db, precheckPlan, { beforeWrite, decisionsPath, appliedBy = 'unknown' } = {}) {
  const now = new Date().toISOString();
  const relinkSource = db.prepare('UPDATE plan_sources SET plan_id = ? WHERE id = ?');
  const deactivateAlias = db.prepare(`
    UPDATE plans SET status = 'inactive', permanent = 1, inactive_at = ?, updated_at = ? WHERE id = ?
  `);
  const updateCanonicalDates = db.prepare('UPDATE plans SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?');
  const readPlan = db.prepare('SELECT id, status, permanent, inactive_at, start_date, end_date, updated_at FROM plans WHERE id = ?');

  const run = db.transaction(() => {
    const fresh = computeConsolidationPlan(db, {
      groupKey: precheckPlan.groupKey, canonicalPlanId: precheckPlan.canonicalPlanId, decisionsPath,
      legacyAliasIds: precheckPlan.legacyAliasIds,
    });
    if (!fresh.ok) {
      throw new Error(`Invariant failed: fresh in-transaction check found problems — ${fresh.problems.join(' | ')}`);
    }
    const sameAliases = fresh.aliasPlanIds.length === precheckPlan.aliasPlanIds.length
      && fresh.aliasPlanIds.every((id, i) => id === precheckPlan.aliasPlanIds[i]);
    const sameLegacyAliases = fresh.legacyAliasIds.length === precheckPlan.legacyAliasIds.length
      && fresh.legacyAliasIds.every((id, i) => id === precheckPlan.legacyAliasIds[i]);
    if (!sameAliases || !sameLegacyAliases || fresh.sourceRows.length !== precheckPlan.sourceRows.length) {
      throw new Error('Invariant failed: fresh in-transaction group membership differs from the pre-check — data changed mid-run, aborting with no writes.');
    }
    const plan = fresh;

    // plan_categories is plan-level (keyed by plan_id, not plan_source_id),
    // unlike plan_source_images/plan_source_geography/plan_occurrences which
    // all follow plan_sources automatically once relinked. Any category tag
    // that only exists on an alias plan would otherwise be silently orphaned
    // on a now-hidden, inactive row and vanish from the canonical plan
    // (cross-review finding). Only categories NOT already on the canonical
    // are new — that precise set is both what gets inserted and, on
    // rollback, exactly what must be removed again.
    const canonicalCategoriesBefore = new Set(
      db.prepare('SELECT category_id FROM plan_categories WHERE plan_id = ?').all(plan.canonicalPlanId).map((r) => r.category_id),
    );
    const aliasCategoryIds = plan.aliasPlanIds.length
      ? [...new Set(db.prepare(`
          SELECT DISTINCT category_id FROM plan_categories WHERE plan_id IN (${plan.aliasPlanIds.map(() => '?').join(',')})
        `).all(...plan.aliasPlanIds).map((r) => r.category_id))]
      : [];
    const newCategoryIds = aliasCategoryIds.filter((id) => !canonicalCategoriesBefore.has(id));

    // Capture the exact pre-upsert row (if any) for every occurrence this
    // touches — reusing the same plan_source_id/occurrence_key pair across
    // an already-consolidated group (e.g. a hypothetical future DIBA use of
    // this same generic script) must roll back to its PRIOR values, not be
    // unconditionally deleted, which would lose a row that existed before
    // this run for an unrelated reason (cross-review finding).
    const occurrenceBeforeSnapshots = plan.occurrences.map((occurrence) => ({
      planSourceId: occurrence.planSourceId,
      occurrenceKey: occurrence.occurrenceKey,
      before: db.prepare('SELECT * FROM plan_occurrences WHERE plan_source_id = ? AND occurrence_key = ?')
        .get(occurrence.planSourceId, occurrence.occurrenceKey) || null,
    }));

    if (beforeWrite) {
      const beforeSnapshots = [plan.canonicalPlanId, ...plan.aliasPlanIds].map((id) => readPlan.get(id));
      beforeWrite(plan, beforeSnapshots, { newCategoryIds, occurrenceBeforeSnapshots });
    }

    const occurrenceRepository = new PlanOccurrenceRepository(db);
    const aliasRepository = new PlanAliasRepository(db);
    const linkCategory = db.prepare('INSERT OR IGNORE INTO plan_categories (plan_id, category_id) VALUES (?, ?)');

    for (const row of plan.sourceRows) relinkSource.run(plan.canonicalPlanId, row.plan_source_id);
    for (const id of plan.aliasPlanIds) deactivateAlias.run(now, now, id);
    updateCanonicalDates.run(plan.canonicalDates.start_date, plan.canonicalDates.end_date, now, plan.canonicalPlanId);
    for (const categoryId of newCategoryIds) linkCategory.run(plan.canonicalPlanId, categoryId);
    for (const id of plan.aliasPlanIds) {
      aliasRepository.create({
        aliasPlanId: id,
        canonicalPlanId: plan.canonicalPlanId,
        groupKey: plan.groupKey,
        reason: `Phase 4C.3A consolidation: ${plan.expectedPlanCount} occurrences, detector SAFE_AUTOMATIC, human ACCEPT decision on file.`,
      }, { now });
    }
    // Legacy alias ids (Phase 4C.3A legacy-URL hardening): pure URL
    // preservation for a historical public id retention already deleted
    // before this group was consolidated — no plans row exists for these,
    // so there is nothing to relink, deactivate, or merge categories from.
    for (const id of plan.legacyAliasIds) {
      aliasRepository.create({
        aliasPlanId: id,
        canonicalPlanId: plan.canonicalPlanId,
        groupKey: plan.groupKey,
        reason: 'Phase 4C.3A legacy-URL hardening: historical public ID preserved by explicit operator input (retention removed its plans row before consolidation); verified via prior production audit.',
        isLegacy: true,
      }, { now });
    }
    for (const occurrence of plan.occurrences) {
      occurrenceRepository.upsert(occurrence.planSourceId, {
        occurrenceKey: occurrence.occurrenceKey,
        localDate: occurrence.localDate,
        timezone: OCCURRENCE_TIMEZONE,
        status: 'active',
      }, { seenAt: now });
    }
    // The importer-facing mapping, written in this SAME transaction (Phase
    // 4C.3A atomicity hardening) — a plain INSERT (not INSERT OR IGNORE) so a
    // group_key PRIMARY KEY collision throws loudly rather than silently
    // no-op'ing, matching this script's fail-closed posture everywhere else.
    new RecurringProductionAppliedGroupRepository(db).create({
      groupKey: plan.groupKey,
      source: plan.source,
      canonicalPlanId: plan.canonicalPlanId,
      appliedBy,
    }, { now });

    // Post-write invariant checks, still inside the transaction — any
    // failure throws and rolls back every write above.
    const relinkedCount = db.prepare(`
      SELECT COUNT(*) AS n FROM plan_sources WHERE id IN (${plan.sourceRows.map(() => '?').join(',')}) AND plan_id = ?
    `).get(...plan.sourceRows.map((r) => r.plan_source_id), plan.canonicalPlanId).n;
    if (relinkedCount !== plan.sourceRows.length) throw new Error(`Invariant failed: only ${relinkedCount}/${plan.sourceRows.length} plan_sources point to the canonical plan.`);

    const occurrenceCount = db.prepare(`
      SELECT COUNT(*) AS n FROM plan_occurrences WHERE plan_source_id IN (${plan.sourceRows.map(() => '?').join(',')})
    `).get(...plan.sourceRows.map((r) => r.plan_source_id)).n;
    if (occurrenceCount !== plan.occurrences.length) throw new Error(`Invariant failed: ${occurrenceCount} occurrences exist, expected ${plan.occurrences.length}.`);

    const aliasCount = db.prepare(`
      SELECT COUNT(*) AS n FROM plan_aliases WHERE alias_plan_id IN (${plan.allAliasPlanIds.map(() => '?').join(',')}) AND canonical_plan_id = ?
    `).get(...plan.allAliasPlanIds, plan.canonicalPlanId).n;
    if (aliasCount !== plan.allAliasPlanIds.length) throw new Error(`Invariant failed: ${aliasCount}/${plan.allAliasPlanIds.length} alias rows (current + legacy) point directly to the canonical plan.`);

    if (plan.legacyAliasIds.length) {
      const legacyCount = db.prepare(`
        SELECT COUNT(*) AS n FROM plan_aliases WHERE alias_plan_id IN (${plan.legacyAliasIds.map(() => '?').join(',')}) AND canonical_plan_id = ? AND is_legacy = 1
      `).get(...plan.legacyAliasIds, plan.canonicalPlanId).n;
      if (legacyCount !== plan.legacyAliasIds.length) throw new Error(`Invariant failed: ${legacyCount}/${plan.legacyAliasIds.length} legacy alias rows were not written correctly (missing or is_legacy not set).`);
    }

    const stillActiveAliases = db.prepare(`
      SELECT COUNT(*) AS n FROM plans WHERE id IN (${plan.aliasPlanIds.map(() => '?').join(',')}) AND status = 'active'
    `).get(...plan.aliasPlanIds).n;
    if (stillActiveAliases !== 0) throw new Error(`Invariant failed: ${stillActiveAliases} alias plan(s) are still status=active and would remain discoverable.`);

    const canonicalStatus = db.prepare('SELECT status FROM plans WHERE id = ?').get(plan.canonicalPlanId).status;
    if (canonicalStatus !== 'active') throw new Error('Invariant failed: canonical plan is no longer active after consolidation.');

    const appliedMapping = db.prepare('SELECT canonical_plan_id FROM recurring_production_applied_groups WHERE group_key = ?').get(plan.groupKey);
    if (!appliedMapping || appliedMapping.canonical_plan_id !== plan.canonicalPlanId) {
      throw new Error('Invariant failed: recurring_production_applied_groups mapping was not written correctly for this group.');
    }

    const missingCategories = newCategoryIds.filter((categoryId) => (
      !db.prepare('SELECT 1 FROM plan_categories WHERE plan_id = ? AND category_id = ?').get(plan.canonicalPlanId, categoryId)
    ));
    if (missingCategories.length) throw new Error(`Invariant failed: categories ${missingCategories.join(', ')} from alias plans were not merged onto the canonical plan.`);

    return { ...plan, newCategoryIds, occurrenceBeforeSnapshots };
  });

  return run();
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function occurrenceRollbackStatements(occurrenceBeforeSnapshots) {
  return occurrenceBeforeSnapshots.map(({ planSourceId, occurrenceKey, before }) => {
    if (!before) {
      // Genuinely new: rollback removes exactly this row, nothing else.
      return `DELETE FROM plan_occurrences WHERE plan_source_id = ${planSourceId} AND occurrence_key = ${sqlString(occurrenceKey)};`;
    }
    // Pre-existed with its own values (not reachable for the current
    // Gencat-only pilot, which has zero pre-existing occurrences, but this
    // script is generic — see cross-review finding on rollback completeness):
    // restore them exactly instead of deleting a row that predates this run.
    return `UPDATE plan_occurrences SET starts_at = ${before.starts_at === null ? 'NULL' : sqlString(before.starts_at)}, ends_at = ${before.ends_at === null ? 'NULL' : sqlString(before.ends_at)}, local_date = ${sqlString(before.local_date)}, local_time = ${before.local_time === null ? 'NULL' : sqlString(before.local_time)}, timezone = ${sqlString(before.timezone)}, status = ${sqlString(before.status)}, last_seen_at = ${sqlString(before.last_seen_at)}, updated_at = ${sqlString(before.updated_at)} WHERE plan_source_id = ${planSourceId} AND occurrence_key = ${sqlString(occurrenceKey)};`;
  });
}

// Audit-only artifacts (log.json + rollback.sql). Neither is required for
// correctness: the applied-group mapping itself lives in
// recurring_production_applied_groups, written in the same transaction as
// everything else, so there is nothing left for a separate JSON file to
// keep in sync (Phase 4C.3A atomicity hardening — this used to also write
// an "applied-groups-before.json" snapshot for manual JSON restoration;
// that need no longer exists).
function writeArtifacts(plan, beforeSnapshots, { newCategoryIds, occurrenceBeforeSnapshots }, { outDir, timestamp, headCommit, dbPath }) {
  mkdirSync(outDir, { recursive: true });
  const slug = plan.groupKey.replace(/[^a-z0-9-]+/gi, '_');
  const logPath = path.join(outDir, `consolidate-${slug}-${timestamp}.log.json`);
  const rollbackPath = path.join(outDir, `consolidate-${slug}-${timestamp}.rollback.sql`);

  writeFileSync(logPath, JSON.stringify({
    timestamp, headCommit, dbPath,
    groupKey: plan.groupKey,
    canonicalPlanId: plan.canonicalPlanId,
    aliasPlanIds: plan.aliasPlanIds,
    legacyAliasIds: plan.legacyAliasIds,
    relinkedPlanSourceIds: plan.sourceRows.map((r) => r.plan_source_id),
    occurrencesCreated: plan.occurrences,
    newCategoryIds,
    canonicalDates: plan.canonicalDates,
    beforeSnapshots,
  }, null, 2));

  const rollbackLines = [
    `-- Rollback for recurring-group consolidation run at ${timestamp}`,
    `-- groupKey: ${plan.groupKey}`,
    `-- HEAD: ${headCommit}`,
    `-- DB: ${dbPath}`,
    '-- This SQL fully restores the affected database state, including the',
    '-- recurring_production_applied_groups mapping row — no separate file',
    '-- needs to be restored (Phase 4C.3A atomicity hardening).',
    '-- Legacy alias ids (if any) never had a plans row before this run either',
    '-- (that is precisely why they were passed as --legacy-alias-id), so this',
    '-- rollback correctly does NOT try to recreate one for them — only their',
    '-- plan_aliases row (deleted below, alongside the current-plan aliases) is',
    '-- undone (Phase 4C.3A legacy-URL hardening).',
    'BEGIN TRANSACTION;',
    ...beforeSnapshots.map((s) => (
      `UPDATE plans SET status = '${s.status}', permanent = ${s.permanent}, inactive_at = ${s.inactive_at === null ? 'NULL' : `'${s.inactive_at}'`}, start_date = ${s.start_date === null ? 'NULL' : `'${s.start_date}'`}, end_date = ${s.end_date === null ? 'NULL' : `'${s.end_date}'`}, updated_at = '${s.updated_at}' WHERE id = ${s.id};`
    )),
    ...plan.sourceRows.map((row) => `UPDATE plan_sources SET plan_id = ${row.plan_id} WHERE id = ${row.plan_source_id};`),
    ...occurrenceRollbackStatements(occurrenceBeforeSnapshots),
    ...newCategoryIds.map((categoryId) => `DELETE FROM plan_categories WHERE plan_id = ${plan.canonicalPlanId} AND category_id = ${categoryId};`),
    `DELETE FROM plan_aliases WHERE alias_plan_id IN (${plan.allAliasPlanIds.join(',')});`,
    `DELETE FROM recurring_production_applied_groups WHERE group_key = ${sqlString(plan.groupKey)};`,
    'COMMIT;',
  ];
  writeFileSync(rollbackPath, rollbackLines.join('\n') + '\n');

  return { logPath, rollbackPath };
}

function parseArguments(args) {
  const apply = args.includes('--apply');
  const dryRunFlagPresent = args.includes('--dry-run');
  if (apply && dryRunFlagPresent) throw new Error('--apply and --dry-run cannot both be passed.');
  const get = (name) => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : null;
  };
  const groupKey = get('group-key');
  const canonicalPlanIdRaw = get('canonical-plan-id');
  const expectedPlanCountRaw = get('expected-plan-count');
  if (!groupKey || !canonicalPlanIdRaw || !expectedPlanCountRaw) {
    throw new Error('Ús: node scripts/consolidate-recurring-group.js --group-key=<k> --canonical-plan-id=<id> --expected-plan-count=<n> [--legacy-alias-id=<id>]... [--dry-run|--apply] [--out-dir=path]');
  }
  const canonicalPlanId = Number.parseInt(canonicalPlanIdRaw, 10);
  const expectedPlanCount = Number.parseInt(expectedPlanCountRaw, 10);
  if (!Number.isInteger(canonicalPlanId) || canonicalPlanId <= 0) throw new Error('--canonical-plan-id must be a positive integer.');
  if (!Number.isInteger(expectedPlanCount) || expectedPlanCount <= 0) throw new Error('--expected-plan-count must be a positive integer.');
  // Repeatable, explicit-only (never inferred from a numeric range — see the
  // module header comment). --legacy-alias-id=1196 --legacy-alias-id=1197 is
  // the expected form; deduplication of repeated values happens in
  // computeConsolidationPlan().
  const legacyAliasIds = args
    .filter((a) => a.startsWith('--legacy-alias-id='))
    .map((a) => {
      const raw = a.split('=')[1];
      const value = Number.parseInt(raw, 10);
      if (!Number.isInteger(value) || value <= 0) throw new Error(`--legacy-alias-id must be a positive integer, got "${raw}".`);
      return value;
    });
  return {
    dryRun: !apply,
    groupKey,
    canonicalPlanId,
    expectedPlanCount,
    legacyAliasIds,
    outDir: get('out-dir') || path.resolve(loadConfig().projectRoot, 'data/consolidation-logs'),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const config = loadConfig();

  if (options.dryRun) {
    const db = openDatabase(config.databasePath, { readonly: true });
    try {
      const plan = computeConsolidationPlan(db, { groupKey: options.groupKey, canonicalPlanId: options.canonicalPlanId, legacyAliasIds: options.legacyAliasIds });
      printPlanReport(plan);
      if (plan.expectedPlanCount !== options.expectedPlanCount) {
        console.error(`NOTE: detected plan count (${plan.expectedPlanCount}) differs from --expected-plan-count (${options.expectedPlanCount}).`);
      }
    } finally {
      db.close();
    }
    return;
  }

  const db = openDatabase(config.databasePath, { readonly: false, configureJournal: true });
  try {
    const precheck = computeConsolidationPlan(db, { groupKey: options.groupKey, canonicalPlanId: options.canonicalPlanId, legacyAliasIds: options.legacyAliasIds });
    printPlanReport(precheck);

    if (!precheck.ok) {
      console.error('ABORT: precondition problems found. No writes performed.');
      process.exitCode = 1;
      return;
    }
    if (precheck.expectedPlanCount !== options.expectedPlanCount) {
      console.error(`ABORT: fresh plan count (${precheck.expectedPlanCount}) differs from --expected-plan-count (${options.expectedPlanCount}). No writes performed.`);
      process.exitCode = 1;
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const headCommit = process.env.CONSOLIDATION_HEAD_COMMIT || 'unknown';
    let artifactPaths = null;

    const applied = applyConsolidation(db, precheck, {
      appliedBy: process.env.CONSOLIDATION_APPLIED_BY || 'unknown',
      beforeWrite: (freshPlan, beforeSnapshots, extra) => {
        artifactPaths = writeArtifacts(freshPlan, beforeSnapshots, extra, { outDir: options.outDir, timestamp, headCommit, dbPath: config.databasePath });
      },
    });

    console.log(`Log written: ${artifactPaths.logPath}`);
    console.log(`Rollback SQL written: ${artifactPaths.rollbackPath}`);
    console.log(`Applied: canonical=${applied.canonicalPlanId}, aliases=${applied.aliasPlanIds.length}, occurrences=${applied.occurrences.length}.`);
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Consolidation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
