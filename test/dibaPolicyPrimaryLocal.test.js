import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { C3_BASELINE_SHA, C3_CONFIRMATION, assertC3AuthorizationArguments, canonicalPrimaryLocalPath, preflightC3PrimaryLocal } from '../backend/src/diba/dibaPolicyPrimaryLocal.js';

const root = path.resolve('C:/tmp/quefem-c3-fixture'); const primary = path.join(root, 'data', 'quefem.sqlite');
const config = { projectRoot: root, databasePath: primary };
const valid = { databasePath: primary, allowPrimaryLocal: true, expectedSha: C3_BASELINE_SHA, confirmation: C3_CONFIRMATION };

function absoluteModuleUrl(relativePath) {
  return pathToFileURL(path.resolve(relativePath)).href;
}

async function withTestSideExecutor(services, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-c3-test-module-'));
  const serviceKey = `tenspla.dibaPolicy.testServices.${process.pid}.${Date.now()}.${Math.random()}`;
  const executorPath = path.join(directory, 'dibaPolicyExecutor.mjs');
  try {
    const source = fs.readFileSync('backend/src/diba/dibaPolicyExecutor.js', 'utf8')
      .replace("from '../db/database.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/db/database.js'))};`)
      .replace("from './dibaQualityAudit.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaQualityAudit.js'))};`)
      .replace("from './dibaPolicyPlanner.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaPolicyPlanner.js'))};`)
      .replace("from './dibaImporter.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaImporter.js'))};`)
      .replace("from './dibaPolicyPrimaryLocal.js';", "from './primary-local.mjs';")
      .replace("from './dibaPolicyD4PrimaryLocal.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaPolicyD4PrimaryLocal.js'))};`)
      .replace("from './dibaPolicyE4PrimaryLocal.js';", `from ${JSON.stringify(absoluteModuleUrl('backend/src/diba/dibaPolicyE4PrimaryLocal.js'))};`)
      .replace("from './dibaPolicyStageObserver.js';", "from './stage-observer.mjs';");
    fs.writeFileSync(executorPath, source);
    fs.writeFileSync(path.join(directory, 'primary-local.mjs'), `
      const services = globalThis[${JSON.stringify(serviceKey)}];
      export const canonicalPrimaryLocalPath = (...args) => services.canonicalPrimaryLocalPath(...args);
      export const preflightC3PrimaryLocal = (...args) => services.preflightC3PrimaryLocal(...args);
      export const createVerifiedC3Backup = (...args) => services.createVerifiedC3Backup(...args);
      export const readonlyC3State = (...args) => services.readonlyC3State(...args);
    `);
    fs.writeFileSync(path.join(directory, 'stage-observer.mjs'), `
      const services = globalThis[${JSON.stringify(serviceKey)}];
      export function notifyDibaPolicyStage(stage) { services.notifyDibaPolicyStage(stage); }
    `);
    globalThis[serviceKey] = services;
    const executor = await import(`${pathToFileURL(executorPath).href}?${Date.now()}-${Math.random()}`);
    return await run(executor);
  } finally {
    delete globalThis[serviceKey];
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('C3 primary-local authorization fails closed unless every narrow safeguard is present', () => {
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, allowPrimaryLocal: false }, config), /allow-primary-local/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, expectedSha: '' }, config), /expected-sha/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, expectedSha: 'A'.repeat(64) }, config), /one-time approved/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, confirmation: '' }, config), /token/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, confirmation: 'wrong' }, config), /token/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, databasePath: path.join(root, 'other.sqlite') }, config), /only this repository/);
  assert.throws(() => assertC3AuthorizationArguments({ ...valid, databasePath: 'C:/var/www/quefem.sqlite' }, config), /only this repository/);
  assert.equal(assertC3AuthorizationArguments(valid, config), canonicalPrimaryLocalPath(config));
});

