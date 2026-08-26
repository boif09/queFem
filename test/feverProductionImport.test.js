import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { FeverImportLock } from '../backend/src/fever/importLock.js';
import {
  importFeverProduction, parseArguments, preflightFeverProductionImport,
} from '../backend/src/jobs/importFever.js';
import { assertTemporaryDatabasePath } from '../backend/src/jobs/importFeverTemp.js';

async function withDatabase(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fever-production-import-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const db = openDatabase(databasePath);
  migrate(db);
  const config = {
    databasePath, impactAccountSid: 'test-account-secret', impactAuthToken: 'test-token-secret',
    feverImagesEnabled: false, feverLookaheadDays: 365,
  };
  try { return await callback({ db, config }); }
  finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('production Fever import requires explicit confirmation before any import', async () => {
  await withDatabase(async ({ db, config }) => {
    const before = db.prepare('SELECT COUNT(*) count FROM plans').get().count;
    await assert.rejects(importFeverProduction(config), /confirm-production-import/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, before);
  });
});

test('production preflight requires the exact migration history and a disabled Fever source', async () => {
  await withDatabase(({ db, config }) => {
    db.prepare("DELETE FROM schema_migrations WHERE filename='009_add_fever_source_geography.sql'").run();
    assert.throws(() => preflightFeverProductionImport(config), /009_add_fever_source_geography/);
    db.prepare("INSERT INTO schema_migrations(filename,applied_at) VALUES ('009_add_fever_source_geography.sql','2026-08-26T00:00:00Z')").run();
    db.prepare("DELETE FROM schema_migrations WHERE filename='010_add_active_occurrence_lookup_index.sql'").run();
    assert.throws(() => preflightFeverProductionImport(config), /010_add_active_occurrence_lookup_index/);
    db.prepare("INSERT INTO schema_migrations(filename,applied_at) VALUES ('010_add_active_occurrence_lookup_index.sql.partial','2026-08-26T00:00:00Z')").run();
    assert.throws(() => preflightFeverProductionImport(config), /010_add_active_occurrence_lookup_index/);
    db.prepare("DELETE FROM schema_migrations WHERE filename='010_add_active_occurrence_lookup_index.sql.partial'").run();
    db.prepare("INSERT INTO schema_migrations(filename,applied_at) VALUES ('010_add_active_occurrence_lookup_index.sql','2026-08-26T00:00:00Z')").run();
    db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
    assert.throws(() => preflightFeverProductionImport(config), /enabled=0/);
    db.prepare("UPDATE sources SET enabled=0 WHERE key='fever'").run();
    assert.throws(() => preflightFeverProductionImport({ ...config, feverImagesEnabled: true }), /FEVER_IMAGES_ENABLED/);
    db.prepare("DELETE FROM sources WHERE key='fever'").run();
    assert.throws(() => preflightFeverProductionImport(config), /source is missing/);
  });
});

test('production preflight reports a missing migration table cleanly', () => {
  const config = { databasePath: '/safe/test.sqlite', impactAccountSid: 'account', impactAuthToken: 'token', feverImagesEnabled: false };
  const fakeDb = { prepare: () => ({ get: () => undefined }), close() {} };
  assert.throws(() => preflightFeverProductionImport(config, { openDatabaseImpl: () => fakeDb }), /schema_migrations is missing/);
});

test('production preflight rejects synthetic integrity failure without exposing credentials', () => {
  const config = { databasePath: '/safe/test.sqlite', impactAccountSid: 'account-secret', impactAuthToken: 'token-secret', feverImagesEnabled: false };
  const fakeDb = {
    prepare: (sql) => ({ all: () => [
      { filename: '009_add_fever_source_geography.sql' }, { filename: '010_add_active_occurrence_lookup_index.sql' },
    ], get: () => (sql.includes('sqlite_master') ? { 1: 1 } : { enabled: 0 }) }),
    pragma: () => 'not ok', close() {},
  };
  assert.throws(() => preflightFeverProductionImport(config, { openDatabaseImpl: () => fakeDb }), /integrity_check/);
});

test('confirmed production CLI flow runs its real preflight and reaches the runner without forwarding a preflight option', async () => {
  await withDatabase(async ({ db, config }) => {
    const logs = [];
    let options;
    const args = parseArguments(['--confirm-production-import']);
    const summary = await importFeverProduction(config, {
      ...args, logger: { log: (message) => logs.push(message) },
      runImport: async (_config, value) => {
        options = value;
        value.beforeTransaction({ db });
        value.afterPersist(db, { integrityCheck: 'ok' });
        return { integrityCheck: 'ok', inserted: 0, updated: 0, unchanged: 0 };
      },
    });
    assert.equal(options.databasePath, config.databasePath);
    assert.equal(options.migrateDatabase, false);
    assert.equal(options.allowMassRemoval, false);
    assert.equal(db.prepare("SELECT enabled FROM sources WHERE key='fever'").get().enabled, 0);
    assert.equal(summary.integrityCheck, 'ok');
    assert.doesNotMatch(logs.join('\n'), /test-account-secret|test-token-secret/);
  });
});

test('production command rejects programmatic database, migration and mass-removal overrides', async () => {
  await withDatabase(async ({ config }) => {
    for (const options of [
      { databasePath: path.join(path.dirname(config.databasePath), 'other.sqlite') },
      { migrateDatabase: true }, { allowMassRemoval: true },
    ]) {
      await assert.rejects(importFeverProduction(config, { confirmProductionImport: true, ...options }), /Unsafe or unsupported/);
    }
  });
});

test('manual Fever import shares the lock with scheduled executions', async () => {
  await withDatabase(async ({ config }) => {
    const lock = new FeverImportLock(config.databasePath);
    assert.equal(await lock.acquire(), true);
    let runnerCalled = false;
    await assert.rejects(importFeverProduction(config, {
      confirmProductionImport: true,
      runImport: async () => { runnerCalled = true; },
    }), /already active/);
    assert.equal(runnerCalled, false);
    await lock.release();
  });
});

test('production CLI parser permits one explicit operation and rejects duplicates and unsafe flags', () => {
  assert.deepEqual(parseArguments(['--confirm-production-import']), { confirmProductionImport: true });
  for (const args of [
    [],
    ['--preflight', '--preflight'], ['--confirm-production-import', '--confirm-production-import'],
    ['--preflight', '--confirm-production-import'], ['--preflight'], ['--database', 'other.sqlite'], ['--allow-mass-removal'],
  ]) assert.throws(() => parseArguments(args), /Usage/);
});

test('pre-write production gate aborts before persistence when integrity is bad', async () => {
  await withDatabase(async ({ config }) => {
    let persistenceStarted = false;
    const guardedDb = {
      prepare: () => ({ get: () => ({ enabled: 0 }) }), pragma: () => 'not ok',
    };
    await assert.rejects(importFeverProduction(config, {
      confirmProductionImport: true,
      runImport: async (_config, options) => {
        options.beforeTransaction({ db: guardedDb });
        persistenceStarted = true;
      },
    }), /immediately before persistence/);
    assert.equal(persistenceStarted, false);
  });
});

test('post-import integrity failure is critical and temporary importer remains protected', async () => {
  await withDatabase(async ({ db, config }) => {
    await assert.rejects(importFeverProduction(config, {
      confirmProductionImport: true,
      runImport: async (_config, options) => {
        options.beforeTransaction({ db });
        options.afterPersist(db, { integrityCheck: 'not ok' });
      },
    }), /after import/);
    assert.throws(() => assertTemporaryDatabasePath(config.databasePath, config.databasePath), /refuses/);
  });
});

test('post-import source enablement is critical and is never silently corrected', async () => {
  await withDatabase(async ({ db, config }) => {
    await assert.rejects(importFeverProduction(config, {
      confirmProductionImport: true,
      runImport: async (_config, options) => {
        options.beforeTransaction({ db });
        db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
        options.afterPersist(db, { integrityCheck: 'ok' });
      },
    }), /enabled=0/);
    assert.equal(db.prepare("SELECT enabled FROM sources WHERE key='fever'").get().enabled, 1);
  });
});
