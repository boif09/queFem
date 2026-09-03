import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase } from '../db/database.js';
import { runDibaQualityAudit } from './dibaQualityAudit.js';
import { identityKey } from './dibaPolicyOverrides.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from './dibaPolicyPlanner.js';

export const D4_CONFIRMATION = 'M1.4D4_REAL_LOCAL_REVIEWED_LINK_APPLY';
export const D4_BASELINE_SHA = '82611672310F855944CBB25EBCE5E1B948AB3DAEF6FBA895D3F2C88FD9AC62E1';
const DIBA_KEYS = ['diba-tourisme', 'diba-escenari', 'diba-museus'];

function comparable(value) { return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); }
function stable(value) { return { sourceKey: value.sourceKey, sourceRecordId: String(value.sourceRecordId) }; }
function remaining(policy) {
  return {
    confirmed: policy.crossSource.confirmed.filter(({ decision }) => !['LINK_TO_EXISTING', 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN', 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY'].includes(decision)).length,
    possible: policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker).length,
    sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length,
    sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length,
    activationReady: policy.activation.publicActivationReady,
  };
}

export function canonicalD4PrimaryLocalPath(config) { return path.resolve(config.projectRoot, 'data', 'quefem.sqlite'); }
export function assertD4AuthorizationArguments({ databasePath, expectedSha, confirmation }, config) {
  const primary = canonicalD4PrimaryLocalPath(config);
  if (databasePath && comparable(databasePath) !== comparable(primary)) throw new Error('D4 authorizes only this repository canonical data/quefem.sqlite path.');
  if (comparable(config.databasePath) !== comparable(primary)) throw new Error('D4 configuration does not point to the canonical primary database path.');
  if (confirmation !== D4_CONFIRMATION) throw new Error('D4 confirmation token is missing or invalid.');
  if (!/^[A-Fa-f0-9]{64}$/.test(expectedSha || '')) throw new Error('D4 requires an exact --expected-sha SHA-256 value.');
  if (expectedSha.toUpperCase() !== D4_BASELINE_SHA) throw new Error('D4 expected SHA must equal the one-time approved D4 baseline.');
  return primary;
}
export function assertD4BackupPath(backupPath, config) {
  const directory = path.resolve(config.projectRoot, 'data', 'backups'); const resolved = path.resolve(backupPath);
  if (path.relative(directory, resolved).startsWith('..') || path.relative(directory, resolved) === '') throw new Error('D4 backup must be a new file below data/backups.');
  return resolved;
}
function sha256File(filePath) { return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }
export function assertD4WritableBaseline({ databasePath, args, config }) {
  const primary = assertD4AuthorizationArguments(args, config);
  if (comparable(databasePath) !== comparable(primary)) throw new Error('D4 writable boundary received a non-canonical primary database path.');
  const actualSha = sha256File(primary);
  if (actualSha !== D4_BASELINE_SHA || actualSha !== args.expectedSha.toUpperCase()) throw new Error(`D4 expected SHA does not match current primary database at writable boundary: ${actualSha}`);
  return { primary, sha256: actualSha };
}
function dibaSourceStates(db) { return db.prepare(`SELECT key, enabled, allows_images FROM sources WHERE key IN (${DIBA_KEYS.map(() => '?').join(',')}) ORDER BY key`).all(...DIBA_KEYS); }
function logicalCounts(db) {
  return {
    plans: db.prepare('SELECT COUNT(*) AS count FROM plans').get().count,
    planSources: db.prepare('SELECT COUNT(*) AS count FROM plan_sources').get().count,
    categories: db.prepare('SELECT COUNT(*) AS count FROM plan_categories').get().count,
    occurrences: db.prepare('SELECT COUNT(*) AS count FROM plan_occurrences').get().count,
    sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
  };
}
export function readonlyD4State(databasePath) {
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true }); const sources = dibaSourceStates(db);
    if (integrity !== 'ok') throw new Error(`D4 integrity_check failed: ${integrity}`);
    if (sources.length !== DIBA_KEYS.length || sources.some(({ enabled, allows_images: images }) => Number(enabled) !== 0 || Number(images) !== 0)) throw new Error('D4 requires DIBA sources disabled and images disabled.');
    return { integrity, sources, counts: logicalCounts(db) };
  } finally { db.close(); }
}
async function policyAt(databasePath, overrides) {
  const auditReport = await runDibaQualityAudit({ databasePath }); const db = openDatabase(databasePath, { readonly: true });
  try { return { auditReport, identityIndex: loadPolicyIdentityIndex(db), policy: planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }) }; } finally { db.close(); }
}
function geographyPreview(db, operations) {
  const plan = db.prepare('SELECT municipality, comarca FROM plans WHERE id=?');
  return operations.map((operation) => {
    const target = plan.get(operation.diagnostic.expectedCurrentTargetPlanId);
    if (!target) throw new Error('D4 geography target disappeared during preflight.');
    const mutate = operation.geography.resolutionType === 'COMARCA_ONLY' ? !target.municipality && !target.comarca : !target.municipality;
    return { source: stable(operation.source), finalTargetAnchor: stable(operation.finalTargetAnchor), outcome: mutate ? 'MUTATION_PROPOSED' : 'NOOP_EXISTING_GEOGRAPHY' };
  });
}
export function validateD4PolicyScope({ auditReport, identityIndex, policy, overrides }) {
  if (!Array.isArray(overrides.decisions) || overrides.decisions.length !== 11 || overrides.decisions.some(({ decision }) => decision !== 'LINK_TO_EXISTING')) throw new Error('D4 requires exactly 11 approved human LINK_TO_EXISTING decisions.');
  const approved = new Map(overrides.decisions.map((decision) => [identityKey(decision.source), decision])); const mappings = policy.mutationPlan.phases.finalSourceMappings;
  const unexpected = mappings.filter(({ source }) => !approved.has(identityKey(source)));
  if (unexpected.length || mappings.length !== 11) throw new Error(`D4 planner scope differs from authorized reviewed links: ${mappings.length} mappings, ${unexpected.length} unexpected.`);
  const reviewedConfirmed = policy.crossSource.confirmed.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING');
  if (reviewedConfirmed.length !== 11) throw new Error(`D4 requires 11 reviewed CONFIRMED components; found ${reviewedConfirmed.length}.`);
  if (policy.crossSource.confirmed.some(({ decision, reviewedDecision }) => decision === 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN' && !reviewedDecision)) throw new Error('D4 found an unexpected automatic relink.');
  const unresolved = remaining(policy);
  if (unresolved.confirmed || unresolved.possible !== 22 || unresolved.sameFeed !== 4 || unresolved.sessionDefer !== 2 || unresolved.activationReady) throw new Error(`D4 unresolved state differs from authorization: ${JSON.stringify(unresolved)}.`);
  const operations = policy.mutationPlan.phases.explicitGeography;
  if (operations.length !== 19) throw new Error(`D4 expected 19 known geography candidates; found ${operations.length}.`);
  const components = auditReport.currentPublicCandidates.confirmedSummary.conflictComponents;
  const validations = overrides.decisions.map((decision) => {
    const sourceEntries = identityIndex.byIdentity.get(identityKey(decision.source)) || []; const targetEntries = identityIndex.byIdentity.get(identityKey(decision.target)) || [];
    if (sourceEntries.length !== 1 || targetEntries.length !== 1) throw new Error(`D4 identity does not resolve exactly once for ${identityKey(decision.source)}.`);
    const source = sourceEntries[0]; const target = targetEntries[0]; const mapping = mappings.find((item) => identityKey(item.source) === identityKey(decision.source));
    const component = components.find((item) => item.dibaPlanIds.includes(source.planId) && item.candidatePlanIds.includes(target.planId));
    if (!source.sourceKey.startsWith('diba-') || Number(source.enabled) !== 0 || target.sourceKey.startsWith('diba-') || Number(target.enabled) !== 1 || !component) throw new Error(`D4 source/target authorization failed for ${identityKey(decision.source)}.`);
    if (!mapping || identityKey(mapping.finalTargetAnchor) !== identityKey(decision.target) || mapping.diagnostic.currentSourcePlanId !== source.planId || mapping.diagnostic.expectedCurrentTargetPlanId !== target.planId) throw new Error(`D4 planner target/topology differs for ${identityKey(decision.source)}.`);
    return { source: stable(decision.source), target: stable(decision.target), sourcePlanId: source.planId, targetPlanId: target.planId, componentId: component.componentId, status: 'PASS' };
  });
  const origins = policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans;
  if (origins.length !== 11 || new Set(origins.map(({ diagnostic }) => diagnostic.originalDibaStagingPlanId)).size !== 11) throw new Error(`D4 expected 11 distinct recomputed orphan candidates; found ${origins.length}.`);
  return { mappings, validations, targetPlanIds: [...new Set(validations.map(({ targetPlanId }) => targetPlanId))], origins, geographyOperations: operations, unresolved, reviewedConfirmed: reviewedConfirmed.length, unexpected };
}
export async function prepareD4ExecutionPlan(databasePath, overrides) {
  const prepared = await policyAt(databasePath, overrides); const scope = validateD4PolicyScope({ ...prepared, overrides });
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const geography = geographyPreview(db, scope.geographyOperations);
    if (geography.some(({ outcome }) => outcome !== 'NOOP_EXISTING_GEOGRAPHY')) throw new Error('D4 would apply a new geography mutation, which is not authorized.');
    return { ...prepared, scope: { ...scope, geography } };
  } finally { db.close(); }
}
export async function preflightD4PrimaryLocal({ args, config, overrides }) {
  const { primary, sha256: actualSha } = assertD4WritableBaseline({ databasePath: canonicalD4PrimaryLocalPath(config), args, config });
  const state = readonlyD4State(primary); const prepared = await prepareD4ExecutionPlan(primary, overrides);
  return { primary, sha256: actualSha, state, prepared };
}
export async function createVerifiedD4Backup(primary, backupPath, config, args) {
  const resolved = assertD4BackupPath(backupPath, config); if (fs.existsSync(resolved)) throw new Error(`D4 backup already exists: ${resolved}`);
  assertD4WritableBaseline({ databasePath: primary, args, config });
  const before = readonlyD4State(primary); fs.mkdirSync(path.dirname(resolved), { recursive: true }); const source = openDatabase(primary, { readonly: true });
  try { await source.backup(resolved); } finally { source.close(); }
  assertD4WritableBaseline({ databasePath: primary, args, config });
  const backup = readonlyD4State(resolved);
  if (JSON.stringify(before.counts) !== JSON.stringify(backup.counts) || JSON.stringify(before.sources) !== JSON.stringify(backup.sources)) throw new Error('D4 verified backup is not logically equivalent to the pre-apply database.');
  return { path: resolved, sha256: sha256File(resolved), integrity: backup.integrity, logicalEquivalent: true, counts: backup.counts, sourceStates: backup.sources };
}
