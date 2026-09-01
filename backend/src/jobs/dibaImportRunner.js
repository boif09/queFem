import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { DibaApiClient } from '../diba/m0Discovery.js';
import { DibaImporter, municipalityIndex } from '../diba/dibaImporter.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from './updateIcgcGeography.js';

// Dry runs intentionally open SQLite read-only: live acquisition, normalization
// and matching are exercised while even import_runs remain untouched.
export async function runDibaImport(config, {
  dryRun = false, databasePath = config.databasePath, fetchImpl, now,
  manifestPath = DEFAULT_ICGC_MANIFEST_PATH, logger = console, allowMassRemoval = false,
} = {}) {
  const loaded = await readAndVerifyIcgcSnapshot(manifestPath);
  const resolvedPath = path.resolve(databasePath);
  const db = openDatabase(resolvedPath, { readonly: dryRun });
  try {
    const importer = new DibaImporter({
      db, client: new DibaApiClient({ fetchImpl }), municipalities: municipalityIndex(loaded.snapshot),
      ...(now ? { now } : {}),
    });
    const summary = await importer.run({ dryRun, allowMassRemoval });
    logger.log(`DIBA ${dryRun ? 'dry-run' : 'import'}: ${JSON.stringify(summary)}`);
    return summary;
  } finally { db.close(); }
}
