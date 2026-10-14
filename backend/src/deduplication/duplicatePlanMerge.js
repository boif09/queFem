import { readFileSync } from 'node:fs';
import { PlanAliasRepository } from '../db/repositories/planAlias.repository.js';
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

// Human-reviewed merge of ONE DIBA-only plan into the public plan that describes the same event. It is the
// consolidation counterpart of the DIBA review queue: the importer publishes an unresolved duplicate as a separate
// plan, and a person later decides it is the same event. Only provenance moves (plan_sources → canonical plan);
// the canonical plan keeps its own fields. The old plan id stays resolvable as a 301 alias (plan_aliases).
export const DUPLICATE_MERGE_DECISIONS_PATH = new URL('../../../data-policy/duplicate-plan-merges.json', import.meta.url);
export const DUPLICATE_MERGE_GROUP_PREFIX = 'duplicate-plan-merge';

export function loadDuplicateMergeDecisions(path = DUPLICATE_MERGE_DECISIONS_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.version !== 1 || !Array.isArray(parsed.decisions)) throw new Error('duplicate-plan-merges: unsupported file shape.');
  const seen = new Set();
  for (const decision of parsed.decisions) {
    for (const field of ['aliasPlanId', 'canonicalPlanId']) {
      if (!Number.isInteger(decision[field]) || decision[field] <= 0) throw new Error(`duplicate-plan-merges: ${field} must be a positive integer.`);
    }
    for (const field of ['title', 'reason', 'reviewedAt', 'reviewer']) {
      if (typeof decision[field] !== 'string' || !decision[field].trim()) throw new Error(`duplicate-plan-merges: ${field} is required (plan ${decision.aliasPlanId}).`);
    }
    if (decision.decision !== 'MERGE') throw new Error(`duplicate-plan-merges: unsupported decision for plan ${decision.aliasPlanId}.`);
    if (seen.has(decision.aliasPlanId)) throw new Error(`duplicate-plan-merges: plan ${decision.aliasPlanId} is listed twice.`);
    seen.add(decision.aliasPlanId);
  }
  return parsed;
}

function same(left, right) { return normalizeForFingerprint(left ?? '') === normalizeForFingerprint(right ?? ''); }

// Pure read: validates every precondition and describes the writes. `problems` empty means ok.
export function computeMergePlan(db, decision) {
  const problems = [];
  const { aliasPlanId, canonicalPlanId } = decision;
  const aliasRepository = new PlanAliasRepository(db);
  const aliasPlan = db.prepare('SELECT * FROM plans WHERE id = ?').get(aliasPlanId);
  const canonicalPlan = db.prepare('SELECT * FROM plans WHERE id = ?').get(canonicalPlanId);
  const sourceRows = db.prepare(`SELECT ps.id AS plan_source_id, ps.plan_id, ps.source_record_id, s.key AS source_key, s.enabled
    FROM plan_sources ps JOIN sources s ON s.id = ps.source_id WHERE ps.plan_id IN (?, ?) ORDER BY ps.id`).all(aliasPlanId, canonicalPlanId);
  const aliasSources = sourceRows.filter((row) => row.plan_id === aliasPlanId);
  const canonicalSources = sourceRows.filter((row) => row.plan_id === canonicalPlanId);

  if (aliasPlanId === canonicalPlanId) problems.push('alias and canonical plan are the same.');
  if (!aliasPlan) problems.push(`alias plan ${aliasPlanId} does not exist.`);
  if (!canonicalPlan) problems.push(`canonical plan ${canonicalPlanId} does not exist.`);
  if (aliasPlan && canonicalPlan) {
    if (aliasPlan.status !== 'active') problems.push(`alias plan ${aliasPlanId} is not active (${aliasPlan.status}).`);
    if (canonicalPlan.status !== 'active') problems.push(`canonical plan ${canonicalPlanId} is not active (${canonicalPlan.status}).`);
    if (!same(aliasPlan.original_title, decision.title)) problems.push(`alias plan title "${aliasPlan.original_title}" differs from the reviewed title "${decision.title}".`);
    if (!same(canonicalPlan.original_title, decision.title)) problems.push(`canonical plan title "${canonicalPlan.original_title}" differs from the reviewed title "${decision.title}".`);
    if (aliasPlan.start_date !== canonicalPlan.start_date || aliasPlan.end_date !== canonicalPlan.end_date) {
      problems.push(`dates differ (${aliasPlan.start_date}→${aliasPlan.end_date} vs ${canonicalPlan.start_date}→${canonicalPlan.end_date}).`);
    }
    if (!same(aliasPlan.municipality, canonicalPlan.municipality)) problems.push(`municipality differs ("${aliasPlan.municipality}" vs "${canonicalPlan.municipality}").`);
  }
  if (!aliasSources.length) problems.push('alias plan has no provenance to move.');
  const foreign = aliasSources.filter((row) => !row.source_key.startsWith('diba-'));
  if (foreign.length) problems.push(`alias plan carries non-DIBA provenance (${foreign.map((row) => row.source_key).join(', ')}); only DIBA-only plans can be absorbed.`);
  if (!canonicalSources.some((row) => row.source_key === 'gencat-agenda' && row.enabled === 1)) problems.push('canonical plan has no enabled gencat-agenda provenance.');
  if (aliasRepository.isAlias(aliasPlanId) || aliasRepository.isCanonical(aliasPlanId)) problems.push(`plan ${aliasPlanId} already takes part in plan_aliases.`);
  if (aliasRepository.isAlias(canonicalPlanId)) problems.push(`canonical plan ${canonicalPlanId} is itself an alias.`);

  const aliasSourceIds = aliasSources.map((row) => row.plan_source_id);
  const occurrenceCount = aliasSourceIds.length
    ? db.prepare(`SELECT COUNT(*) AS n FROM plan_occurrences WHERE plan_source_id IN (${aliasSourceIds.map(() => '?').join(',')})`).get(...aliasSourceIds).n
    : 0;
  if (occurrenceCount) problems.push(`alias plan provenance owns ${occurrenceCount} occurrence(s); merge those by hand.`);

  const canonicalCategories = new Set(db.prepare('SELECT category_id FROM plan_categories WHERE plan_id = ?').all(canonicalPlanId).map((row) => row.category_id));
  const newCategoryIds = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id = ?').all(aliasPlanId)
    .map((row) => row.category_id).filter((id) => !canonicalCategories.has(id));

  return {
    ok: problems.length === 0, problems, decision, aliasPlanId, canonicalPlanId,
    aliasPlan, canonicalPlan, sourceRows: aliasSources, newCategoryIds,
    groupKey: `${DUPLICATE_MERGE_GROUP_PREFIX}:${aliasPlanId}`,
  };
}

