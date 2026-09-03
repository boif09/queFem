import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { D4_BASELINE_SHA, D4_CONFIRMATION } from '../backend/src/diba/dibaPolicyD4PrimaryLocal.js';
import { applyDibaPolicyD4PrimaryLocal, sha256File, verifyDibaRepeatPreservation } from '../backend/src/diba/dibaPolicyExecutor.js';
import { identityKey, loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overridePath = path.join(root, 'data-policy', 'diba-link-overrides.json');
const protectedFields = ['original_title', 'original_description', 'start_date', 'end_date', 'venue_name', 'address', 'latitude', 'longitude', 'website_url', 'image_url', 'ticket_url', 'status', 'inactive_at', 'featured', 'quality_score'];

function stable(value) { return { sourceKey: value.sourceKey, sourceRecordId: String(value.sourceRecordId) }; }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (['--expected-sha', '--confirm'].includes(key) && argv[index + 1]) values[{ '--expected-sha': 'expectedSha', '--confirm': 'confirmation' }[key]] = argv[++index];
    else throw new Error(`Unknown or incomplete D4 argument: ${key}`);
  }
  return values;
}
function remaining(policy) {
  return {
    confirmed: policy.crossSource.confirmed.filter(({ decision }) => !['LINK_TO_EXISTING', 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN', 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY'].includes(decision)).length,
    possible: policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker).length,
    sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length,
    sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length,
    activationReady: policy.activation.publicActivationReady,
  };
}
function snapshot(databasePath, targetPlanIds = []) {
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const identities = db.prepare('SELECT s.key AS sourceKey, ps.source_record_id AS sourceRecordId, ps.plan_id AS planId FROM plan_sources ps JOIN sources s ON s.id=ps.source_id ORDER BY s.key, ps.source_record_id').all();
    const plans = db.prepare('SELECT id, status, municipality, comarca, locality FROM plans').all(); const categories = db.prepare('SELECT COUNT(*) AS count FROM plan_categories').get().count;
    const occurrences = db.prepare('SELECT COUNT(*) AS count FROM plan_occurrences').get().count; const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM sources').get().count;
    const planCount = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count;
    const targetPlan = db.prepare('SELECT * FROM plans WHERE id=?'); const targetCategories = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id');
    const targets = Object.fromEntries(targetPlanIds.map((planId) => [planId, {
      fields: Object.fromEntries(protectedFields.map((field) => [field, targetPlan.get(planId)?.[field]])),
      categories: targetCategories.all(planId).map(({ category_id: categoryId }) => categoryId),
    }]));
    const dibaSources = db.prepare("SELECT key, enabled, allows_images FROM sources WHERE key IN ('diba-tourisme','diba-escenari','diba-museus') ORDER BY key").all();
    const integrity = db.pragma('integrity_check', { simple: true }); const duplicate = db.prepare('SELECT 1 FROM plan_sources GROUP BY source_id, source_record_id HAVING COUNT(*) > 1').get();
    return { identities, plans, targets, counts: { plans: planCount, planSources: identities.length, categories, occurrences, sources: sourceCount }, dibaSources, integrity, duplicate: Boolean(duplicate) };
  } finally { db.close(); }
}
function changedMappings(before, after) {
  const prior = new Map(before.map((row) => [identityKey(row), row])); const current = new Map(after.map((row) => [identityKey(row), row]));
  const added = [...current.keys()].filter((key) => !prior.has(key)); const removed = [...prior.keys()].filter((key) => !current.has(key));
  const changed = [...current].filter(([key, row]) => prior.has(key) && prior.get(key).planId !== row.planId).map(([key, row]) => ({ key, source: stable(row), beforePlanId: prior.get(key).planId, afterPlanId: row.planId }));
  return { changed, added, removed };
}
function differences(before, after) {
  const result = [];
  for (const [planId, left] of Object.entries(before)) {
    const right = after[planId];
    for (const field of protectedFields) if (left.fields[field] !== right.fields[field]) result.push({ planId: Number(planId), field, before: left.fields[field], after: right.fields[field] });
    if (JSON.stringify(left.categories) !== JSON.stringify(right.categories)) result.push({ planId: Number(planId), field: 'categories', before: left.categories, after: right.categories });
  }
  return result;
}
async function postPolicy(databasePath, overrides) {
  const audit = await runDibaQualityAudit({ databasePath }); const db = openDatabase(databasePath, { readonly: true });
  try { const policy = planDibaPolicy({ auditReport: audit, overrides, identityIndex: loadPolicyIdentityIndex(db) }); return { policy, remaining: remaining(policy) }; } finally { db.close(); }
}
function assertGlobalInvariants(before, after) {
  if (before.counts.planSources !== after.counts.planSources || before.counts.categories !== after.counts.categories || before.counts.occurrences !== after.counts.occurrences || before.counts.sources !== after.counts.sources) throw new Error('D4 changed an unexpected global cardinality.');
  if (JSON.stringify(before.dibaSources) !== JSON.stringify(after.dibaSources)) throw new Error('D4 changed DIBA source configuration.');
  if (after.integrity !== 'ok' || after.duplicate) throw new Error('D4 database-wide integrity invariant failed.');
}
function markdown(report) {
  return `# DIBA M1.4D4 â€” real local reviewed-link apply\n\n**REAL LOCAL DATABASE MUTATED ONLY BY AUTHORIZED D4 TRANSACTION. DIBA REMAINS DISABLED.**\n\n- Authorization: ${report.authorization.result}; baseline/current pre SHA: \`${report.hashes.pre}\`\n- Verified backup: \`${report.backup.path}\` (\`${report.backup.sha256}\`, integrity ${report.backup.integrity})\n- Relinks: ${report.apply.changedMappings.length}; unexpected: ${report.apply.unexpectedRelinks.length}\n- plan_sources: ${report.apply.planSources.before} -> ${report.apply.planSources.after}\n- Origins / recomputed orphans / inactivated: ${report.orphans.distinctOrigins} / ${report.orphans.recomputed.length} / ${report.orphans.inactivated.length}\n- Protected canonical differences: ${report.canonical.differences.length}; Caiguda ${report.canonical.caigudaProtected}; GaudÃ­ ${report.canonical.gaudiProtected}\n- Geography: ${report.geography.mutations} mutations, ${report.geography.noops} NOOP\n- Remaining: CONFIRMED ${report.post.blockers.confirmed}, POSSIBLE ${report.post.blockers.possible}, same-feed ${report.post.blockers.sameFeed}, session DEFER ${report.post.blockers.sessionDefer}; activation ${report.post.blockers.activationReady}\n- Repeat preservation: ${report.repeat.verified.length}/11\n- Post SHA: \`${report.hashes.post}\`; D4 baseline consumed: ${report.authorization.consumed}\n`;
}

