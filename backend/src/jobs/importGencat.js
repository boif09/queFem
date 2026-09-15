import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { GencatImportLock } from '../gencat/importLock.js';
import { GencatAgendaImporter } from '../importers/gencatAgenda.importer.js';
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
      if (expiredSummary.plans > 0) logger.log(`Purged expired: ${expiredSummary.plans} plans older than ${expiredSummary.cutoff}`);
      if (outsideSummary.plans > 0) logger.log(`Purged outside Catalonia: ${outsideSummary.plans} plans`);
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
