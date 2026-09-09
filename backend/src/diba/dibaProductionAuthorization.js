import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase } from '../db/database.js';
import { auditDibaQuality, municipalityReferencesFromSnapshot } from './dibaQualityAudit.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from '../jobs/updateIcgcGeography.js';
import { loadDibaPolicyOverrides, validateDibaPolicyOverrides } from './dibaPolicyOverrides.js';
import { loadFinalReviewDecisions, validateFinalReviewDecisions } from './dibaFinalReviewDecisions.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from './dibaPolicyPlanner.js';
import { prepareFinalReviewPlanForDatabase } from './dibaFinalReviewPolicy.js';
import { cloneDibaRehearsal, sha256File } from './dibaPolicyExecutor.js';
import * as stageObserver from './dibaPolicyStageObserver.js';

const MIGRATION = '011_seed_diba_sources.sql';
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex').toUpperCase();
const stableId = (value) => `${value.sourceKey}:${value.sourceRecordId}`;
const normalizedPath = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const sqlIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
function sqliteRecoveryFingerprint(db) {
  const hash = createHash('sha256');
  const schema = db.prepare("SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name,tbl_name").all();
  const tableMetadata = new Map(db.prepare('PRAGMA table_list').all().filter(({ schema: database }) => database === 'main').map((table) => [table.name, table]));
  hash.update(canonical({ applicationId: db.pragma('application_id', { simple: true }), userVersion: db.pragma('user_version', { simple: true }), schema }));
  for (const { name } of schema.filter(({ type }) => type === 'table').sort((left, right) => left.name.localeCompare(right.name))) {
    const columns = db.prepare(`PRAGMA table_xinfo(${sqlIdentifier(name)})`).all().filter(({ hidden }) => Number(hidden) !== 1).map(({ name: column }) => column);
    const lowerColumns = new Set(columns.map((column) => column.toLowerCase())); const rowIdAlias = Number(tableMetadata.get(name)?.wr) === 0 ? ['rowid', '_rowid_', 'oid'].find((alias) => !lowerColumns.has(alias)) : null;
    const recoverableColumns = [...(rowIdAlias ? [rowIdAlias] : []), ...columns];
    const expressions = recoverableColumns.flatMap((column) => [`typeof(${sqlIdentifier(column)})`, `hex(CAST(${sqlIdentifier(column)} AS BLOB))`]);
    const rows = expressions.length ? db.prepare(`SELECT ${expressions.join(',')} FROM ${sqlIdentifier(name)}`).raw().all().map(canonical).sort() : [];
    hash.update(canonical({ table: name, columns: recoverableColumns, rows }));
  }
  return hash.digest('hex').toUpperCase();
}

