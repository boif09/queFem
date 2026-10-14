import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { DibaApiClient } from '../diba/m0Discovery.js';
import { AMBIGUITY_POLICY, DibaImporter, municipalityIndex } from '../diba/dibaImporter.js';
import { reviewQueuePath, updateReviewQueue } from '../diba/reviewQueue.js';
import { DibaReviewDecisionRepository, withReviewPageOverrides } from '../diba/reviewDecisions.js';
import { loadDibaPolicyOverridesSync } from '../diba/dibaPolicyOverrides.js';
import { DibaImportLock } from '../diba/importLock.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from './updateIcgcGeography.js';

// Dry runs intentionally open SQLite read-only: live acquisition, normalization
// and matching are exercised while even import_runs remain untouched.
export async function runDibaImport(config, {
  dryRun = false, databasePath = config.databasePath, fetchImpl, now,
  manifestPath = DEFAULT_ICGC_MANIFEST_PATH, logger = console, allowMassRemoval = false,
  lockFactory = (pathValue) => new DibaImportLock(pathValue), ambiguityPolicy = AMBIGUITY_POLICY.REVIEW_QUEUE,
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
      ...(now ? { now } : {}), ambiguityPolicy,
      // Decisions taken on the private review page extend the reviewed overrides kept in Git.
      reviewedOverrides: withReviewPageOverrides(loadDibaPolicyOverridesSync(), new DibaReviewDecisionRepository(db)),
    });
    // The queue is a best-effort report: failing to write it must never fail or hide an import result.
    const recordReviewQueue = (results) => {
      if (dryRun || !results) return;
      try { updateReviewQueue(reviewQueuePath(resolvedPath), results, now ? now() : new Date()); }
      catch (error) { console.error(`DIBA review queue could not be written: ${error.message}`); }
    };
    let summary;
    try { summary = await importer.run({ dryRun, allowMassRemoval }); }
    catch (error) { recordReviewQueue(error.results); throw error; }
    recordReviewQueue(summary.datasets);
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
