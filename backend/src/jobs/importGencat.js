import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { GencatAgendaImporter } from '../importers/gencatAgenda.importer.js';
import { purgeExpiredPlans } from '../retention/eventRetention.js';

function printSummary(summary) {
  console.log(`Fetched: ${summary.fetched}`);
  console.log(`Inserted: ${summary.inserted}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Errors: ${summary.errors}`);
}

export async function importGencat(config = loadConfig()) {
  if (!config.gencatSyncEnabled) {
    throw new Error('La importació de Gencat està desactivada (GENCAT_SYNC_ENABLED=false).');
  }

  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const purgeSummary = purgeExpiredPlans(db, { retentionDays: config.eventRetentionDays });
    if (purgeSummary.plans > 0) {
      console.log(`Purged: ${purgeSummary.plans} plans older than ${purgeSummary.cutoff}`);
    }
    const importer = new GencatAgendaImporter({
      db,
      pageSize: config.gencatPageSize,
      retentionDays: config.eventRetentionDays,
    });
    const summary = await importer.run();
    printSummary(summary);
    return summary;
  } catch (error) {
    if (error.importSummary) printSummary(error.importSummary);
    throw error;
  } finally {
    db.close();
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
