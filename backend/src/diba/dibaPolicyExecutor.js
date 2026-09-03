import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase } from '../db/database.js';
import { runDibaQualityAudit } from './dibaQualityAudit.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from './dibaPolicyPlanner.js';
import { DibaImporter } from './dibaImporter.js';
import * as primaryLocal from './dibaPolicyPrimaryLocal.js';
import * as d4PrimaryLocal from './dibaPolicyD4PrimaryLocal.js';
import * as e4PrimaryLocal from './dibaPolicyE4PrimaryLocal.js';
import * as stageObserver from './dibaPolicyStageObserver.js';

function comparablePath(value) {
  const absolute = path.resolve(value);
  const normalize = (candidate) => process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  try { return normalize(fs.realpathSync.native(absolute)); }
  catch {
    let existing = absolute; const missing = [];
    while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) return normalize(absolute); missing.unshift(path.basename(existing)); existing = parent; }
    return normalize(path.join(fs.realpathSync.native(existing), ...missing));
  }
}
function sameResolvedPath(left, right) {
  const normalize = (candidate) => process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}
function samePhysicalFile(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  const a = fs.statSync(left); const b = fs.statSync(right); return a.dev === b.dev && a.ino === b.ino;
}
export function sha256File(filePath) { return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase(); }
export function assertC2RehearsalPath(targetPath, realPath) {
  if (!targetPath) throw new Error('DIBA C2 requires an explicit --database rehearsal path.');
  const target = path.resolve(targetPath); const real = path.resolve(realPath);
  if (comparablePath(target) === comparablePath(real) || samePhysicalFile(target, real)) throw new Error('DIBA C2 refuses to write the configured real data/quefem.sqlite database.');
  return target;
}
export async function cloneDibaRehearsal(realPath, targetPath) {
  const target = assertC2RehearsalPath(targetPath, realPath);
  if (fs.existsSync(target)) throw new Error(`DIBA C2 rehearsal target already exists: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // This rehearsal is run only while the local database is not being written.
  // A direct copy is intentional here: it preserves an auditable byte-identical
  // baseline before C2, which a SQLite backup cannot promise.
  fs.copyFileSync(path.resolve(realPath), target, fs.constants.COPYFILE_EXCL);
  const originalSha256 = sha256File(realPath); const rehearsalSha256 = sha256File(target);
  if (originalSha256 !== rehearsalSha256) throw new Error('DIBA C2 rehearsal copy hash differs from the original database.');
  return { originalPath: path.resolve(realPath), originalSha256, rehearsalPath: target, rehearsalSha256 };
}
function stableKey(value) { return `${value.sourceKey}:${value.sourceRecordId}`; }
function dibaStates(db) { return db.prepare("SELECT key, enabled, allows_images FROM sources WHERE key IN ('diba-tourisme','diba-escenari','diba-museus') ORDER BY key").all(); }
function assertDibaStates(states) {
  if (states.length !== 3 || states.some(({ enabled, allows_images: images }) => Number(enabled) !== 0 || Number(images) !== 0)) throw new Error('DIBA C2 requires all three DIBA sources to remain disabled with images disabled.');
}
function protectedPlanSnapshot(db, targetPlanIds) {
  const plans = new Map(); const categories = new Map();
  const getPlan = db.prepare('SELECT * FROM plans WHERE id=?'); const getCategories = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id');
  for (const id of targetPlanIds) { const plan = getPlan.get(id); if (!plan) throw new Error(`Public target plan ${id} disappeared before C2.`); plans.set(id, plan); categories.set(id, getCategories.all(id).map(({ category_id: categoryId }) => categoryId)); }
  return { plans, categories };
}
function equal(value, expected) { return JSON.stringify(value) === JSON.stringify(expected); }
function geographyMutation(db, operation, targetPlanId) {
  const target = db.prepare('SELECT id, municipality, comarca, locality FROM plans WHERE id=?').get(targetPlanId);
  if (!target) throw new Error(`Geography final target plan ${targetPlanId} is missing.`);
  const { geography } = operation;
  const before = { municipality: target.municipality, comarca: target.comarca, locality: target.locality };
  if (geography.resolutionType === 'COMARCA_ONLY') {
    if (target.municipality || target.comarca) return { ...operation, outcome: 'NOOP_EXISTING_GEOGRAPHY', before, after: before };
    db.prepare('UPDATE plans SET comarca=?, updated_at=? WHERE id=?').run(geography.comarca, new Date().toISOString(), target.id);
  } else {
    if (target.municipality) return { ...operation, outcome: 'NOOP_EXISTING_GEOGRAPHY', before, after: before };
    db.prepare('UPDATE plans SET municipality=?, updated_at=? WHERE id=?').run(geography.municipality, new Date().toISOString(), target.id);
  }
  const afterRow = db.prepare('SELECT municipality, comarca, locality FROM plans WHERE id=?').get(target.id);
  return { ...operation, outcome: 'MUTATED_APPROVED_GEOGRAPHY', before, after: afterRow };
}

function prepareExecutionPlan(databasePath, overrides) {
  return runDibaQualityAudit({ databasePath }).then((auditReport) => {
    const db = openDatabase(databasePath, { readonly: true });
    try { return { auditReport, policy: planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }) }; } finally { db.close(); }
  });
}
async function executeDibaPolicyTransaction({ databasePath, overrides, preparePlan = prepareExecutionPlan, d4Authorization, e4Authorization }) {
  const rehearsalPath = path.resolve(databasePath);
  if (!fs.existsSync(rehearsalPath)) throw new Error(`DIBA C2 rehearsal database does not exist: ${rehearsalPath}`);
  const rehearsalBefore = sha256File(rehearsalPath);
  const { policy } = await preparePlan(rehearsalPath, overrides);
  const mappings = policy.mutationPlan.phases.finalSourceMappings;
  if (d4Authorization) {
    // Keep this after every read-only planning step and directly before the
    // first writable open: an earlier repeat would leave the D4 TOCTOU open.
    d4PrimaryLocal.assertD4WritableBaseline({ databasePath: rehearsalPath, ...d4Authorization });
    stageObserver.notifyDibaPolicyStage('d4-before-transaction');
  }
  if (e4Authorization) {
    // This is the final E4 TOCTOU gate immediately before the first writable open.
    e4PrimaryLocal.assertE4WritableBaseline({ databasePath: rehearsalPath, ...e4Authorization });
    stageObserver.notifyDibaPolicyStage('e4-before-transaction');
  }
  const db = openDatabase(rehearsalPath); let result;
  try {
    result = db.transaction(() => {
      const statesBefore = dibaStates(db); assertDibaStates(statesBefore);
      const find = db.prepare(`SELECT ps.id, ps.plan_id AS planId, s.key AS sourceKey, ps.source_record_id AS sourceRecordId, s.enabled, s.allows_images AS allowsImages
        FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key=? AND ps.source_record_id=?`);
      const resolved = mappings.map((mapping) => {
        const source = find.all(mapping.source.sourceKey, mapping.source.sourceRecordId);
        const target = find.all(mapping.finalTargetAnchor.sourceKey, mapping.finalTargetAnchor.sourceRecordId);
        if (source.length !== 1 || target.length !== 1) throw new Error(`C2 stable identity resolution failed for ${stableKey(mapping.source)}.`);
        if (source[0].planId !== mapping.diagnostic.currentSourcePlanId) throw new Error(`C2 source topology changed for ${stableKey(mapping.source)}.`);
        if (Number(source[0].enabled) !== 0 || Number(source[0].allowsImages) !== 0) throw new Error(`C2 source configuration changed for ${stableKey(mapping.source)}.`);
        if (target[0].planId !== mapping.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 target topology changed for ${stableKey(mapping.source)}.`);
        return { mapping, source: source[0], target: target[0] };
      });
      const resolvedGeography = policy.mutationPlan.phases.explicitGeography.map((operation) => {
        const target = find.all(operation.finalTargetAnchor.sourceKey, operation.finalTargetAnchor.sourceRecordId);
        if (target.length !== 1) throw new Error(`C2 geography stable identity resolution failed for ${stableKey(operation.finalTargetAnchor)}.`);
        if (target[0].planId !== operation.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 geography target topology changed for ${stableKey(operation.source)}.`);
        return { operation, target: target[0] };
      });
      const sourceKeys = new Set(resolved.map(({ mapping }) => stableKey(mapping.source))); if (sourceKeys.size !== resolved.length) throw new Error('C2 final source mappings are not unique.');
      const hasEnabledSource = db.prepare(`SELECT 1 FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
        WHERE ps.plan_id=? AND s.enabled=1 LIMIT 1`);
      const targetPlanIds = [...new Set([...resolved.map(({ target }) => target.planId), ...resolvedGeography.map(({ target }) => target.planId)])];
      const publicTargetIds = targetPlanIds.filter((planId) => hasEnabledSource.get(planId));
      const protectedBefore = protectedPlanSnapshot(db, publicTargetIds);
      const candidateOrphanPlanIds = [...new Set(resolved.map(({ source }) => source.planId))];
      const relink = db.prepare('UPDATE plan_sources SET plan_id=? WHERE id=? AND plan_id=?');
      const relinks = [];
      for (const item of resolved) {
        const changed = relink.run(item.target.planId, item.source.id, item.source.planId).changes;
        if (changed !== 1) throw new Error(`C2 relink failed for ${stableKey(item.mapping.source)}.`);
        relinks.push({ source: item.mapping.source, finalTargetAnchor: item.mapping.finalTargetAnchor, beforePlanId: item.source.planId, afterPlanId: item.target.planId });
      }
      const geography = resolvedGeography.map(({ operation, target }) => geographyMutation(db, operation, target.planId));
      const countSources = db.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?');
      const planSources = db.prepare(`SELECT s.key, s.enabled FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=?`);
      const inactivate = db.prepare("UPDATE plans SET status='inactive', inactive_at=?, updated_at=? WHERE id=? AND status<>'inactive'");
      const orphans = [];
      for (const planId of candidateOrphanPlanIds) {
        if (countSources.get(planId).count !== 0) continue;
        const prior = resolved.filter(({ source }) => source.planId === planId).map(({ mapping }) => mapping.source);
        if (!prior.length || planSources.all(planId).some(({ key, enabled }) => !String(key).startsWith('diba-') || Number(enabled) !== 0)) throw new Error(`C2 refuses unsafe orphan inactivation for plan ${planId}.`);
        inactivate.run(new Date().toISOString(), new Date().toISOString(), planId); orphans.push({ planId, originalSources: prior });
      }
      for (const { mapping } of resolved) {
        const current = find.all(mapping.source.sourceKey, mapping.source.sourceRecordId);
        if (current.length !== 1 || current[0].planId !== mapping.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 final mapping invariant failed for ${stableKey(mapping.source)}.`);
      }
      const duplicate = db.prepare('SELECT source_id, source_record_id FROM plan_sources GROUP BY source_id, source_record_id HAVING COUNT(*)>1 LIMIT 1').get(); if (duplicate) throw new Error('C2 provenance uniqueness invariant failed.');
      for (const orphan of orphans) if (countSources.get(orphan.planId).count !== 0) throw new Error(`C2 orphan invariant failed for plan ${orphan.planId}.`);
      for (const [planId, before] of protectedBefore.plans) {
        const after = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
        for (const field of ['original_title', 'original_description', 'start_date', 'end_date', 'venue_name', 'address', 'latitude', 'longitude', 'website_url', 'status', 'featured', 'quality_score', 'image_url', 'ticket_url']) if (after[field] !== before[field]) throw new Error(`C2 public canonical field changed: ${field} on plan ${planId}.`);
        if (!equal(protectedBefore.categories.get(planId), db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id').all(planId).map(({ category_id: id }) => id))) throw new Error(`C2 categories changed on public plan ${planId}.`);
      }
      const statesAfter = dibaStates(db); assertDibaStates(statesAfter);
      const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`C2 integrity_check failed: ${integrity}`);
      return { finalRelinks: relinks, geography, candidateOrphanPlanIds, inactivatedOrphans: orphans, invariantResults: { provenance: 'pass', publicCanonical: 'pass', geography: 'pass', sourceConfiguration: 'pass', orphans: 'pass', integrity: 'ok', activationRemainsBlocked: policy.activation.publicActivationReady === false }, sourceStates: statesAfter, activation: policy.activation, summary: policy.summary };
    })();
  } finally { db.close(); }
  return { rehearsalDatabasePath: rehearsalPath, rehearsalSha256Before: rehearsalBefore, rehearsalSha256After: sha256File(rehearsalPath), ...result };
}
export async function applyDibaPolicyRehearsal({ databasePath, realDatabasePath, overrides, preparePlan = prepareExecutionPlan }) {
  const rehearsalPath = assertC2RehearsalPath(databasePath, realDatabasePath);
  const originalBefore = sha256File(realDatabasePath);
  const result = await executeDibaPolicyTransaction({ databasePath: rehearsalPath, overrides, preparePlan });
  const originalAfter = sha256File(realDatabasePath); if (originalBefore !== originalAfter) throw new Error('DIBA C2 detected a change to the original database.');
  return { ...result, originalDatabasePath: path.resolve(realDatabasePath), originalSha256Before: originalBefore, originalSha256After: originalAfter };
}
export async function applyDibaPolicyPrimaryLocal({ args, config, overrides, backupPath }) {
  // The primary path is derived here, at the writable boundary, rather than
  // accepted from a helper result. This remains true under NODE_ENV=test.
  const primary = path.resolve(config.projectRoot, 'data', 'quefem.sqlite');
  stageObserver.notifyDibaPolicyStage('preflight');
  const pre = await primaryLocal.preflightC3PrimaryLocal({ args, config, overrides });
  if (!sameResolvedPath(pre.primary, primary)) throw new Error('C3 preflight returned a non-canonical primary database path.');
  stageObserver.notifyDibaPolicyStage('backup');
  const backup = await primaryLocal.createVerifiedC3Backup(primary, backupPath);
  stageObserver.notifyDibaPolicyStage('before-transaction');
  const apply = await executeDibaPolicyTransaction({ databasePath: primary, overrides });
  stageObserver.notifyDibaPolicyStage('after-transaction');
  const post = primaryLocal.readonlyC3State(primary);
  return { pre, backup, apply, post, postSha256: sha256File(primary) };
}
export async function applyDibaPolicyD4PrimaryLocal({ args, config, overrides, backupPath }) {
  const primary = path.resolve(config.projectRoot, 'data', 'quefem.sqlite');
  const pre = await d4PrimaryLocal.preflightD4PrimaryLocal({ args, config, overrides });
  if (!sameResolvedPath(pre.primary, primary)) throw new Error('D4 preflight returned a non-canonical primary database path.');
  const backup = await d4PrimaryLocal.createVerifiedD4Backup(primary, backupPath, config, args);
  const apply = await executeDibaPolicyTransaction({ databasePath: primary, overrides, preparePlan: d4PrimaryLocal.prepareD4ExecutionPlan, d4Authorization: { args, config } });
  const post = d4PrimaryLocal.readonlyD4State(primary);
  return { pre, backup, apply, post, postSha256: sha256File(primary) };
}
export async function applyDibaPolicyE4PrimaryLocal({ args, config, overrides, backupPath }) {
  const primary = path.resolve(config.projectRoot, 'data', 'quefem.sqlite');
  const pre = await e4PrimaryLocal.preflightE4PrimaryLocal({ args, config, overrides });
  if (!sameResolvedPath(pre.primary, primary)) throw new Error('E4 preflight returned a non-canonical primary database path.');
  const backup = await e4PrimaryLocal.createVerifiedE4Backup(primary, backupPath, config, args);
  const apply = await executeDibaPolicyTransaction({ databasePath: primary, overrides, preparePlan: e4PrimaryLocal.prepareE4ExecutionPlan, e4Authorization: { args, config } });
  const post = e4PrimaryLocal.readonlyE4State(primary);
  return { pre, backup, apply, post, postSha256: sha256File(primary) };
}

// This exercises the exact existing-source lookup used before the importer
// persists a DIBA row. It is deliberately read-only and uses the rehearsal's
// persisted provenance rather than a live, variable network snapshot.
export function verifyDibaRepeatPreservation({ databasePath, relinks }) {
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const importer = new DibaImporter({ db, client: { fetchDataset: async () => ({ records: [] }) } });
    const verified = relinks.map(({ source, afterPlanId }) => {
      const registered = importer.sourceByKey.get(source.sourceKey);
      const existing = registered && importer.findExistingSource.get(registered.id, source.sourceRecordId);
      if (!existing || existing.plan_id !== afterPlanId) throw new Error(`DIBA repeat preservation failed for ${stableKey(source)}.`);
      return { source, planId: existing.plan_id };
    });
    const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`DIBA repeat rehearsal integrity failed: ${integrity}`);
    return { method: 'read-only DibaImporter existing-source lookup against persisted rehearsal provenance', verified, oldStagingPlansRecreated: false, integrity };
  } finally { db.close(); }
}
