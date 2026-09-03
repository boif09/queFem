import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { E4_BASELINE_SHA, E4_CONFIRMATION, assertE4AuthorizationArguments, assertE4BackupPath, canonicalE4PrimaryLocalPath, preflightE4PrimaryLocal } from '../backend/src/diba/dibaPolicyE4PrimaryLocal.js';
import { applyDibaPolicyE4PrimaryLocal } from '../backend/src/diba/dibaPolicyExecutor.js';

const root = path.resolve('C:/tmp/quefem-e4-fixture'); const primary = path.join(root, 'data', 'quefem.sqlite'); const config = { projectRoot: root, databasePath: primary }; const valid = { expectedSha: E4_BASELINE_SHA, confirmation: E4_CONFIRMATION };
function moduleUrl(relative) { return pathToFileURL(path.resolve(relative)).href; }
async function withE4Services(services, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-e4-test-module-')); const key = `tenspla.e4.${process.pid}.${Date.now()}.${Math.random()}`;
  try {
    const source = fs.readFileSync('backend/src/diba/dibaPolicyExecutor.js', 'utf8').replace("from '../db/database.js';", `from ${JSON.stringify(moduleUrl('backend/src/db/database.js'))};`).replace("from './dibaQualityAudit.js';", `from ${JSON.stringify(moduleUrl('backend/src/diba/dibaQualityAudit.js'))};`).replace("from './dibaPolicyPlanner.js';", `from ${JSON.stringify(moduleUrl('backend/src/diba/dibaPolicyPlanner.js'))};`).replace("from './dibaImporter.js';", `from ${JSON.stringify(moduleUrl('backend/src/diba/dibaImporter.js'))};`).replace("from './dibaPolicyPrimaryLocal.js';", `from ${JSON.stringify(moduleUrl('backend/src/diba/dibaPolicyPrimaryLocal.js'))};`).replace("from './dibaPolicyD4PrimaryLocal.js';", `from ${JSON.stringify(moduleUrl('backend/src/diba/dibaPolicyD4PrimaryLocal.js'))};`).replace("from './dibaPolicyE4PrimaryLocal.js';", "from './e4-primary.mjs';").replace("from './dibaPolicyStageObserver.js';", "from './stage.mjs';");
    fs.writeFileSync(path.join(directory, 'dibaPolicyExecutor.mjs'), source);
    fs.writeFileSync(path.join(directory, 'e4-primary.mjs'), `const s=globalThis[${JSON.stringify(key)}]; export const preflightE4PrimaryLocal=(...a)=>s.preflight(...a); export const createVerifiedE4Backup=(...a)=>s.backup(...a); export const prepareE4ExecutionPlan=(...a)=>s.prepare(...a); export const assertE4WritableBaseline=(...a)=>s.baseline(...a); export const readonlyE4State=(...a)=>s.post(...a);`);
    fs.writeFileSync(path.join(directory, 'stage.mjs'), `const s=globalThis[${JSON.stringify(key)}]; export function notifyDibaPolicyStage(stage){s.stage?.(stage);}`);
    globalThis[key] = services; return await run(await import(`${pathToFileURL(path.join(directory, 'dibaPolicyExecutor.mjs')).href}?${Math.random()}`));
  } finally { delete globalThis[key]; fs.rmSync(directory, { recursive: true, force: true }); }
}

test('E4 authorizes only the literal baseline and canonical primary path', () => {
  assert.equal(assertE4AuthorizationArguments(valid, config), canonicalE4PrimaryLocalPath(config));
  assert.throws(() => assertE4AuthorizationArguments({ ...valid, expectedSha: 'A'.repeat(64) }, config), /one-time approved/);
  assert.throws(() => assertE4AuthorizationArguments({ ...valid, databasePath: path.join(root, 'other.sqlite') }, config), /only this repository/);
  assert.throws(() => assertE4AuthorizationArguments(valid, { ...config, databasePath: path.join(root, 'other.sqlite') }), /configuration/);
  assert.throws(() => assertE4BackupPath(path.join(root, 'other.sqlite'), config), /data\/backups/);
});

test('E4 SHA mismatch fails before backup or a writable transaction, including NODE_ENV=test', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-e4-sha-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite'); const backup = path.join(directory, 'data', 'backups', 'before.sqlite'); fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'wrong baseline'); const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try { await assert.rejects(preflightE4PrimaryLocal({ args: valid, config: { projectRoot: directory, databasePath: temporaryPrimary }, overrides: {} }), /expected SHA does not match/); await assert.rejects(applyDibaPolicyE4PrimaryLocal({ args: valid, config: { projectRoot: directory, databasePath: temporaryPrimary }, overrides: {}, backupPath: backup, testServices: { redirect: true } }), /expected SHA does not match/); assert.equal(fs.existsSync(backup), false); } finally { process.env.NODE_ENV = previous; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('E4 keeps the transaction engine private and exposes no arbitrary primary writer', async () => {
  const executor = await import('../backend/src/diba/dibaPolicyExecutor.js'); assert.equal('executeDibaPolicyTransaction' in executor, false); assert.equal('createPrimaryLocalTransactionRunner' in executor, false); assert.equal('applyDibaPolicyE4PrimaryLocal' in executor, true);
});

test('E4 requires preflight, verified backup, final revalidation and then the private transaction boundary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-e4-order-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite'); fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'sentinel'); const events = []; const stop = new Error('stop before writable');
  try { await withE4Services({ preflight: async () => { events.push('preflight'); return { primary: temporaryPrimary }; }, backup: async () => { events.push('backup'); return { integrity: 'ok', logicalEquivalent: true }; }, prepare: async () => { events.push('prepare'); return { policy: { mutationPlan: { phases: { finalSourceMappings: [] } } } }; }, baseline: () => { events.push('baseline'); return { primary: temporaryPrimary, sha256: E4_BASELINE_SHA }; }, stage: (value) => { events.push(value); if (value === 'e4-before-transaction') throw stop; }, post: () => { throw new Error('must not reach post'); } }, async ({ applyDibaPolicyE4PrimaryLocal: apply }) => assert.rejects(apply({ args: valid, config: { projectRoot: directory, databasePath: temporaryPrimary }, overrides: {}, backupPath: path.join(directory, 'data', 'backups', 'before.sqlite') }), stop)); assert.deepEqual(events, ['preflight', 'backup', 'prepare', 'baseline', 'e4-before-transaction']); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('E4 backup, scope/preflight, or final baseline failures cannot reach the writable boundary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-e4-fail-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite'); fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'sentinel');
  try { for (const [preflightError, backupError, baselineError] of [['scope mismatch', null, null], [null, 'backup integrity/equivalence failed', null], [null, null, 'baseline changed']]) { const events = []; await withE4Services({ preflight: async () => { if (preflightError) throw new Error(preflightError); return { primary: temporaryPrimary }; }, backup: async () => { if (backupError) throw new Error(backupError); return {}; }, prepare: async () => { events.push('prepare'); return { policy: { mutationPlan: { phases: { finalSourceMappings: [] } } } }; }, baseline: () => { if (baselineError) throw new Error(baselineError); return {}; }, stage: () => events.push('write'), post: () => ({}) }, async ({ applyDibaPolicyE4PrimaryLocal: apply }) => assert.rejects(apply({ args: valid, config: { projectRoot: directory, databasePath: temporaryPrimary }, overrides: {}, backupPath: path.join(directory, 'data', 'backups', `${Math.random()}.sqlite`) }), new RegExp(preflightError || backupError || baselineError))); assert.equal(events.includes('write'), false); } } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