function canonicalProductionPath(config) { return path.resolve(config.projectRoot, 'data', 'quefem.sqlite'); }
function fileIdentity(filePath) { const stat = fs.statSync(filePath); return { dev: stat.dev, ino: stat.ino }; }
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function assertPhysicalPrimary(databasePath, expectedIdentity = null) {
  const entry = fs.lstatSync(databasePath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('DIBA production workflow refuses a symlink or non-file primary database path.');
  if (normalizedPath(fs.realpathSync.native(databasePath)) !== normalizedPath(databasePath)) throw new Error('DIBA production workflow refuses a canonical primary database path alias.');
  const identity = fileIdentity(databasePath);
  if (expectedIdentity && !sameIdentity(identity, expectedIdentity)) throw new Error('DIBA production primary database identity changed before writable boundary.');
  return identity;
}
function primary(config, expectedIdentity = null) {
  const target = canonicalProductionPath(config);
  if (normalizedPath(path.resolve(config.databasePath)) !== normalizedPath(target)) throw new Error('DIBA production workflow refuses a redirected configured database path.');
  return { path: target, identity: assertPhysicalPrimary(target, expectedIdentity) };
}
function assertOpenedPrimary(db, databasePath, expectedIdentity) {
  assertPhysicalPrimary(databasePath, expectedIdentity);
  const opened = db.prepare('PRAGMA database_list').all().find(({ name }) => name === 'main')?.file;
  if (!opened || normalizedPath(fs.realpathSync.native(opened)) !== normalizedPath(databasePath)) throw new Error('DIBA production writable connection is not the authorized primary database.');
}
function required(db) {
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE filename=?').get(MIGRATION)) throw new Error('DIBA production workflow requires migration 011.');
  const sources = db.prepare("SELECT key,enabled,allows_images FROM sources WHERE key LIKE 'diba-%' ORDER BY key").all();
  if (sources.length !== 3 || sources.some((row) => Number(row.enabled) || Number(row.allows_images))) throw new Error('DIBA production workflow requires all three DIBA sources disabled with images disabled.');
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`DIBA production workflow integrity_check failed: ${integrity}`);
  return { sources, integrity };
}
function topology(db) {
  return db.prepare(`SELECT s.key AS sourceKey,ps.source_record_id AS sourceRecordId,ps.plan_id AS planId,p.status
    FROM plan_sources ps JOIN sources s ON s.id=ps.source_id JOIN plans p ON p.id=ps.plan_id
    WHERE s.key LIKE 'diba-%' ORDER BY s.key,ps.source_record_id`).all()
    .map((row) => ({ ...row, sourceRecordId: String(row.sourceRecordId) }));
}
function operationSet(policy, finalReview) {
  return {
    c2: policy.mutationPlan.phases.finalSourceMappings.map(({ source, finalTargetAnchor, diagnostic }) => ({ source, finalTargetAnchor, diagnostic })).sort((a, b) => stableId(a.source).localeCompare(stableId(b.source))),
    geography: policy.mutationPlan.phases.explicitGeography.map(({ source, finalTargetAnchor, geography, diagnostic }) => ({ source, finalTargetAnchor, geography, diagnostic })).sort((a, b) => stableId(a.source).localeCompare(stableId(b.source))),
    final: finalReview ? finalReview.reviewed.map(({ disposition, sourceMembers, canonicalSourceIdentity }) => ({ disposition, sourceMembers: [...sourceMembers].sort((a, b) => stableId(a).localeCompare(stableId(b))), canonicalSourceIdentity })).sort((a, b) => canonical(a).localeCompare(canonical(b))) : [],
  };
}
function state(db, inputs, databasePath, includeFinal = false) {
  const req = required(db);
  const audit = auditDibaQuality(db, { databasePath, municipalityReferences: inputs.municipalityReferences });
  const policy = planDibaPolicy({ auditReport: audit, overrides: inputs.overrides, identityIndex: loadPolicyIdentityIndex(db) });
  const finalReview = includeFinal ? prepareFinalReviewPlanForDatabase({ db, databasePath, overrides: inputs.overrides, decisions: inputs.decisions, auditReport: audit }) : null;
  if (finalReview && (!finalReview.humanReviewActivationGateReady || finalReview.unresolvedFinalHumanComponents !== 0)) throw new Error('DIBA production workflow has unresolved final human blockers.');
  const operations = operationSet(policy, finalReview);
  const logicalState = { migration: MIGRATION, sources: req.sources, topology: topology(db), c2: operations.c2, geography: operations.geography, finalDecisions: inputs.decisions.decisions };
  return { req, audit, policy, finalReview, operations, logicalStateFingerprint: fingerprint(logicalState), mutationPlanFingerprint: fingerprint(operations) };
}
async function loadInputs({ overridePath, decisionPath, manifestPath = DEFAULT_ICGC_MANIFEST_PATH }) {
  const overrides = await loadDibaPolicyOverrides(overridePath); const decisions = loadFinalReviewDecisions(decisionPath);
  if (overrides.decisions.length !== 38 || decisions.decisions.length !== 5) throw new Error('DIBA production review decision inventory is not exact.');
  const snapshot = await readAndVerifyIcgcSnapshot(manifestPath);
  return { overrides, decisions, municipalityReferences: municipalityReferencesFromSnapshot(snapshot.snapshot), decisionFilesFingerprint: fingerprint({ overrides: overrides.decisions, final: decisions.decisions }) };
}
async function preflight({ config, overridePath, decisionPath, manifestPath }) {
  const primaryFile = primary(config); const inputs = await loadInputs({ overridePath, decisionPath, manifestPath });
  const db = openDatabase(primaryFile.path, { readonly: true });
  try { return { databasePath: primaryFile.path, databaseIdentity: primaryFile.identity, overridePath, decisionPath, inputs, state: state(db, inputs, primaryFile.path) }; }
  finally { db.close(); }
}
function authorization(pre) { return fingerprint({ databasePath: pre.databasePath, logicalStateFingerprint: pre.state.logicalStateFingerprint, mutationPlanFingerprint: pre.state.mutationPlanFingerprint, decisionFilesFingerprint: pre.inputs.decisionFilesFingerprint }); }
function currentDecisionFilesFingerprint(pre) {
  const overrides = validateDibaPolicyOverrides(JSON.parse(fs.readFileSync(pre.overridePath, 'utf8')));
  const decisions = validateFinalReviewDecisions(JSON.parse(fs.readFileSync(pre.decisionPath, 'utf8')));
  return fingerprint({ overrides: overrides.decisions, final: decisions.decisions });
}

