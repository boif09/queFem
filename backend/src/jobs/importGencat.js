import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { GencatImportLock } from '../gencat/importLock.js';
import { GencatAgendaImporter } from '../importers/gencatAgenda.importer.js';
import { runGencatShadowReconciliation } from '../deduplication/recurringOccurrenceShadow.js';
import { purgeOutsideCataloniaPlans } from '../location/cataloniaScope.js';
import { purgeTemporallyInvalidPlans } from '../quality/temporalCoherence.js';
import { purgeExpiredPlans } from '../retention/eventRetention.js';

function printSummary(summary, logger = console) {
  logger.log(`Fetched: ${summary.fetched}`);
  logger.log(`Inserted: ${summary.inserted}`);
  logger.log(`Updated: ${summary.updated}`);
  logger.log(`Skipped: ${summary.skipped}`);
  logger.log(`Invalid: ${summary.invalid}`);
  logger.log(`Errors: ${summary.errors}`);
}

export async function importGencat(config = loadConfig(), {
  lockFactory = (databasePath) => new GencatImportLock(databasePath),
  logger = console,
} = {}) {
  if (!config.gencatSyncEnabled) {
    throw new Error('La importació de Gencat està desactivada (GENCAT_SYNC_ENABLED=false).');
  }

  const lock = lockFactory(config.databasePath);
  if (!await lock.acquire()) {
    const skipped = { event: 'gencat-import', status: 'skipped', reason: 'concurrent-import' };
    logger.log(JSON.stringify(skipped));
    return skipped;
  }

  try {
    const db = openDatabase(config.databasePath);
    try {
      migrate(db);
      const invalidSummary = purgeTemporallyInvalidPlans(db);
      const expiredSummary = purgeExpiredPlans(db, { retentionDays: config.eventRetentionDays });
      const outsideSummary = purgeOutsideCataloniaPlans(db);
      if (invalidSummary.plans > 0) logger.log(`Purged temporally invalid: ${invalidSummary.plans} plans`);
      if (invalidSummary.protectedByAlias > 0) logger.log(`Kept ${invalidSummary.protectedByAlias} temporally-invalid plan(s) protected as recurring-consolidation aliases`);
      if (expiredSummary.plans > 0) logger.log(`Purged expired: ${expiredSummary.plans} plans older than ${expiredSummary.cutoff}`);
      if (outsideSummary.plans > 0) logger.log(`Purged outside Catalonia: ${outsideSummary.plans} plans`);
      if (outsideSummary.protectedByAlias > 0) logger.log(`Kept ${outsideSummary.protectedByAlias} outside-Catalonia plan(s) protected as recurring-consolidation aliases`);
      const importer = new GencatAgendaImporter({
        db,
        pageSize: config.gencatPageSize,
        retentionDays: config.eventRetentionDays,
        imagesEnabled: config.gencatImagesEnabled,
        imageMetadataRetryHours: config.gencatImageMetadataRetryHours,
        historicalImageResolutionBudget: config.gencatHistoricalImageResolutionBudget,
      });
      const summary = await importer.run();
      printSummary(summary, logger);
      logger.log(`Image metadata: ${JSON.stringify(importer.imageMetadataSummary())}`);

      // Phase 4C.6D: shadow-only stale-occurrence reconciliation, run AFTER
      // the import itself has fully committed. A failure here must never be
      // read as "the import failed" — every record already persisted, record
      // by record, before this point, and nothing here is rolled back — but
      // it must also never be silently swallowed, since it is safety/
      // maintenance logic whose own bugs need to surface to cron monitoring.
      try {
        const gencatSourceId = db.prepare("SELECT id FROM sources WHERE key = 'gencat-agenda'").get().id;
        const runId = db.prepare('SELECT id FROM import_runs WHERE source_id = ? ORDER BY id DESC LIMIT 1').get(gencatSourceId).id;
        runGencatShadowReconciliation(db, {
          sourceId: gencatSourceId,
          runId,
          seenRecurringSessions: importer.seenRecurringSessions,
          logger,
        });
      } catch (shadowError) {
        logger.error(`[recurring-shadow] FATAL — shadow reconciliation itself failed (import data above is unaffected and already committed): ${shadowError.message}`);
        throw shadowError;
      }

      return summary;
    } catch (error) {
      if (error.importSummary) printSummary(error.importSummary, logger);
      throw error;
    } finally {
      db.close();
    }
  } finally {
    await lock.release();
  }
}

async function main() {
  try {
    await importGencat();
  } catch (error) {
    console.error(`Importació fallida: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
