import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { runDibaQualityAudit } from '../backend/src/diba/dibaQualityAudit.js';
import { applyDibaPolicyRehearsal, cloneDibaRehearsal, sha256File, verifyDibaRepeatPreservation } from '../backend/src/diba/dibaPolicyExecutor.js';
import { identityKey, loadDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overridePath = path.join(root, 'data-policy', 'diba-link-overrides.json');
const protectedFields = ['original_title', 'original_description', 'start_date', 'end_date', 'venue_name', 'address', 'latitude', 'longitude', 'website_url', 'image_url', 'ticket_url', 'status', 'inactive_at', 'featured', 'quality_score'];
const expectedRealSha = '82611672310F855944CBB25EBCE5E1B948AB3DAEF6FBA895D3F2C88FD9AC62E1';
function stable(value) { return { sourceKey: value.sourceKey, sourceRecordId: String(value.sourceRecordId) }; }
function key(value) { return identityKey(value); }
function timestampedTarget() { return path.join(root, 'data', 'rehearsal', `quefem_diba_m1_4d3_confirmed_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`); }
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function countRows(db) { return db.prepare('SELECT COUNT(*) AS count FROM plan_sources').get().count; }
function targetSnapshot(db, planIds) {
  const plan = db.prepare('SELECT * FROM plans WHERE id=?'); const categories = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id');
  return Object.fromEntries(planIds.map((id) => [id, { fields: Object.fromEntries(protectedFields.map((field) => [field, plan.get(id)?.[field]])), categories: categories.all(id).map(({ category_id: categoryId }) => categoryId) }]));
}
function diffSnapshots(before, after) {
  const differences = [];
  for (const [planId, left] of Object.entries(before)) {
    const right = after[planId];
    for (const field of protectedFields) if (left.fields[field] !== right.fields[field]) differences.push({ planId: Number(planId), field, before: left.fields[field], after: right.fields[field] });
    if (!equal(left.categories, right.categories)) differences.push({ planId: Number(planId), field: 'categories', before: left.categories, after: right.categories });
  }
  return differences;
}
async function policyState(databasePath, overrides) {
  const audit = await runDibaQualityAudit({ databasePath }); const db = openDatabase(databasePath, { readonly: true });
  try { const index = loadPolicyIdentityIndex(db); return { audit, index, policy: planDibaPolicy({ auditReport: audit, overrides, identityIndex: index }) }; } finally { db.close(); }
}
function validatePreApply(state, overrides) {
  if (overrides.decisions.length !== 11) throw new Error(`D3 requires exactly 11 approved overrides; found ${overrides.decisions.length}.`);
  const approved = new Map(overrides.decisions.map((item) => [key(item.source), item])); const mappings = state.policy.mutationPlan.phases.finalSourceMappings;
  const unexpected = mappings.filter(({ source }) => !approved.has(key(source))); if (unexpected.length) throw new Error(`D3 found ${unexpected.length} unexpected final provenance relink(s) before mutation.`);
  if (mappings.length !== 11) throw new Error(`D3 requires exactly 11 reviewed final relinks before mutation; found ${mappings.length}.`);
  const reviewedConfirmed = state.policy.crossSource.confirmed.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING');
  if (reviewedConfirmed.length !== 11) throw new Error(`D3 requires 11 reviewed CONFIRMED components; found ${reviewedConfirmed.length}.`);
  if (state.policy.crossSource.confirmed.some(({ decision, reviewedDecision }) => decision === 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN' && !reviewedDecision)) throw new Error('D3 found an unexpected automatic confirmed relink.');
  if (state.policy.crossSource.possible.some(({ reviewedDecision }) => reviewedDecision)) throw new Error('D3 would implicitly review a POSSIBLE component.');
  if (state.policy.mutationPlan.phases.explicitGeography.length !== 19) throw new Error(`D3 expected 19 known geography NOOP candidates; found ${state.policy.mutationPlan.phases.explicitGeography.length}.`);
  const unresolved = remaining(state.policy);
  if (unresolved.confirmed || unresolved.possible !== 22 || unresolved.sameFeed !== 4 || unresolved.sessionDefer !== 2 || unresolved.activationReady) throw new Error(`D3 pre-apply unresolved state differs: ${JSON.stringify(unresolved)}.`);
  const components = state.audit.currentPublicCandidates.confirmedSummary.conflictComponents;
  const validations = overrides.decisions.map((decision) => {
    const sourceEntries = state.index.byIdentity.get(key(decision.source)) || []; const targetEntries = state.index.byIdentity.get(key(decision.target)) || [];
    if (sourceEntries.length !== 1 || targetEntries.length !== 1) throw new Error(`D3 identity no longer resolves exactly once for ${key(decision.source)}.`);
    const source = sourceEntries[0]; const target = targetEntries[0]; const component = components.find((item) => item.dibaPlanIds.includes(source.planId) && item.candidatePlanIds.includes(target.planId));
    if (target.enabled !== 1 || target.sourceKey.startsWith('diba-') || !component) throw new Error(`D3 reviewed target is invalid for ${key(decision.source)}.`);
    const mapping = mappings.find((item) => key(item.source) === key(decision.source));
    if (!mapping || key(mapping.finalTargetAnchor) !== key(decision.target)) throw new Error(`D3 planner target differs from approved target for ${key(decision.source)}.`);
    return { source: stable(decision.source), target: stable(decision.target), sourcePlanId: source.planId, targetPlanId: target.planId, componentId: component.componentId, status: 'PASS' };
  });
  return { approved, mappings, validations, targetPlanIds: [...new Set(validations.map(({ targetPlanId }) => targetPlanId))] };
}
function remaining(policy) { return { confirmed: policy.crossSource.confirmed.filter(({ decision }) => !['LINK_TO_EXISTING', 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN', 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY'].includes(decision)).length, possible: policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker).length, sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length, sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length, activationReady: policy.activation.publicActivationReady }; }
function assertRealHash(config, stage) { const hash = sha256File(config.databasePath); if (hash !== expectedRealSha) throw new Error(`D3 real DB SHA changed or is unexpected at ${stage}: ${hash}`); return hash; }
function render(output) {
  return `# DIBA M1.4D3 — Human-reviewed CONFIRMED links rehearsal\n\n**REHEARSAL DATABASE ONLY — REAL LOCAL DATABASE NOT MUTATED.**\n\n- Rehearsal: \`${output.rehearsalPath}\`\n- Real DB SHA checkpoints: ${Object.entries(output.realHashes).map(([stage, hash]) => `${stage}=\`${hash}\``).join('; ')}\n- First reviewed relinks: ${output.first.finalRelinks.length}; unexpected: ${output.first.unexpectedRelinks.length}\n- plan_sources cardinality: ${output.first.planSources.before} -> ${output.first.planSources.after}\n- Origin plans / recomputed orphans / inactivated: ${output.first.distinctOriginPlans} / ${output.first.recomputedOrphans.length} / ${output.first.inactivatedOrphans.length}\n- Geography: ${output.first.geography.mutations} mutations, ${output.first.geography.noops} NOOP\n- Protected public differences: ${output.publicProtection.differences.length}\n- Repeat preservation: ${output.repeat.verified.length}/${output.first.finalRelinks.length}\n- Second apply: ${output.second.finalRelinks.length} relinks, ${output.second.inactivatedOrphans.length} new orphans, ${output.second.geography.mutations} geography mutations, ${output.second.geography.noops} NOOP\n- Remaining: CONFIRMED ${output.blockers.confirmed}, POSSIBLE ${output.blockers.possible}, same-feed ${output.blockers.sameFeed}, session DEFER ${output.blockers.sessionDefer}; activation ready: ${output.blockers.activationReady}\n- Integrity: ${output.second.invariantResults.integrity}\n\nCaiguda canonical schedule/location protected: ${output.publicProtection.caigudaProtected}. Gaudí canonical date range protected: ${output.publicProtection.gaudiProtected}.\n`;
}

export async function main(config = loadConfig(), { rehearsalPath = timestampedTarget() } = {}) {
  const realBefore = assertRealHash(config, 'before copy'); const overrides = await loadDibaPolicyOverrides(overridePath); const target = path.resolve(rehearsalPath);
  const preRealState = await policyState(config.databasePath, overrides); const pre = validatePreApply(preRealState, overrides);
  const copy = await cloneDibaRehearsal(config.databasePath, target); const rehearsalPreSha = sha256File(target);
  const rehearsalState = await policyState(target, overrides); const rehearsalPre = validatePreApply(rehearsalState, overrides);
  const preDb = openDatabase(target, { readonly: true }); let beforeSources; let beforeTargets;
  try { beforeSources = countRows(preDb); beforeTargets = targetSnapshot(preDb, rehearsalPre.targetPlanIds); } finally { preDb.close(); }
  const firstApply = await applyDibaPolicyRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overrides }); const realAfterFirst = assertRealHash(config, 'after first apply');
  const approvedKeys = new Set(overrides.decisions.map(({ source }) => key(source))); const unexpectedRelinks = firstApply.finalRelinks.filter(({ source }) => !approvedKeys.has(key(source)));
  if (firstApply.finalRelinks.length !== 11 || unexpectedRelinks.length) throw new Error(`D3 first apply relink scope failed: ${firstApply.finalRelinks.length} relinks, ${unexpectedRelinks.length} unexpected.`);
  const sourceSet = new Set(firstApply.finalRelinks.map(({ source }) => key(source))); if (sourceSet.size !== 11 || [...approvedKeys].some((item) => !sourceSet.has(item))) throw new Error('D3 first apply did not relink exactly the approved stable source identities.');
  const firstDb = openDatabase(target, { readonly: true }); let afterSources; let afterTargets; let orphanChecks;
  try {
    afterSources = countRows(firstDb); afterTargets = targetSnapshot(firstDb, rehearsalPre.targetPlanIds);
    orphanChecks = firstApply.inactivatedOrphans.map(({ planId }) => ({ planId, remainingPlanSources: firstDb.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?').get(planId).count, status: firstDb.prepare('SELECT status FROM plans WHERE id=?').get(planId).status }));
  } finally { firstDb.close(); }
  if (beforeSources !== afterSources) throw new Error('D3 changed plan_sources cardinality.');
  if (orphanChecks.some(({ remainingPlanSources, status }) => remainingPlanSources !== 0 || status !== 'inactive')) throw new Error('D3 orphan inactivation invariant failed.');
  const differences = diffSnapshots(beforeTargets, afterTargets); if (differences.length) throw new Error(`D3 changed ${differences.length} protected public canonical field(s).`);
  const geographyFirst = { mutations: firstApply.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length, noops: firstApply.geography.filter(({ outcome }) => outcome !== 'MUTATED_APPROVED_GEOGRAPHY').length };
  if (geographyFirst.mutations || geographyFirst.noops !== 19) throw new Error(`D3 geography result is not 0 mutations / 19 NOOP: ${JSON.stringify(geographyFirst)}.`);
  const repeat = verifyDibaRepeatPreservation({ databasePath: target, relinks: firstApply.finalRelinks }); if (repeat.verified.length !== 11) throw new Error(`D3 repeat preservation expected 11 links, got ${repeat.verified.length}.`); const realAfterRepeat = assertRealHash(config, 'after repeat preservation');
  const postState = await policyState(target, overrides); const blockers = remaining(postState.policy); if (blockers.confirmed || blockers.possible !== 22 || blockers.sameFeed !== 4 || blockers.sessionDefer !== 2 || blockers.activationReady) throw new Error(`D3 post-apply unresolved state differs: ${JSON.stringify(blockers)}.`);
  const secondApply = await applyDibaPolicyRehearsal({ databasePath: target, realDatabasePath: config.databasePath, overrides }); const realAfterSecond = assertRealHash(config, 'after second apply');
  const geographySecond = { mutations: secondApply.geography.filter(({ outcome }) => outcome === 'MUTATED_APPROVED_GEOGRAPHY').length, noops: secondApply.geography.filter(({ outcome }) => outcome !== 'MUTATED_APPROVED_GEOGRAPHY').length };
  if (secondApply.finalRelinks.length || secondApply.inactivatedOrphans.length || geographySecond.mutations || geographySecond.noops !== 19) throw new Error('D3 second apply is not structurally idempotent.');
  const caiguda = pre.validations.find(({ source }) => source.sourceRecordId === 'escenari1313931136484013581411365170'); const gaudi = pre.validations.find(({ source }) => source.sourceRecordId === 'agendaturisme455505989');
  const output = { generatedAt: new Date().toISOString(), rehearsalPath: target, rehearsalPreSha, copy, realHashes: { beforeCopy: realBefore, afterFirstApply: realAfterFirst, afterRepeatPreservation: realAfterRepeat, afterSecondApply: realAfterSecond, final: assertRealHash(config, 'final') }, preApply: { validations: pre.validations, planner: { finalMappings: pre.mappings.length, reviewedConfirmed: preRealState.policy.crossSource.confirmed.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length, geographyNoops: preRealState.policy.mutationPlan.phases.explicitGeography.length, remaining: remaining(preRealState.policy) } }, first: { finalRelinks: firstApply.finalRelinks, unexpectedRelinks, planSources: { before: beforeSources, after: afterSources }, distinctOriginPlans: new Set(firstApply.finalRelinks.map(({ beforePlanId }) => beforePlanId)).size, recomputedOrphans: firstApply.candidateOrphanPlanIds, inactivatedOrphans: firstApply.inactivatedOrphans, orphanChecks, geography: geographyFirst, invariantResults: firstApply.invariantResults }, publicProtection: { targetPlansCompared: rehearsalPre.targetPlanIds.length, differences, caigudaProtected: Boolean(caiguda), gaudiProtected: Boolean(gaudi) }, repeat, second: { finalRelinks: secondApply.finalRelinks, inactivatedOrphans: secondApply.inactivatedOrphans, geography: geographySecond, invariantResults: secondApply.invariantResults }, blockers };
  const reports = path.join(root, 'data', 'reports'); await mkdir(reports, { recursive: true }); await writeFile(path.join(reports, 'diba-d3-confirmed-rehearsal.json'), `${JSON.stringify(output, null, 2)}\n`); await writeFile(path.join(reports, 'diba-d3-confirmed-rehearsal.md'), render(output));
  console.log(`DIBA D3 reviewed-link rehearsal passed on: ${target}`); return output;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`DIBA D3 reviewed-link rehearsal failed: ${error.message}`); process.exitCode = 1; });
