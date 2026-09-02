import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { loadPolicyIdentityIndex, planDibaPolicy } from './dibaPolicyPlanner.js';
import { runDibaQualityAudit } from './dibaQualityAudit.js';
import { createHash } from 'node:crypto';

export const C3_CONFIRMATION = 'M1.4C3_REAL_LOCAL_APPLY';
export const C3_BASELINE_SHA = '48FB37D31EA437B34FAF1D97483BA1A37B71055ECE217688CC9C733B0AFF786E';
function comparable(value) { return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value); }
export function canonicalPrimaryLocalPath(config) { return path.resolve(config.projectRoot, 'data', 'quefem.sqlite'); }
export function assertC3AuthorizationArguments({ databasePath, allowPrimaryLocal, expectedSha, confirmation }, config) {
  const primary = canonicalPrimaryLocalPath(config);
  if (!allowPrimaryLocal) throw new Error('C3 requires --allow-primary-local.');
  if (comparable(databasePath) !== comparable(primary) || comparable(config.databasePath) !== comparable(primary)) throw new Error('C3 authorizes only this repository canonical data/quefem.sqlite path.');
  if (confirmation !== C3_CONFIRMATION) throw new Error('C3 confirmation token is missing or invalid.');
  if (!/^[A-Fa-f0-9]{64}$/.test(expectedSha || '')) throw new Error('C3 requires an exact --expected-sha SHA-256 value.');
  if (expectedSha.toUpperCase() !== C3_BASELINE_SHA) throw new Error('C3 expected SHA must equal the one-time approved C3 baseline.');
  return primary;
}
export function readonlyC3State(databasePath) {
  const db = openDatabase(databasePath, { readonly: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    const sources = db.prepare("SELECT key, enabled, allows_images FROM sources WHERE key IN ('diba-tourisme','diba-escenari','diba-museus') ORDER BY key").all();
    if (integrity !== 'ok') throw new Error(`C3 preflight integrity_check failed: ${integrity}`);
    if (sources.length !== 3 || sources.some(({ enabled, allows_images: images }) => Number(enabled) !== 0 || Number(images) !== 0)) throw new Error('C3 requires DIBA sources disabled and images disabled.');
    return { integrity, sources };
  } finally { db.close(); }
}
async function policyAt(databasePath, overrides) {
  const auditReport = await runDibaQualityAudit({ databasePath }); const db = openDatabase(databasePath, { readonly: true });
  try { return { auditReport, policy: planDibaPolicy({ auditReport, overrides, identityIndex: loadPolicyIdentityIndex(db) }) }; } finally { db.close(); }
}
export async function preflightC3PrimaryLocal({ args, config, overrides, requireAuditedBaseline = true }) {
  const primary = assertC3AuthorizationArguments(args, config); const sha256 = createHash('sha256').update(fs.readFileSync(primary)).digest('hex').toUpperCase();
  if (sha256.toUpperCase() !== args.expectedSha.toUpperCase()) throw new Error(`C3 expected SHA does not match current primary database: ${sha256}`);
  const state = readonlyC3State(primary); const prepared = await policyAt(primary, overrides);
  const expected = { relinks: prepared.policy.mutationPlan.phases.finalSourceMappings.length, geography: prepared.policy.mutationPlan.phases.explicitGeography.length, orphans: prepared.policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.length, safe: prepared.policy.summary.sameFeed.SAFE_CONSOLIDATE || 0 };
  if (requireAuditedBaseline && (expected.relinks !== 39 || expected.geography !== 19 || expected.orphans !== 39 || expected.safe !== 22 || prepared.policy.activation.publicActivationReady)) throw new Error(`C3 planner differs from audited structural baseline: ${JSON.stringify(expected)}`);
  return { primary, sha256, state, prepared, expected };
}
export async function previewC3PostApplyNoop({ args, config, overrides }) {
  const pre = await preflightC3PrimaryLocal({ args, config, overrides, requireAuditedBaseline: false });
  if (pre.expected.relinks !== 0 || pre.expected.orphans !== 0 || pre.prepared.policy.activation.publicActivationReady) throw new Error(`C3 post-apply preview is not a structural no-op: ${JSON.stringify(pre.expected)}`);
  return { ...pre, geometryOperations: pre.prepared.policy.mutationPlan.phases.explicitGeography.length };
}
export async function createVerifiedC3Backup(primary, backupPath) {
  const resolved = path.resolve(backupPath); if (fs.existsSync(resolved)) throw new Error(`C3 backup already exists: ${resolved}`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true }); const source = openDatabase(primary, { readonly: true });
  try { await source.backup(resolved); } finally { source.close(); }
  const state = readonlyC3State(resolved); return { path: resolved, sha256: createHash('sha256').update(fs.readFileSync(resolved)).digest('hex').toUpperCase(), integrity: state.integrity, sourceStates: state.sources };
}