test('C3 actual SHA mismatch stops before backup and the private transaction', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-c3-sha-'));
  const temporaryPrimary = path.join(directory, 'data', 'quefem.sqlite');
  fs.mkdirSync(path.dirname(temporaryPrimary), { recursive: true });
  fs.writeFileSync(temporaryPrimary, 'not the approved C3 primary');
  const stages = [];
  try {
    const temporaryConfig = { projectRoot: directory, databasePath: temporaryPrimary };
    const args = { ...valid, databasePath: temporaryPrimary };
    await withTestSideExecutor({
      canonicalPrimaryLocalPath: () => temporaryPrimary,
      preflightC3PrimaryLocal: ({ args: incomingArgs, config: incomingConfig, overrides }) => preflightC3PrimaryLocal({ args: incomingArgs, config: incomingConfig, overrides }),
      createVerifiedC3Backup: async () => { throw new Error('backup must not run'); },
      readonlyC3State: () => ({}),
      notifyDibaPolicyStage: (stage) => stages.push(stage),
    }, async ({ applyDibaPolicyPrimaryLocal: apply }) => {
      await assert.rejects(apply({ args, config: temporaryConfig, overrides: {}, backupPath: path.join(directory, 'backup.sqlite') }), /expected SHA does not match current primary database/);
    });
    assert.deepEqual(stages, ['preflight']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('C3 pre-write helper failures never reach the private transaction', async () => {
  const stages = []; const pre = { primary, sha256: C3_BASELINE_SHA, state: {}, prepared: {}, expected: {} };
  const runFailure = async ({ name, preflightC3PrimaryLocal = async () => pre, createVerifiedC3Backup = async () => ({}), expectedStages }) => {
    stages.length = 0;
    await withTestSideExecutor({
      canonicalPrimaryLocalPath: () => primary,
      preflightC3PrimaryLocal,
      createVerifiedC3Backup,
      readonlyC3State: () => ({}),
      notifyDibaPolicyStage: (stage) => stages.push(stage),
    }, async ({ applyDibaPolicyPrimaryLocal: apply }) => {
      await assert.rejects(apply({ args: valid, config, overrides: {}, backupPath: 'unused' }), new RegExp(name));
    });
    assert.deepEqual(stages, expectedStages);
  };
  await runFailure({ name: 'planner mismatch', preflightC3PrimaryLocal: async () => { throw new Error('planner mismatch'); }, expectedStages: ['preflight'] });
  await runFailure({ name: 'backup creation failure', createVerifiedC3Backup: async () => { throw new Error('backup creation failure'); }, expectedStages: ['preflight', 'backup'] });
  await runFailure({ name: 'backup integrity failure', createVerifiedC3Backup: async () => { throw new Error('backup integrity failure'); }, expectedStages: ['preflight', 'backup'] });
});

test('C3 reaches the pre-write boundary in deterministic order without a writable test seam', async () => {
  const stages = []; const sentinel = new Error('test observer stops before write');
  const pre = { primary, sha256: C3_BASELINE_SHA, state: {}, prepared: {}, expected: {} };
  await withTestSideExecutor({
    canonicalPrimaryLocalPath: () => primary,
    preflightC3PrimaryLocal: async () => pre,
    createVerifiedC3Backup: async () => ({ path: 'backup', integrity: 'ok' }),
    readonlyC3State: () => ({}),
    notifyDibaPolicyStage: (stage) => { stages.push(stage); if (stage === 'before-transaction') throw sentinel; },
  }, async ({ applyDibaPolicyPrimaryLocal: apply }) => {
    await assert.rejects(apply({ args: valid, config, overrides: {}, backupPath: 'unused' }), sentinel);
  });
  assert.deepEqual(stages, ['preflight', 'backup', 'before-transaction']);
});

test('C3 rejects a test-side mocked arbitrary primary and ignores obsolete testServices under NODE_ENV=test', async () => {
  const stages = []; const arbitraryPrimary = path.resolve('C:/tmp/not-the-canonical-primary.sqlite'); let obsoleteServiceCalled = false;
  const previousNodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try {
    await withTestSideExecutor({
      canonicalPrimaryLocalPath: () => primary,
      preflightC3PrimaryLocal: async () => ({ primary: arbitraryPrimary }),
      createVerifiedC3Backup: async () => { throw new Error('backup must not run'); },
      readonlyC3State: () => ({}),
      notifyDibaPolicyStage: (stage) => stages.push(stage),
    }, async ({ applyDibaPolicyPrimaryLocal: apply }) => {
      await assert.rejects(apply({
        args: valid,
        config,
        overrides: {},
        backupPath: 'unused',
        testServices: { preflight: async () => { obsoleteServiceCalled = true; throw new Error('obsolete injection used'); } },
        allowPrimaryLocal: false,
      }), /non-canonical primary database path/);
    });
    assert.deepEqual(stages, ['preflight']);
    assert.equal(obsoleteServiceCalled, false);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});