// One transaction per merge. Re-runs the checks inside the transaction, so a plan that changed since the
// dry-run aborts with zero writes.
export function applyMerge(db, precheck, { beforeWrite, now = new Date().toISOString() } = {}) {
  const run = db.transaction(() => {
    const plan = computeMergePlan(db, precheck.decision);
    if (!plan.ok) throw new Error(`Invariant failed for plan ${precheck.aliasPlanId}: ${plan.problems.join(' | ')}`);
    if (plan.sourceRows.length !== precheck.sourceRows.length) throw new Error('Invariant failed: provenance changed since the dry-run.');
    beforeWrite?.(plan);
    const relink = db.prepare('UPDATE plan_sources SET plan_id = ? WHERE id = ?');
    for (const row of plan.sourceRows) relink.run(plan.canonicalPlanId, row.plan_source_id);
    db.prepare("UPDATE plans SET status = 'inactive', permanent = 1, inactive_at = ?, updated_at = ? WHERE id = ?").run(now, now, plan.aliasPlanId);
    const link = db.prepare('INSERT OR IGNORE INTO plan_categories (plan_id, category_id) VALUES (?, ?)');
    for (const categoryId of plan.newCategoryIds) link.run(plan.canonicalPlanId, categoryId);
    new PlanAliasRepository(db).create({
      aliasPlanId: plan.aliasPlanId, canonicalPlanId: plan.canonicalPlanId, groupKey: plan.groupKey,
      reason: `Reviewed duplicate: ${plan.decision.reason} (reviewed ${plan.decision.reviewedAt} by ${plan.decision.reviewer}).`,
    }, { now });

    const moved = db.prepare(`SELECT COUNT(*) AS n FROM plan_sources WHERE id IN (${plan.sourceRows.map(() => '?').join(',')}) AND plan_id = ?`)
      .get(...plan.sourceRows.map((row) => row.plan_source_id), plan.canonicalPlanId).n;
    if (moved !== plan.sourceRows.length) throw new Error(`Invariant failed: ${moved}/${plan.sourceRows.length} provenance rows reached the canonical plan.`);
    const leftover = db.prepare('SELECT COUNT(*) AS n FROM plan_sources WHERE plan_id = ?').get(plan.aliasPlanId).n;
    if (leftover) throw new Error('Invariant failed: the alias plan still owns provenance.');
    if (db.prepare('SELECT status FROM plans WHERE id = ?').get(plan.canonicalPlanId).status !== 'active') throw new Error('Invariant failed: canonical plan is no longer active.');
    if (new PlanAliasRepository(db).findCanonicalId(plan.aliasPlanId) !== plan.canonicalPlanId) throw new Error('Invariant failed: alias row missing.');
    return plan;
  });
  return run();
}

function sqlString(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function sqlValue(value) { return value === null || value === undefined ? 'NULL' : (typeof value === 'number' ? String(value) : sqlString(value)); }

// Exact inverse of applyMerge for one plan: restores the alias plan row, the provenance owner, the categories
// that were added and removes the alias row.
export function rollbackStatements(plan) {
  const alias = plan.aliasPlan;
  return [
    `UPDATE plans SET status = ${sqlValue(alias.status)}, permanent = ${sqlValue(alias.permanent)}, inactive_at = ${sqlValue(alias.inactive_at)}, updated_at = ${sqlValue(alias.updated_at)} WHERE id = ${alias.id};`,
    ...plan.sourceRows.map((row) => `UPDATE plan_sources SET plan_id = ${row.plan_id} WHERE id = ${row.plan_source_id};`),
    ...plan.newCategoryIds.map((categoryId) => `DELETE FROM plan_categories WHERE plan_id = ${plan.canonicalPlanId} AND category_id = ${categoryId};`),
    `DELETE FROM plan_aliases WHERE alias_plan_id = ${alias.id};`,
  ];
}
