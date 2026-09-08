import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { DibaApiClient } from '../diba/m0Discovery.js';
import { DibaImporter, municipalityIndex } from '../diba/dibaImporter.js';
import { DibaImportLock } from '../diba/importLock.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from './updateIcgcGeography.js';

// Dry runs intentionally open SQLite read-only: live acquisition, normalization
// and matching are exercised while even import_runs remain untouched.
export async function runDibaImport(config, {
  dryRun = false, databasePath = config.databasePath, fetchImpl, now,
  manifestPath = DEFAULT_ICGC_MANIFEST_PATH, logger = console, allowMassRemoval = false,
  lockFactory = (pathValue) => new DibaImportLock(pathValue),
} = {}) {
  const resolvedPath = path.resolve(databasePath);
  const lock = dryRun ? null : lockFactory(resolvedPath);
  if (lock && !await lock.acquire()) {
    const error = new Error('Another DIBA import is already active; import refused.');
    error.code = 'DIBA_IMPORT_LOCKED';
    throw error;
  }
  let db = null;
  let primaryError = null;
  try {
    const loaded = await readAndVerifyIcgcSnapshot(manifestPath);
    db = openDatabase(resolvedPath, { readonly: dryRun });
    const importer = new DibaImporter({
      db, client: new DibaApiClient({ fetchImpl }), municipalities: municipalityIndex(loaded.snapshot),
      ...(now ? { now } : {}),
    });
    const summary = await importer.run({ dryRun, allowMassRemoval });
    logger.log(`DIBA ${dryRun ? 'dry-run' : 'import'}: ${JSON.stringify(summary)}`);
    return summary;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let closeError = null;
    try { db?.close(); } catch (error) { closeError = error; }
    try { await lock?.release(); }
    catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      Object.defineProperty(primaryError, 'lockCleanupError', { value: cleanupError, enumerable: false });
    }
    if (closeError && !primaryError) throw closeError;
    if (closeError && primaryError) Object.defineProperty(primaryError, 'databaseCloseError', { value: closeError, enumerable: false });
  }
}