function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function dibaStates(db) { return db.prepare("SELECT key,enabled,allows_images FROM sources WHERE key IN ('diba-tourisme','diba-escenari','diba-museus') ORDER BY key").all(); }
function assertDibaStates(rows) {
  if (rows.length !== 3 || rows.some(({ enabled, allows_images: images }) => Number(enabled) !== 0 || Number(images) !== 0)) throw new Error('DIBA production reconciliation requires all three DIBA sources disabled with images disabled.');
}
function protectedPlanSnapshot(db, targetPlanIds) {
  const plans = new Map(); const categories = new Map(); const getPlan = db.prepare('SELECT * FROM plans WHERE id=?'); const getCategories = db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id');
  for (const planId of targetPlanIds) { const plan = getPlan.get(planId); if (!plan) throw new Error(`Public target plan ${planId} disappeared before production reconciliation.`); plans.set(planId, plan); categories.set(planId, getCategories.all(planId).map(({ category_id: categoryId }) => categoryId)); }
  return { plans, categories };
}
function geographyMutation(db, operation, targetPlanId) {
  const target = db.prepare('SELECT id,municipality,comarca,locality FROM plans WHERE id=?').get(targetPlanId);
  if (!target) throw new Error(`Geography final target plan ${targetPlanId} is missing.`);
  const before = { municipality: target.municipality, comarca: target.comarca, locality: target.locality }; const { geography } = operation;
  if (geography.resolutionType === 'COMARCA_ONLY') {
    if (target.municipality || target.comarca) return { ...operation, outcome: 'NOOP_EXISTING_GEOGRAPHY', before, after: before };
    db.prepare('UPDATE plans SET comarca=?,updated_at=? WHERE id=?').run(geography.comarca, new Date().toISOString(), target.id);
  } else {
    if (target.municipality) return { ...operation, outcome: 'NOOP_EXISTING_GEOGRAPHY', before, after: before };
    db.prepare('UPDATE plans SET municipality=?,updated_at=? WHERE id=?').run(geography.municipality, new Date().toISOString(), target.id);
  }
  return { ...operation, outcome: 'MUTATED_APPROVED_GEOGRAPHY', before, after: db.prepare('SELECT municipality,comarca,locality FROM plans WHERE id=?').get(target.id) };
}
function executeProductionC2Body(db, policy) {
  const statesBefore = dibaStates(db); assertDibaStates(statesBefore); const mappings = policy.mutationPlan.phases.finalSourceMappings;
  const find = db.prepare(`SELECT ps.id,ps.plan_id AS planId,s.key AS sourceKey,ps.source_record_id AS sourceRecordId,s.enabled,s.allows_images AS allowsImages
    FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key=? AND ps.source_record_id=?`);
  const resolved = mappings.map((mapping) => {
    const source = find.all(mapping.source.sourceKey, mapping.source.sourceRecordId); const target = find.all(mapping.finalTargetAnchor.sourceKey, mapping.finalTargetAnchor.sourceRecordId);
    if (source.length !== 1 || target.length !== 1) throw new Error(`C2 stable identity resolution failed for ${stableId(mapping.source)}.`);
    if (source[0].planId !== mapping.diagnostic.currentSourcePlanId) throw new Error(`C2 source topology changed for ${stableId(mapping.source)}.`);
    if (Number(source[0].enabled) !== 0 || Number(source[0].allowsImages) !== 0) throw new Error(`C2 source configuration changed for ${stableId(mapping.source)}.`);
    if (target[0].planId !== mapping.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 target topology changed for ${stableId(mapping.source)}.`);
    return { mapping, source: source[0], target: target[0] };
  });
  const resolvedGeography = policy.mutationPlan.phases.explicitGeography.map((operation) => {
    const target = find.all(operation.finalTargetAnchor.sourceKey, operation.finalTargetAnchor.sourceRecordId);
    if (target.length !== 1) throw new Error(`C2 geography stable identity resolution failed for ${stableId(operation.finalTargetAnchor)}.`);
    if (target[0].planId !== operation.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 geography target topology changed for ${stableId(operation.source)}.`);
    return { operation, target: target[0] };
  });
  if (new Set(resolved.map(({ mapping }) => stableId(mapping.source))).size !== resolved.length) throw new Error('C2 final source mappings are not unique.');
  const hasEnabledSource = db.prepare('SELECT 1 FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.enabled=1 LIMIT 1');
  const targetPlanIds = [...new Set([...resolved.map(({ target }) => target.planId), ...resolvedGeography.map(({ target }) => target.planId)])];
  const protectedBefore = protectedPlanSnapshot(db, targetPlanIds.filter((planId) => hasEnabledSource.get(planId)));
  const candidateOrphanPlanIds = [...new Set(resolved.map(({ source }) => source.planId))]; const relink = db.prepare('UPDATE plan_sources SET plan_id=? WHERE id=? AND plan_id=?'); const relinks = [];
  for (const item of resolved) { if (relink.run(item.target.planId, item.source.id, item.source.planId).changes !== 1) throw new Error(`C2 relink failed for ${stableId(item.mapping.source)}.`); relinks.push({ source: item.mapping.source, finalTargetAnchor: item.mapping.finalTargetAnchor, beforePlanId: item.source.planId, afterPlanId: item.target.planId }); }
  const geography = resolvedGeography.map(({ operation, target }) => geographyMutation(db, operation, target.planId));
  const countSources = db.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?'); const planSources = db.prepare('SELECT s.key,s.enabled FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=?'); const inactivate = db.prepare("UPDATE plans SET status='inactive',inactive_at=?,updated_at=? WHERE id=? AND status<>'inactive'"); const orphans = [];
  for (const planId of candidateOrphanPlanIds) {
    if (countSources.get(planId).count !== 0) continue;
    const prior = resolved.filter(({ source }) => source.planId === planId).map(({ mapping }) => mapping.source);
    if (!prior.length || planSources.all(planId).some(({ key, enabled }) => !String(key).startsWith('diba-') || Number(enabled) !== 0)) throw new Error(`C2 refuses unsafe orphan inactivation for plan ${planId}.`);
    const now = new Date().toISOString(); inactivate.run(now, now, planId); orphans.push({ planId, originalSources: prior });
  }
  for (const { mapping } of resolved) { const current = find.all(mapping.source.sourceKey, mapping.source.sourceRecordId); if (current.length !== 1 || current[0].planId !== mapping.diagnostic.expectedCurrentTargetPlanId) throw new Error(`C2 final mapping invariant failed for ${stableId(mapping.source)}.`); }
  if (db.prepare('SELECT 1 FROM plan_sources GROUP BY source_id,source_record_id HAVING COUNT(*)>1 LIMIT 1').get()) throw new Error('C2 provenance uniqueness invariant failed.');
  for (const orphan of orphans) if (countSources.get(orphan.planId).count !== 0) throw new Error(`C2 orphan invariant failed for plan ${orphan.planId}.`);
  for (const [planId, before] of protectedBefore.plans) {
    const after = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    for (const field of ['original_title', 'original_description', 'start_date', 'end_date', 'venue_name', 'address', 'latitude', 'longitude', 'website_url', 'status', 'featured', 'quality_score', 'image_url', 'ticket_url']) if (after[field] !== before[field]) throw new Error(`C2 public canonical field changed: ${field} on plan ${planId}.`);
    if (!equal(protectedBefore.categories.get(planId), db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id').all(planId).map(({ category_id: categoryId }) => categoryId))) throw new Error(`C2 categories changed on public plan ${planId}.`);
  }
  const statesAfter = dibaStates(db); assertDibaStates(statesAfter); const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`C2 integrity_check failed: ${integrity}`);
  return { finalRelinks: relinks, geography, candidateOrphanPlanIds, inactivatedOrphans: orphans, invariantResults: { provenance: 'pass', publicCanonical: 'pass', geography: 'pass', sourceConfiguration: 'pass', orphans: 'pass', integrity: 'ok', activationRemainsBlocked: policy.activation.publicActivationReady === false }, sourceStates: statesAfter, activation: policy.activation, summary: policy.summary };
}
function finalSourceRows(db, planId) { return db.prepare('SELECT s.key AS sourceKey,s.enabled,ps.source_record_id AS sourceRecordId FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? ORDER BY s.key,ps.source_record_id').all(planId).map((row) => ({ ...row, sourceRecordId: String(row.sourceRecordId) })); }
function finalPlanSnapshot(db, planId) { const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId); if (!plan) throw new Error(`Final review plan ${planId} is missing.`); return { plan, categories: db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id').all(planId).map(({ category_id: categoryId }) => categoryId) }; }
function executeProductionFinalReviewBody(db, prepared) {
  assertDibaStates(dibaStates(db)); const relink = db.prepare('UPDATE plan_sources SET plan_id=? WHERE source_id=(SELECT id FROM sources WHERE key=?) AND source_record_id=? AND plan_id=?'); const inactive = db.prepare("UPDATE plans SET status='inactive',inactive_at=?,updated_at=? WHERE id=? AND status<>'inactive'"); const sourceCount = db.prepare('SELECT COUNT(*) AS count FROM plan_sources WHERE plan_id=?'); const now = new Date().toISOString(); const relinks = []; const orphans = []; const deferredInactivePlans = [];
  for (const decision of prepared.reviewed.filter(({ disposition }) => disposition === 'CONSOLIDATE_TO_ONE_PLAN')) {
    const survivor = decision.canonical; const before = finalPlanSnapshot(db, survivor.planId);
    for (const moved of decision.moved) { if (moved.planId === survivor.planId) continue; if (relink.run(survivor.planId, moved.source.sourceKey, moved.source.sourceRecordId, moved.planId).changes !== 1) throw new Error(`Final DIBA consolidation relink failed for ${stableId(moved.source)}.`); relinks.push({ source: moved.source, canonicalSourceIdentity: decision.canonicalSourceIdentity, beforePlanId: moved.planId, afterPlanId: survivor.planId }); if (sourceCount.get(moved.planId).count === 0) { inactive.run(now, now, moved.planId); orphans.push({ planId: moved.planId, source: moved.source }); } }
    if (!equal(before, finalPlanSnapshot(db, survivor.planId))) throw new Error(`Final DIBA consolidation changed canonical fields for ${stableId(survivor.source)}.`);
  }
  for (const decision of prepared.reviewed.filter(({ disposition }) => disposition === 'DEFER')) for (const affected of decision.affectedPlans) { const provenance = finalSourceRows(db, affected.planId); const covered = new Set(decision.sourceMembers.map(stableId)); if (provenance.some(({ sourceKey, sourceRecordId }) => !String(sourceKey).startsWith('diba-') || !covered.has(`${sourceKey}:${sourceRecordId}`))) throw new Error(`Final DIBA DEFER refuses shared/public plan ${affected.planId}.`); if (inactive.run(now, now, affected.planId).changes) deferredInactivePlans.push({ planId: affected.planId, sources: provenance.map(({ sourceKey, sourceRecordId }) => ({ sourceKey, sourceRecordId })) }); }
  if (db.prepare('SELECT 1 FROM plan_sources GROUP BY source_id,source_record_id HAVING COUNT(*)>1 LIMIT 1').get()) throw new Error('Final DIBA production reconciliation found duplicate stable provenance.'); const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok') throw new Error(`Final DIBA integrity_check failed: ${integrity}`); assertDibaStates(dibaStates(db));
  return { relinks, consolidationOrphans: orphans, deferredInactivePlans, integrity };
}
function executeAuthorizedProductionTransaction({ db, prepareFinalReview, revalidateLockedState, validateFinalState }) {
  let c2; let final; db.exec('BEGIN IMMEDIATE');
  try { const lockedPolicy = revalidateLockedState(); c2 = executeProductionC2Body(db, lockedPolicy); final = executeProductionFinalReviewBody(db, prepareFinalReview()); validateFinalState(); db.exec('COMMIT'); }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  return { c2, final };
}

export async function prepareProductionPreview({ config, overridePath, decisionPath, manifestPath, temporaryDirectory = os.tmpdir() }) {
  const pre = await preflight({ config, overridePath, decisionPath, manifestPath });
  const directory = fs.mkdtempSync(path.join(temporaryDirectory, 'tenspla-diba-preview-')); const target = path.join(directory, 'preview.sqlite');
  try {
    const copied = await cloneDibaRehearsal(pre.databasePath, target); const db = openDatabase(target); let post;
    try {
      const applied = executeAuthorizedProductionTransaction({
        db,
        prepareFinalReview: () => { post = state(db, pre.inputs, target, true); return post.finalReview; },
        revalidateLockedState: () => pre.state.policy, validateFinalState: () => required(db),
      });
      return { generatedAt: new Date().toISOString(), databasePath: pre.databasePath, productionDatabaseMutation: false, mainDatabaseFileSha256: sha256File(pre.databasePath), logicalStateFingerprint: pre.state.logicalStateFingerprint, mutationPlanFingerprint: pre.state.mutationPlanFingerprint, decisionFilesFingerprint: pre.inputs.decisionFilesFingerprint, authorization: authorization(pre), sources: pre.state.req.sources, blockers: pre.state.policy.activation.blockers, expectedC2Effects: { relinks: applied.c2.finalRelinks, geography: applied.c2.geography, orphanInactivations: applied.c2.inactivatedOrphans }, expectedPostC2FinalReviewEffects: post.operations.final, finalReview: { unresolvedFinalHumanComponents: post.finalReview.unresolvedFinalHumanComponents, humanReviewActivationGateReady: post.finalReview.humanReviewActivationGateReady }, snapshot: { sourceAdvancedDuringBackup: copied.sourceAdvancedDuringBackup, integrity: copied.rehearsalSnapshot } };
    } finally { db.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function backup(primaryPath, backupPath, pre) {
  const copied = await cloneDibaRehearsal(primaryPath, backupPath); const db = openDatabase(backupPath, { readonly: true });
  try {
    const backupState = state(db, pre.inputs, backupPath);
    if (backupState.logicalStateFingerprint !== pre.state.logicalStateFingerprint) throw new Error('DIBA production backup logical state does not match authorization.');
    return { path: path.resolve(backupPath), sha256: sha256File(backupPath), recoveryFingerprint: sqliteRecoveryFingerprint(db), integrity: backupState.req.integrity, logicalStateFingerprint: backupState.logicalStateFingerprint, sourceAdvancedDuringBackup: copied.sourceAdvancedDuringBackup, createdAt: new Date().toISOString() };
  } finally { db.close(); }
}
function postValidate(databasePath, inputs) {
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const after = state(db, inputs, databasePath, true);
    if (after.policy.mutationPlan.phases.finalSourceMappings.length) throw new Error('DIBA production post-validation found further C2 relinks.');
    if (after.finalReview.unresolvedFinalHumanComponents || !after.finalReview.humanReviewActivationGateReady) throw new Error('DIBA production post-validation final gate failed.');
    return { integrity: after.req.integrity, sources: after.req.sources, c2FurtherRelinks: 0, finalFurtherEffects: 0, humanReviewActivationGateReady: true, unresolvedFinalHumanComponents: 0 };
  } finally { db.close(); }
}

export async function applyProductionReconciliation({ config, overridePath, decisionPath, authorization: supplied, backupPath, manifestPath } = {}) {
  const pre = await preflight({ config, overridePath, decisionPath, manifestPath }); const expected = authorization(pre); const preMainFileSha256 = sha256File(pre.databasePath);
  if (!supplied || supplied !== expected) throw new Error('DIBA production authorization does not match the current logical state.');
  if (!backupPath) throw new Error('DIBA production apply requires an explicit backup path.');
  stageObserver.notifyDibaPolicyStage('production-before-backup');
  const backupMetadata = await backup(pre.databasePath, backupPath, pre);
  stageObserver.notifyDibaPolicyStage('production-after-backup');
  const writable = primary(config, pre.databaseIdentity);
  stageObserver.notifyDibaPolicyStage('production-before-primary-open');
  // Avoid openDatabase's persistent journal_mode configuration here. The first
  // workflow-owned mutation is inside BEGIN IMMEDIATE after locked revalidation.
  const db = openDatabase(writable.path, { configureJournal: false, fileMustExist: true }); let locked; let afterC2;
  try {
    // Fail before BEGIN if the path was removed, redirected or replaced in the
    // narrow interval between canonical resolution and the writable open.
    assertOpenedPrimary(db, writable.path, pre.databaseIdentity);
    const applied = executeAuthorizedProductionTransaction({
      db,
      prepareFinalReview: () => { afterC2 = state(db, pre.inputs, writable.path, true); return afterC2.finalReview; },
      revalidateLockedState: () => {
        assertOpenedPrimary(db, writable.path, pre.databaseIdentity);
        if (sqliteRecoveryFingerprint(db) !== backupMetadata.recoveryFingerprint) throw new Error('DIBA production primary changed after its recovery backup snapshot.');
        if (currentDecisionFilesFingerprint(pre) !== pre.inputs.decisionFilesFingerprint) throw new Error('DIBA production locked-state authorization revalidation failed.');
        locked = state(db, pre.inputs, writable.path);
        if (locked.logicalStateFingerprint !== pre.state.logicalStateFingerprint || locked.mutationPlanFingerprint !== pre.state.mutationPlanFingerprint) throw new Error('DIBA production locked-state authorization revalidation failed.');
        return locked.policy;
      },
      validateFinalState: () => required(db),
    });
    const post = postValidate(writable.path, pre.inputs);
    return { generatedAt: new Date().toISOString(), authorizationConsumed: supplied, pre: { logicalStateFingerprint: pre.state.logicalStateFingerprint, mutationPlanFingerprint: pre.state.mutationPlanFingerprint, decisionFilesFingerprint: pre.inputs.decisionFilesFingerprint, mainFileSha256: preMainFileSha256 }, backup: backupMetadata, apply: applied, post, publicActivationReady: false };
  } finally { db.close(); }
}
