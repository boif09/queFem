import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { FeverImportLock } from '../fever/importLock.js';
import { runFeverImport } from './feverImportRunner.js';

export const REQUIRED_FEVER_MIGRATIONS = [
  '009_add_fever_source_geography.sql',
  '010_add_active_occurrence_lookup_index.sql',
];

function assertFeverDisabled(db) {
  const source = db.prepare("SELECT enabled FROM sources WHERE key='fever'").get();
  if (!source) throw new Error('Fever source is missing; apply migration 009 before importing');
  if (source.enabled !== 0) throw new Error('Fever source must remain enabled=0 for a production import');
}

function assertIntegrity(db, phase) {
  const result = db.pragma('integrity_check', { simple: true });
  if (result !== 'ok') throw new Error(`SQLite integrity_check failed ${phase}; stop and follow the rollback runbook`);
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

export function preflightFeverProductionImport(config = loadConfig(), { openDatabaseImpl = openDatabase } = {}) {
  if (config.feverImagesEnabled) throw new Error('FEVER_IMAGES_ENABLED must be false for a production import');
  if (!config.impactAccountSid || !config.impactAuthToken) throw new Error('Impact credentials are required for a production import');
  const databasePath = path.resolve(config.databasePath);
  const db = openDatabaseImpl(databasePath, { readonly: true });
  try {
    const applied = appliedMigrationNames(db);
    const missing = REQUIRED_FEVER_MIGRATIONS.filter((filename) => !applied.has(filename));
    if (missing.length) throw new Error(`Required Fever migrations are missing: ${missing.join(', ')}. Run the controlled migration procedure first.`);
    assertFeverDisabled(db);
    assertIntegrity(db, 'before import');
    return { databasePath, sourceEnabled: false, imagesEnabled: false, migrations: 'ok', integrity: 'ok' };
  } finally { db.close(); }
}

export async function importFeverProduction(config = loadConfig(), options = {}) {
  const allowedOptions = new Set(['confirmProductionImport', 'runImport', 'logger', 'fetchImpl', 'now', 'manifestPath']);
  const unexpected = Object.keys(options).filter((key) => !allowedOptions.has(key));
  if (unexpected.length) throw new Error(`Unsafe or unsupported production import option: ${unexpected.join(', ')}`);
  const {
    confirmProductionImport = false, runImport = runFeverImport, logger = console,
    fetchImpl, now, manifestPath,
  } = options;
  if (!confirmProductionImport) throw new Error('Refusing production Fever import without --confirm-production-import');
  const lock = new FeverImportLock(config.databasePath);
  if (!await lock.acquire()) throw new Error('Another Fever import is already active; manual import refused');
  try {
    const preflight = preflightFeverProductionImport(config);
    logger.log(`PRODUCTION FEVER IMPORT\ndatabase: ${preflight.databasePath}\nsource enabled: false\nimages enabled: false\nmigrations: ok\nintegrity: ok\nProduction import requires a verified pre-import backup.`);
    const summary = await runImport(config, {
      databasePath: config.databasePath,
      migrateDatabase: false,
      allowMassRemoval: false,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      ...(now === undefined ? {} : { now }),
      ...(manifestPath === undefined ? {} : { manifestPath }),
      beforeTransaction: ({ db }) => {
        assertFeverDisabled(db);
        assertIntegrity(db, 'immediately before persistence');
      },
      afterPersist: (db, result) => {
        assertFeverDisabled(db);
        if (result.integrityCheck !== 'ok') throw new Error('SQLite integrity_check failed after import; stop and follow the rollback runbook');
      },
    });
    logger.log(`PRODUCTION FEVER IMPORT COMPLETE: ${JSON.stringify(summary)}`);
    return summary;
  } finally {
    await lock.release();
  }
}

export function parseArguments(argv) {
  if (argv.length !== 1 || argv[0] !== '--confirm-production-import') {
    throw new Error('Usage: npm run fever:import -- --confirm-production-import');
  }
  return { confirmProductionImport: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await importFeverProduction(loadConfig(), args);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(`Fever production import failed: ${error.message}`); process.exitCode = 1; }
}
