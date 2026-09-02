import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { FeverImporter } from '../backend/src/importers/fever.importer.js';
import { analyzeFeverNormalization } from '../backend/src/fever/normalizationAnalysis.js';
import { FeverImportLock } from '../backend/src/fever/importLock.js';
import {
  importFeverScheduled, parseScheduledArguments, preflightFeverScheduledImport,
} from '../backend/src/jobs/importFeverScheduled.js';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const resolver = {
  metadata: { provider: 'ICGC', dataset: 'Divisions administratives', datasetDate: '2026-01-20', layer: 'municipis_5000' },
  resolve: () => ({
    status: 'match',
    municipality: { code: '080193', name: 'Barcelona' },
    comarca: { code: '13', name: 'Barcelonès' },
    province: { code: '08', name: 'Barcelona' },
  }),
};

function scheduledItem(id = 'scheduled') {
  return {
    CatalogItemId: id, CatalogId: '15532', CampaignId: '16345', ParentName: 'Catalonia',
    Name: `Scheduled Fever ${id}`, Description: 'Scheduled fixture', Material: 'Venue',
    ShippingLabel: 'Address', Pattern: '(41.5; 1.5)', Text1: 'Spain', Text2: 'Barcelona',
    Url: `https://fever.pxf.io/${id}`, Manufacturer: '2026-08-25 10:00,2026-08-26 10:00',
    Category: 'Tier 4', CurrentPrice: 12, Currency: 'EUR', Labels: ['from €12'],
    Colors: ['https://feverup.com/m/scheduled'], ImageUrl: 'https://applications-media.feverup.com/scheduled.jpg',
    SubCategory: 'Sailing', LaunchDate: '2026-01-01', ExpirationDate: '2027-01-01',
  };
}

function fixtureImporter(db, { disableSourceDuringPrepare = false } = {}) {
  return new FeverImporter({
    db, resolver, snapshotChecksum: 'a'.repeat(64), lookaheadDays: 365, now: () => NOW,
    ...(disableSourceDuringPrepare ? {
      analyzeImpl: (...args) => {
        const result = analyzeFeverNormalization(...args);
        db.prepare("UPDATE sources SET enabled=0 WHERE key='fever'").run();
        return result;
      },
    } : {}),
  });
}

async function runFixtureImport(db, runnerOptions, {
  failBeforeTransaction = false, items = [scheduledItem()], postIntegrity = db.pragma('integrity_check', { simple: true }),
  disableSourceAfterCommit = false, disableSourceDuringPrepare = false,
} = {}) {
  const summary = await fixtureImporter(db, { disableSourceDuringPrepare }).run({ pages: 1, items }, {
    allowMassRemoval: runnerOptions.allowMassRemoval,
    beforeTransaction: (context) => {
      runnerOptions.beforeTransaction(context);
      if (failBeforeTransaction) throw new Error('Scheduled fixture transaction failure');
    },
    afterTransaction: ({ summary: result }) => {
      result.integrityCheck = postIntegrity;
      if (disableSourceAfterCommit) db.prepare("UPDATE sources SET enabled=0 WHERE key='fever'").run();
      runnerOptions.afterPersist(db, result);
    },
  });
  return summary;
}

