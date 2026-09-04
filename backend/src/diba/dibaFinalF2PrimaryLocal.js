import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { sha256File } from './dibaPolicyExecutor.js';

export const F2_BASELINE_SHA = 'F2B9A4AD4C70C57C6B269644CCDFBEDAEA02A339D9574F5CD6D7CFFE38FA78B8';
const samePath = (left, right) => (process.platform === 'win32' ? path.resolve(left).toLowerCase() : path.resolve(left)) === (process.platform === 'win32' ? path.resolve(right).toLowerCase() : path.resolve(right));
function state(databasePath) { const db = openDatabase(databasePath, { readonly: true }); try { const counts = Object.fromEntries(['plans', 'plan_sources', 'plan_categories', 'plan_occurrences', 'sources'].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count])); const sources = db.prepare("SELECT key,enabled,allows_images FROM sources WHERE key LIKE 'diba-%' ORDER BY key").all(); const integrity = db.pragma('integrity_check', { simple: true }); if (integrity !== 'ok' || sources.length !== 3 || sources.some(({ enabled, allows_images: images }) => Number(enabled) || Number(images))) throw new Error('F2 requires intact SQLite and all DIBA sources disabled with images disabled.'); return { counts, sources, integrity }; } finally { db.close(); } }
export function canonicalF2PrimaryLocalPath(config) { return path.resolve(config.projectRoot, 'data', 'quefem.sqlite'); }
export function preflightF2PrimaryLocal({ config }) { const primary = canonicalF2PrimaryLocalPath(config); if (!samePath(config.databasePath, primary)) throw new Error('F2 configuration cannot redirect the canonical primary database path.'); const sha = sha256File(primary); if (sha !== F2_BASELINE_SHA) throw new Error(`F2 literal baseline authorization rejects current SHA ${sha}.`); return { primary, sha, state: state(primary), token: Object.freeze({ primary, sha, nonce: `F2:${sha}:final-human-decisions` }) }; }
export function assertF2WritableBoundary({ config, primary, token, prepared }) { const expected = canonicalF2PrimaryLocalPath(config); if (!token || token.nonce !== `F2:${F2_BASELINE_SHA}:final-human-decisions` || !samePath(primary, expected) || !samePath(token.primary, expected)) throw new Error('F2 writable boundary authorization token/path is invalid.'); if (sha256File(expected) !== F2_BASELINE_SHA || token.sha !== F2_BASELINE_SHA) throw new Error('F2 writable boundary baseline has changed.'); if (!prepared || prepared.reviewed.length !== 5 || prepared.unresolvedFinalHumanComponents || !prepared.humanReviewActivationGateReady || prepared.geography.mutations || prepared.geography.noops !== 19) throw new Error('F2 writable boundary final-review scope changed.'); return { primary: expected, prepared };
}
export async function createVerifiedF2Backup({ primary, backupPath, config, token }) { const directory = path.resolve(config.projectRoot, 'data', 'backups'); const resolved = path.resolve(backupPath); if (!samePath(primary, canonicalF2PrimaryLocalPath(config)) || path.relative(directory, resolved).startsWith('..') || fs.existsSync(resolved)) throw new Error('F2 backup path must be a new database below data/backups.'); assertF2WritableBoundary({ config, primary, token, prepared: { reviewed: Array(5), unresolvedFinalHumanComponents: 0, humanReviewActivationGateReady: true, geography: { mutations: 0, noops: 19 } } }); const before = state(primary); fs.mkdirSync(path.dirname(resolved), { recursive: true }); const source = openDatabase(primary, { readonly: true }); try { await source.backup(resolved); } finally { source.close(); } const after = state(primary); const backup = state(resolved); if (JSON.stringify(before) !== JSON.stringify(backup) || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('F2 backup is not a verified logical equivalent of the primary baseline.'); return { path: resolved, sha256: sha256File(resolved), integrity: backup.integrity, logicalEquivalent: true, counts: backup.counts, sourceStates: backup.sources }; }

// Test-only harness for deterministic authorization-boundary regression tests.
// It is intentionally separate from the production writer: the production API
// derives its destination and baseline internally and never accepts these hooks.
export async function __testOnlyRunF2AuthorizationFlow({ databasePath, baselineSha, prepare, backup, afterPrepare, openWritable }) {
  if (!databasePath || !baselineSha || typeof prepare !== 'function' || typeof backup !== 'function' || typeof openWritable !== 'function') throw new Error('F2 test harness requires explicit isolated fixture controls.');
  if (sha256File(databasePath) !== baselineSha) throw new Error('F2 test harness initial baseline mismatch.');
  await backup();
  if (sha256File(databasePath) !== baselineSha) throw new Error('F2 test harness backup changed primary fixture.');
  const prepared = await prepare();
  afterPrepare?.();
  // Fresh SHA read is deliberately the final operation before the observed
  // writable-open callback; no await/callback occurs between these statements.
  if (sha256File(databasePath) !== baselineSha) throw new Error('F2 test harness final boundary detected post-prepare SHA drift.');
  return openWritable(prepared);
}