export async function main(config = loadConfig(), argv = process.argv.slice(2)) {
  const args = parseArguments(argv); const overrides = await loadDibaPolicyOverrides(overridePath); const backupPath = path.join(root, 'data', 'backups', `quefem_before_diba_m1_4d4_${timestamp()}.sqlite`);
  const result = await applyDibaPolicyD4PrimaryLocal({ args, config, overrides, backupPath }); const targetIds = result.pre.prepared.scope.targetPlanIds;
  const before = snapshot(result.backup.path, targetIds); const after = snapshot(config.databasePath, targetIds); const mappingDiff = changedMappings(before.identities, after.identities);
  const approved = new Set(overrides.decisions.map(({ source }) => identityKey(source))); const changedKeys = new Set(mappingDiff.changed.map(({ key }) => key));
  if (mappingDiff.changed.length !== 11 || mappingDiff.added.length || mappingDiff.removed.length || mappingDiff.changed.some(({ key }) => !approved.has(key)) || [...approved].some((key) => !changedKeys.has(key))) throw new Error('D4 independent SQLite relink validation did not find exactly the 11 approved sources.');
  if (before.counts.planSources !== after.counts.planSources) throw new Error('D4 changed plan_sources cardinality.');
  const unexpectedRelinks = mappingDiff.changed.filter(({ key }) => !approved.has(key)); const canonicalDifferences = differences(before.targets, after.targets); if (canonicalDifferences.length) throw new Error(`D4 changed ${canonicalDifferences.length} protected public canonical fields.`);
  const originPlanIds = result.apply.candidateOrphanPlanIds; const postPlans = new Map(after.plans.map((plan) => [plan.id, plan])); const prePlans = new Map(before.plans.map((plan) => [plan.id, plan]));
  const postDb = openDatabase(config.databasePath, { readonly: true }); let orphanChecks;
  try { orphanChecks = result.apply.inactivatedOrphans.map(({ planId }) => ({ planId, priorStatus: prePlans.get(planId)?.status, postStatus: postPlans.get(planId)?.status, remainingPlanSources: postDb.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?').get(planId).count, postEnabledSources: postDb.prepare('SELECT COUNT(*) AS count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.enabled=1').get(planId).count })); } finally { postDb.close(); }
  if (originPlanIds.length !== 11 || result.apply.inactivatedOrphans.length !== 11 || orphanChecks.some(({ remainingPlanSources, postStatus, postEnabledSources }) => remainingPlanSources !== 0 || postStatus !== 'inactive' || postEnabledSources !== 0)) throw new Error('D4 orphan/inactivation invariant failed.');
  const geography = { mutations: result.apply.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length, noops: result.apply.geography.filter(({ outcome }) => outcome !== 'MUTATED_APPROVED_GEOGRAPHY').length };
  if (geography.mutations || geography.noops !== 19) throw new Error(`D4 geography result differs from 0 mutations / 19 NOOP: ${JSON.stringify(geography)}.`);
  assertGlobalInvariants(before, after); const post = await postPolicy(config.databasePath, overrides);
  if (post.policy.mutationPlan.phases.finalSourceMappings.length || post.policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.length || post.policy.mutationPlan.phases.explicitGeography.length !== 19 || post.remaining.confirmed || post.remaining.possible !== 22 || post.remaining.sameFeed !== 4 || post.remaining.sessionDefer !== 2 || post.remaining.activationReady) throw new Error(`D4 post-apply policy state differs: ${JSON.stringify({ mappings: post.policy.mutationPlan.phases.finalSourceMappings.length, orphans: post.policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.length, geography: post.policy.mutationPlan.phases.explicitGeography.length, remaining: post.remaining })}.`);
  const repeat = verifyDibaRepeatPreservation({ databasePath: config.databasePath, relinks: result.apply.finalRelinks }); if (repeat.verified.length !== 11) throw new Error('D4 repeat preservation did not retain all 11 reviewed targets.');
  const caiguda = result.pre.prepared.scope.validations.find(({ source }) => source.sourceRecordId === 'escenari1313931136484013581411365170'); const gaudi = result.pre.prepared.scope.validations.find(({ source }) => source.sourceRecordId === 'agendaturisme455505989');
  const postSha = sha256File(config.databasePath); if (postSha === D4_BASELINE_SHA) throw new Error('D4 authorization baseline was not consumed by the real local mutation.');
  const report = { generatedAt: new Date().toISOString(), authorization: { canonicalPath: result.pre.primary, baselineSha: D4_BASELINE_SHA, actualPreSha: result.pre.sha256, result: 'AUTHORIZED', consumed: postSha !== D4_BASELINE_SHA }, hashes: { pre: result.pre.sha256, backup: result.backup.sha256, post: result.postSha256, final: sha256File(config.databasePath) }, backup: result.backup, preview: { reviewedConfirmed: result.pre.prepared.scope.reviewedConfirmed, finalMappings: result.pre.prepared.scope.mappings.length, geography: result.pre.prepared.scope.geography, blockers: result.pre.prepared.scope.unresolved, validations: result.pre.prepared.scope.validations }, apply: { changedMappings: mappingDiff.changed, unexpectedRelinks, addedIdentities: mappingDiff.added, removedIdentities: mappingDiff.removed, planSources: { before: before.counts.planSources, after: after.counts.planSources } }, orphans: { distinctOrigins: new Set(originPlanIds).size, recomputed: originPlanIds, inactivated: result.apply.inactivatedOrphans, checks: orphanChecks }, canonical: { targetPlansCompared: targetIds.length, differences: canonicalDifferences, caigudaProtected: Boolean(caiguda), gaudiProtected: Boolean(gaudi) }, geography, invariants: { integrity: after.integrity, duplicateStableSourceIdentities: after.duplicate, countsBefore: before.counts, countsAfter: after.counts, dibaSourcesUnchanged: JSON.stringify(before.dibaSources) === JSON.stringify(after.dibaSources) }, post: { pendingAutomaticRelinks: 0, pendingReviewedRelinks: post.policy.mutationPlan.phases.finalSourceMappings.length, pendingOrphans: post.policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.length, geography: { mutations: 0, noops: post.policy.mutationPlan.phases.explicitGeography.length }, blockers: post.remaining }, repeat };
  const reports = path.join(root, 'data', 'reports'); await mkdir(reports, { recursive: true }); await writeFile(path.join(reports, 'diba-d4-confirmed-real-local-apply.json'), `${JSON.stringify(report, null, 2)}\n`); await writeFile(path.join(reports, 'diba-d4-confirmed-real-local-apply.md'), markdown(report));
  console.log(`DIBA D4 real local reviewed-link apply passed: ${config.databasePath}`); return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA D4 real local reviewed-link apply failed: ${error.message}`); process.exitCode = 1; });