async function withScheduledDatabase(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fever-scheduled-import-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const db = openDatabase(databasePath);
  migrate(db);
  db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
  const config = {
    databasePath,
    impactAccountSid: 'scheduled-account-secret',
    impactAuthToken: 'scheduled-token-secret',
    feverImagesEnabled: true,
    feverLookaheadDays: 365,
  };
  try {
    return await callback({ db, config });
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('scheduled Fever import supports enabled images, is idempotent and records completed runs', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    const logs = [];
    const runImport = async (_config, options) => runFixtureImport(db, options);
    const first = await importFeverScheduled(config, { runImport, logger: { log: (line) => logs.push(line) } });
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM plans) plans,
      (SELECT COUNT(*) FROM plan_sources) plan_sources,
      (SELECT COUNT(*) FROM plan_source_geography) geography,
      (SELECT COUNT(*) FROM plan_occurrences) occurrences,
      (SELECT COUNT(*) FROM plan_source_images) images`).get();
    const second = await importFeverScheduled(config, { runImport, logger: { log: (line) => logs.push(line) } });
    assert.equal(first.integrityCheck, 'ok');
    assert.equal(second.unchanged, 1);
    assert.deepEqual(db.prepare(`SELECT
      (SELECT COUNT(*) FROM plans) plans,
      (SELECT COUNT(*) FROM plan_sources) plan_sources,
      (SELECT COUNT(*) FROM plan_source_geography) geography,
      (SELECT COUNT(*) FROM plan_occurrences) occurrences,
      (SELECT COUNT(*) FROM plan_source_images) images`).get(), counts);
    assert.deepEqual(db.prepare(`SELECT status FROM import_runs
      WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id`).all(), [
      { status: 'completed' }, { status: 'completed' },
    ]);
    assert.ok(logs.every((line) => JSON.parse(line).status === 'completed'));
    assert.doesNotMatch(logs.join('\n'), /scheduled-account-secret|scheduled-token-secret/);
  });
});

test('scheduled Fever import fixes database, migration and removal controls and accepts enabled images', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    let runnerOptions;
    await importFeverScheduled(config, {
      runImport: async (_config, options) => {
        runnerOptions = options;
        options.beforeTransaction({ db });
        options.afterPersist(db, { integrityCheck: 'ok' });
        return { integrityCheck: 'ok', performance: {} };
      },
      logger: { log() {} },
    });
    assert.equal(runnerOptions.databasePath, config.databasePath);
    assert.equal(runnerOptions.migrateDatabase, false);
    assert.equal(runnerOptions.allowMassRemoval, false);
  });
});

test('scheduled Fever import rejects programmatic safety overrides and CLI flags', async () => {
  await withScheduledDatabase(async ({ config }) => {
    for (const options of [
      { databasePath: path.join(path.dirname(config.databasePath), 'other.sqlite') },
      { migrateDatabase: true }, { allowMassRemoval: true },
    ]) {
      await assert.rejects(importFeverScheduled(config, options), /Unsafe or unsupported/);
    }
  });
  assert.deepEqual(parseScheduledArguments([]), {});
  for (const args of [
    ['--db', 'other.sqlite'], ['--database', 'other.sqlite'], ['--database-path', 'other.sqlite'],
    ['--allow-mass-removal'], ['--unknown'], ['--confirm-production-import'],
  ]) assert.throws(() => parseScheduledArguments(args), /Usage/);
});

test('scheduled Fever preflight aborts missing migrations and source before runner writes', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    let runnerCalled = false;
    db.prepare("DELETE FROM schema_migrations WHERE filename='010_add_active_occurrence_lookup_index.sql'").run();
    await assert.rejects(importFeverScheduled(config, {
      runImport: async () => { runnerCalled = true; },
    }), /010_add_active_occurrence_lookup_index/);
    assert.equal(runnerCalled, false);
    db.prepare("INSERT INTO schema_migrations(filename,applied_at) VALUES ('010_add_active_occurrence_lookup_index.sql','2026-08-26T00:00:00Z')").run();
    db.prepare("UPDATE sources SET enabled=0 WHERE key='fever'").run();
    assert.throws(() => preflightFeverScheduledImport(config), /enabled=1/);
    db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
    db.prepare("DELETE FROM sources WHERE key='fever'").run();
    assert.throws(() => preflightFeverScheduledImport(config), /source is missing/);
  });
});

test('scheduled late source gate aborts after preparation with no catalog persistence', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    await assert.rejects(importFeverScheduled(config, {
      runImport: async (_config, options) => runFixtureImport(db, options, { disableSourceDuringPrepare: true }),
      logger: { log() {} },
    }), /enabled=1/);
    assert.deepEqual(db.prepare(`SELECT
      (SELECT COUNT(*) FROM plans) plans,
      (SELECT COUNT(*) FROM plan_sources) plan_sources,
      (SELECT COUNT(*) FROM plan_occurrences) occurrences`).get(), {
      plans: 0, plan_sources: 0, occurrences: 0,
    });
    const run = db.prepare(`SELECT status,summary_json FROM import_runs
      WHERE source_id=(SELECT id FROM sources WHERE key='fever')`).get();
    assert.equal(run.status, 'failed');
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, false);
  });
});

test('scheduled post-check failures mark committed catalog runs failed instead of completed', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    await assert.rejects(importFeverScheduled(config, {
      runImport: async (_config, options) => runFixtureImport(db, options, { postIntegrity: 'not ok' }),
      logger: { log() {} },
    }), /Post-persistence check failed after catalog commit/);
    let run = db.prepare(`SELECT status,error_message,summary_json FROM import_runs
      WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id DESC LIMIT 1`).get();
    assert.equal(run.status, 'failed');
    assert.match(run.error_message, /after scheduled import/);
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 1);

    db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
    await assert.rejects(importFeverScheduled(config, {
      runImport: async (_config, options) => runFixtureImport(db, options, { disableSourceAfterCommit: true }),
      logger: { log() {} },
    }), /Post-persistence check failed after catalog commit/);
    run = db.prepare(`SELECT status,error_message,summary_json FROM import_runs
      WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id DESC LIMIT 1`).get();
    assert.equal(run.status, 'failed');
    assert.match(run.error_message, /enabled=1/);
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, true);
  });
});

test('scheduled Fever import refuses concurrency and Fever locks recover stale, reused and malformed owners', async () => {
  await withScheduledDatabase(async ({ config }) => {
    const first = new FeverImportLock(config.databasePath);
    assert.equal(await first.acquire(), true);
    let runnerCalled = false;
    const skipped = await importFeverScheduled(config, {
      runImport: async () => { runnerCalled = true; },
      logger: { log() {} },
    });
    assert.deepEqual(skipped, {
      event: 'fever-import-scheduled', status: 'skipped', reason: 'concurrent-import',
    });
    assert.equal(runnerCalled, false);
    await first.release();

    const stale = new FeverImportLock(config.databasePath);
    assert.equal(await stale.acquire(), true);
    fs.writeFileSync(stale.ownerFile, JSON.stringify({ pid: 999999999, token: 'dead-owner' }));
    const recovered = new FeverImportLock(config.databasePath);
    assert.equal(await recovered.acquire(), true);
    await stale.release();
    assert.equal(fs.existsSync(recovered.directory), true);
    await recovered.release();

    const reused = new FeverImportLock(config.databasePath, {
      processExistsImpl: () => true, processIdentity: () => 'new-process-generation',
    });
    fs.mkdirSync(reused.directory);
    fs.writeFileSync(reused.ownerFile, JSON.stringify({
      pid: process.pid, processStart: 'old-process-generation', token: 'old-owner', startedAt: new Date().toISOString(),
    }));
    assert.equal(await reused.acquire(), true);
    await reused.release();

    const liveMatching = new FeverImportLock(config.databasePath, {
      processExistsImpl: () => true, processIdentity: () => 'same-process-generation',
    });
    fs.mkdirSync(liveMatching.directory);
    fs.writeFileSync(liveMatching.ownerFile, JSON.stringify({
      pid: process.pid, processStart: 'same-process-generation', token: 'live-owner', startedAt: new Date().toISOString(),
    }));
    assert.equal(await liveMatching.acquire(), false);
    fs.rmSync(liveMatching.directory, { recursive: true, force: true });

    const malformed = new FeverImportLock(config.databasePath, { malformedLockGraceMs: 0 });
    fs.mkdirSync(malformed.directory);
    fs.writeFileSync(malformed.ownerFile, '{partial-json');
    assert.equal(await malformed.acquire(), true);
    await malformed.release();
  });
});

test('Fever lock publishes owner metadata atomically and recovers abandoned publication safely', async () => {
  await withScheduledDatabase(async ({ config }) => {
    let reachedRename;
    const renameReached = new Promise((resolve) => { reachedRename = resolve; });
    let resumeRename;
    const publicationPaused = new Promise((resolve) => { resumeRename = resolve; });
    const acquiring = new FeverImportLock(config.databasePath, {
      beforeOwnerRename: async () => {
        reachedRename();
        await publicationPaused;
      },
    });
    const acquisition = acquiring.acquire();
    await renameReached;

    assert.equal(fs.existsSync(acquiring.ownerFile), false);
    const contender = new FeverImportLock(config.databasePath, { malformedLockGraceMs: 10_000 });
    assert.equal(await contender.acquire(), false);
    assert.equal(fs.existsSync(acquiring.directory), true);

    resumeRename();
    assert.equal(await acquisition, true);
    assert.equal(await contender.acquire(), false);
    await acquiring.release();

    const abandoned = new FeverImportLock(config.databasePath, { malformedLockGraceMs: 1 });
    fs.mkdirSync(abandoned.directory);
    fs.writeFileSync(path.join(abandoned.directory, 'owner.crashed.tmp'), '{"pid":');
    const staleNow = Date.now();
    const staleTime = new Date(staleNow - 100);
    fs.utimesSync(abandoned.directory, staleTime, staleTime);
    const recovered = new FeverImportLock(config.databasePath, {
      malformedLockGraceMs: 1,
      now: () => staleNow + 1000,
    });
    assert.equal(await recovered.acquire(), true);
    await recovered.release();

    const writeFailure = new FeverImportLock(config.databasePath, {
      fileSystem: {
        ...fs.promises,
        open: async () => {
          const error = new Error('owner write failed');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(await writeFailure.acquire(), false);
    assert.equal(fs.existsSync(writeFailure.directory), false);

    const renameFailure = new FeverImportLock(config.databasePath, {
      fileSystem: {
        ...fs.promises,
        rename: async () => {
          const error = new Error('owner rename failed');
          error.code = 'EIO';
          throw error;
        },
      },
    });
    assert.equal(await renameFailure.acquire(), false);
    assert.equal(fs.existsSync(renameFailure.directory), false);

    let transientRmdirAttempts = 0;
    const transientCleanup = new FeverImportLock(config.databasePath, {
      cleanupRetryDelayMs: 0,
      fileSystem: {
        ...fs.promises,
        rename: async () => {
          const error = new Error('owner rename failed');
          error.code = 'EIO';
          throw error;
        },
        rmdir: async (...args) => {
          transientRmdirAttempts += 1;
          if (transientRmdirAttempts === 1) {
            const error = new Error('temporary Windows directory state');
            error.code = 'ENOTEMPTY';
            throw error;
          }
          return fs.promises.rmdir(...args);
        },
      },
    });
    assert.equal(await transientCleanup.acquire(), false);
    assert.equal(transientRmdirAttempts, 2);
    assert.equal(fs.existsSync(transientCleanup.directory), false);
  });
});

test('scheduled Fever import retains removal guards and records a failed run after creation', async () => {
  await withScheduledDatabase(async ({ db, config }) => {
    const runImport = async (_config, options) => runFixtureImport(db, options);
    await importFeverScheduled(config, { runImport, logger: { log() {} } });
    await assert.rejects(importFeverScheduled(config, {
      runImport: async (_config, options) => runFixtureImport(db, options, { items: [] }),
      logger: { log() {} },
    }), /guard rejected/);

    await assert.rejects(importFeverScheduled(config, {
      runImport: async (_config, options) => runFixtureImport(db, options, { failBeforeTransaction: true }),
      logger: { log() {} },
    }), /Scheduled fixture transaction failure/);
    const runs = db.prepare(`SELECT status,error_message FROM import_runs
      WHERE source_id=(SELECT id FROM sources WHERE key='fever') ORDER BY id`).all();
    assert.deepEqual(runs.map(({ status }) => status), ['completed', 'failed', 'failed']);
    assert.match(runs.at(-1).error_message, /Scheduled fixture transaction failure/);
  });
});
