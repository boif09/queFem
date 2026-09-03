import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  D4_BASELINE_SHA, D4_CONFIRMATION, assertD4AuthorizationArguments, assertD4BackupPath,
  canonicalD4PrimaryLocalPath, preflightD4PrimaryLocal,
} from '../backend/src/diba/dibaPolicyD4PrimaryLocal.js';
import { applyDibaPolicyD4PrimaryLocal } from '../backend/src/diba/dibaPolicyExecutor.js';

const root = path.resolve('C:/tmp/quefem-d4-fixture');
const primary = path.join(root, 'data', 'quefem.sqlite');
const config = { projectRoot: root, databasePath: primary };
const valid = { expectedSha: D4_BASELINE_SHA, confirmation: D4_CONFIRMATION };

function absoluteModuleUrl(relativePath) { return pathToFileURL(path.resolve(relativePath)).href; }
async function withD4ExecutorServices(services, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-d4-test-module-')); const serviceKey = `tenspla.dibaPolicy.d4Services.${process.pid}.${Date.now()}.${Math.random()}`;
  const executorPath = path.join(directory, 'dibaPolicyExecutor.mjs');
  try {
    const source = fs.readFileSync('backend/src/diba/dibaPolicyExecutor.js', 'utf8')
      .replace("from '../db/database.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/db/database.js'))};`)
      .replace("from './dibaQualityAudit.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaQualityAudit.js'))};`)
      .replace("from './dibaPolicyPlanner.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaPolicyPlanner.js'))};`)
      .replace("from './dibaImporter.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaImporter.js'))};`)
      .replace("from './dibaPolicyPrimaryLocal.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaPolicyPrimaryLocal.js'))};`)
      .replace("from './dibaPolicyD4PrimaryLocal.js';", "from './d4-primary.mjs';")
      .replace("from './dibaPolicyStageObserver.js';", "from './stage-observer.mjs';");
    fs.writeFileSync(executorPath, source);
    fs.writeFileSync(path.join(directory, 'd4-primary.mjs'), `
      const services = globalThis[${JSON.stringify(serviceKey)}];
      export const preflightD4PrimaryLocal = (...args) => services.preflightD4PrimaryLocal(...args);
      export const createVerifiedD4Backup = (...args) => services.createVerifiedD4Backup(...args);
      export const prepareD4ExecutionPlan = (...args) => services.prepareD4ExecutionPlan(...args);
      export const assertD4WritableBaseline = (...args) => services.assertD4WritableBaseline(...args);
      export const readonlyD4State = (...args) => services.readonlyD4State(...args);
    `);
    fs.writeFileSync(path.join(directory, 'stage-observer.mjs'), `
      const services = globalThis[${JSON.stringify(serviceKey)}];
      export function notifyDibaPolicyStage(stage) { services.notifyDibaPolicyStage?.(stage); }
    `);
    globalThis[serviceKey] = services;
    return await run(await import(`${pathToFileURL(executorPath).href}?${Date.now()}-${Math.random()}`));
  } finally { delete globalThis[serviceKey]; fs.rmSync(directory, { recursive: true, force: true }); }
}

test('D4 authorization accepts only the baseline-bound canonical primary path', () => {
  assert.equal(assertD4AuthorizationArguments(valid, config), canonicalD4PrimaryLocalPath(config));
  assert.throws(() => assertD4AuthorizationArguments({ ...valid, expectedSha: 'A'.repeat(64) }, config), /one-time approved/);
  assert.throws(() => assertD4AuthorizationArguments({ ...valid, confirmation: 'wrong' }, config), /token/);
  assert.throws(() => assertD4AuthorizationArguments({ ...valid, databasePath: path.join(root, 'other.sqlite') }, config), /only this repository/);
  assert.throws(() => assertD4AuthorizationArguments(valid, { ...config, databasePath: path.join(root, 'other.sqlite') }), /configuration/);
  assert.throws(() => assertD4BackupPath(path.join(root, 'outside.sqlite'), config), /data\/backups/);
  assert.equal(assertD4BackupPath(path.join(root, 'data', 'backups', 'before.sqlite'), config), path.join(root, 'data', 'backups', 'before.sqlite'));
});

test('D4 actual SHA mismatch stops before backup or a writable transaction, including under NODE_ENV=test', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-d4-sha-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite'); const backup = path.join(directory, 'data', 'backups', 'before.sqlite');
  fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'not the D4 baseline');
  const temporaryConfig = { projectRoot: directory, databasePath: temporaryPrimary }; const before = fs.readFileSync(temporaryPrimary, 'utf8'); const previousNodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try {
    await assert.rejects(preflightD4PrimaryLocal({ args: valid, config: temporaryConfig, overrides: {} }), /expected SHA does not match current primary database/);
    await assert.rejects(applyDibaPolicyD4PrimaryLocal({ args: valid, config: temporaryConfig, overrides: {}, backupPath: backup, testServices: { redirect: true } }), /expected SHA does not match current primary database/);
    assert.equal(fs.existsSync(backup), false);
    assert.equal(fs.readFileSync(temporaryPrimary, 'utf8'), before);
  } finally { process.env.NODE_ENV = previousNodeEnv; fs.rmSync(directory, { recursive: true, force: true }); }
});

test('D4 exposes no raw transaction or arbitrary-path primary writer', async () => {
  const executor = await import('../backend/src/diba/dibaPolicyExecutor.js');
  assert.equal('executeDibaPolicyTransaction' in executor, false);
  assert.equal('createPrimaryLocalTransactionRunner' in executor, false);
  assert.equal('applyDibaPolicyD4PrimaryLocal' in executor, true);
});

test('D4 reaches the private transaction boundary only after preflight, verified backup, plan and baseline revalidation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-d4-order-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite');
  fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'test-only sentinel'); const temporaryConfig = { projectRoot: directory, databasePath: temporaryPrimary };
  const events = []; const sentinel = new Error('stop before writable transaction');
  try {
    await withD4ExecutorServices({
      preflightD4PrimaryLocal: async () => { events.push('preflight'); return { primary: temporaryPrimary }; },
      createVerifiedD4Backup: async () => { events.push('backup'); return { integrity: 'ok' }; },
      prepareD4ExecutionPlan: async () => { events.push('prepare-transaction'); return { policy: { mutationPlan: { phases: { finalSourceMappings: [] } } } }; },
      assertD4WritableBaseline: () => { events.push('writable-baseline'); return { primary: temporaryPrimary, sha256: D4_BASELINE_SHA }; },
      notifyDibaPolicyStage: (stage) => { events.push(stage); if (stage === 'd4-before-transaction') throw sentinel; },
      readonlyD4State: () => { throw new Error('must not reach post state'); },
    }, async ({ applyDibaPolicyD4PrimaryLocal: apply }) => {
      await assert.rejects(apply({ args: valid, config: temporaryConfig, overrides: {}, backupPath: path.join(directory, 'data', 'backups', 'before.sqlite') }), sentinel);
    });
    assert.deepEqual(events, ['preflight', 'backup', 'prepare-transaction', 'writable-baseline', 'd4-before-transaction']);
    assert.equal(fs.readFileSync(temporaryPrimary, 'utf8'), 'test-only sentinel');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('D4 drift after read-only planning is rejected at the writable boundary before the transaction', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-d4-drift-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite');
  fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'authorized test baseline'); const temporaryConfig = { projectRoot: directory, databasePath: temporaryPrimary };
  const events = [];
  try {
    await withD4ExecutorServices({
      preflightD4PrimaryLocal: async () => { events.push('preflight'); return { primary: temporaryPrimary, sha256: D4_BASELINE_SHA }; },
      createVerifiedD4Backup: async () => { events.push('backup'); return { integrity: 'ok' }; },
      prepareD4ExecutionPlan: async () => { events.push('prepare-transaction'); fs.writeFileSync(temporaryPrimary, 'drifted after planning'); return { policy: { mutationPlan: { phases: { finalSourceMappings: [] } } } }; },
      assertD4WritableBaseline: () => { events.push('writable-baseline'); assert.equal(fs.readFileSync(temporaryPrimary, 'utf8'), 'drifted after planning'); throw new Error('D4 expected SHA does not match current primary database at writable boundary'); },
      notifyDibaPolicyStage: (stage) => events.push(stage),
      readonlyD4State: () => { throw new Error('must not reach post state'); },
    }, async ({ applyDibaPolicyD4PrimaryLocal: apply }) => {
      await assert.rejects(apply({ args: valid, config: temporaryConfig, overrides: {}, backupPath: path.join(directory, 'data', 'backups', 'before.sqlite') }), /at writable boundary/);
    });
    assert.deepEqual(events, ['preflight', 'backup', 'prepare-transaction', 'writable-baseline']);
    assert.equal(fs.readFileSync(temporaryPrimary, 'utf8'), 'drifted after planning');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('D4 preflight or backup failures cannot reach the private transaction boundary', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-d4-boundary-')); const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite');
  fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true }); fs.writeFileSync(temporaryPrimary, 'test-only sentinel'); const temporaryConfig = { projectRoot: directory, databasePath: temporaryPrimary };
  try {
    for (const [failure, expected] of [[
      { preflightD4PrimaryLocal: async () => { throw new Error('preflight rejected'); }, createVerifiedD4Backup: async () => { throw new Error('backup must not run'); } },
      ['preflight rejected'],
    ], [
      { preflightD4PrimaryLocal: async () => ({ primary: temporaryPrimary }), createVerifiedD4Backup: async () => { throw new Error('backup rejected'); } },
      ['backup rejected'],
    ]]) {
      let prepared = false;
      await withD4ExecutorServices({ ...failure, prepareD4ExecutionPlan: async () => { prepared = true; throw new Error('must not prepare'); }, assertD4WritableBaseline: () => { throw new Error('must not validate writable baseline'); }, readonlyD4State: () => ({}) }, async ({ applyDibaPolicyD4PrimaryLocal: apply }) => {
        await assert.rejects(apply({ args: valid, config: temporaryConfig, overrides: {}, backupPath: path.join(directory, 'data', 'backups', `${Math.random()}.sqlite`) }), new RegExp(expected[0]));
      });
      assert.equal(prepared, false);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
