import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { FeverImportLock } from '../fever/importLock.js';
import { runFeverImport } from './feverImportRunner.js';

export const REQUIRED_FEVER_SCHEDULED_MIGRATIONS = [
  '009_add_fever_source_geography.sql',
  '010_add_active_occurrence_lookup_index.sql',
];

function assertIntegrity(db, phase) {
  const result = db.pragma('integrity_check', { simple: true });
  if (result !== 'ok') throw new Error(`SQLite integrity_check failed ${phase}; stop scheduled Fever imports and follow the runbook`);
}

function assertFeverEnabled(db) {
  const source = db.prepare("SELECT enabled FROM sources WHERE key='fever'").get();
  if (!source) throw new Error('Fever source is missing; scheduled imports require an existing enabled source');
  if (source.enabled !== 1) throw new Error('Fever source must remain enabled=1 for a scheduled production import');
}

function appliedMigrationNames(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!table) throw new Error('schema_migrations is missing; run the controlled migration procedure first.');
  try {
    return new Set(db.prepare('SELECT filename FROM schema_migrations').all().map(({ filename }) => filename));
  } catch (error) {
    throw new Error(`Unable to read schema_migrations; run the controlled migration procedure first. (${error.message})`);
  }
}

export function preflightFeverScheduledImport(config = loadConfig(), { openDatabaseImpl = openDatabase } = {}) {
  if (!config.impactAccountSid || !config.impactAuthToken) {
    throw new Error('Impact credentials are required for a scheduled production import');
  }
  const databasePath = path.resolve(config.databasePath);
  const db = openDatabaseImpl(databasePath, { readonly: true });
  try {
    const applied = appliedMigrationNames(db);
    const missing = REQUIRED_FEVER_SCHEDULED_MIGRATIONS.filter((filename) => !applied.has(filename));
    if (missing.length) {
      throw new Error(`Required Fever migrations are missing: ${missing.join(', ')}. Run the controlled migration procedure first.`);
    }
    assertFeverEnabled(db);
    assertIntegrity(db, 'before network work');
    return {
      databasePath,
      sourceEnabled: true,
      imagesEnabled: config.feverImagesEnabled,
      migrations: 'ok',
      integrity: 'ok',
    };
  } finally {
    db.close();
  }
}

export async function importFeverScheduled(config = loadConfig(), options = {}) {
  const allowedOptions = new Set(['runImport', 'logger', 'fetchImpl', 'now', 'manifestPath']);
  const unexpected = Object.keys(options).filter((key) => !allowedOptions.has(key));
  if (unexpected.length) throw new Error(`Unsafe or unsupported scheduled Fever import option: ${unexpected.join(', ')}`);
  const {
    runImport = runFeverImport, logger = console, fetchImpl, now, manifestPath,
  } = options;
  const lock = new FeverImportLock(config.databasePath);
  if (!await lock.acquire()) {
    const skipped = { event: 'fever-import-scheduled', status: 'skipped', reason: 'concurrent-import' };
    logger.log(JSON.stringify(skipped));
    return skipped;
  }

  let primaryError = null;
  try {
    const preflight = preflightFeverScheduledImport(config);
    const started = performance.now();
    const summary = await runImport(config, {
      databasePath: config.databasePath,
      migrateDatabase: false,
      allowMassRemoval: false,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      ...(now === undefined ? {} : { now }),
      ...(manifestPath === undefined ? {} : { manifestPath }),
      logger: { log() {} },
      beforeTransaction: ({ db }) => {
        assertFeverEnabled(db);
        assertIntegrity(db, 'immediately before persistence');
      },
      afterPersist: (db, result) => {
        assertFeverEnabled(db);
        if (result.integrityCheck !== 'ok') {
          throw new Error('SQLite integrity_check failed after scheduled import; stop scheduled Fever imports and follow the runbook');
        }
      },
    });
    summary.performance = {
      ...(summary.performance || {}),
      totalMs: Number((performance.now() - started).toFixed(1)),
    };
    logger.log(JSON.stringify({
      event: 'fever-import-scheduled',
      status: 'completed',
      database: preflight.databasePath,
      imagesEnabled: preflight.imagesEnabled,
      ...summary,
    }));
    return summary;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await lock.release();
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      Object.defineProperty(primaryError, 'lockCleanupError', { value: cleanupError, enumerable: false });
    }
  }
}

export function parseScheduledArguments(argv) {
  if (argv.length !== 0) throw new Error('Usage: npm run fever:import:scheduled');
  return {};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await importFeverScheduled(loadConfig(), parseScheduledArguments(process.argv.slice(2)));
    if (result.status === 'skipped') process.exitCode = 0;
  } catch (error) {
    console.error(`Scheduled Fever import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
