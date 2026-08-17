import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { purgeExpiredPlans } from '../retention/eventRetention.js';

export function purgeOldPlans(config = loadConfig(), { compact = true, now = new Date() } = {}) {
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const summary = purgeExpiredPlans(db, {
      retentionDays: config.eventRetentionDays,
      now,
    });
    if (compact) {
      if (summary.plans > 0) db.exec('VACUUM');
      db.pragma('wal_checkpoint(TRUNCATE)');
    }
    return summary;
  } finally {
    db.close();
  }
}

function printSummary(summary) {
  console.log(`Cutoff: ${summary.cutoff}`);
  console.log(`Plans deleted: ${summary.plans}`);
  console.log(`Plan sources deleted: ${summary.planSources}`);
  console.log(`Plan categories deleted: ${summary.planCategories}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    printSummary(purgeOldPlans());
  } catch (error) {
    console.error(`Purga fallida: ${error.message}`);
    process.exitCode = 1;
  }
}
