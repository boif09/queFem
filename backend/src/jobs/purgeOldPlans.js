import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { purgeOutsideCataloniaPlans } from '../location/cataloniaScope.js';
import { purgeTemporallyInvalidPlans } from '../quality/temporalCoherence.js';
import { purgeExpiredPlans } from '../retention/eventRetention.js';

export function purgeOldPlans(config = loadConfig(), { compact = true, now = new Date() } = {}) {
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const temporallyInvalid = purgeTemporallyInvalidPlans(db, { now });
    const expired = purgeExpiredPlans(db, {
      retentionDays: config.eventRetentionDays,
      now,
    });
    const outsideCatalonia = purgeOutsideCataloniaPlans(db);
    const summary = { expired, outsideCatalonia, temporallyInvalid };
    if (compact) {
      if (expired.plans > 0 || outsideCatalonia.plans > 0 || temporallyInvalid.plans > 0) {
        db.exec('VACUUM');
      }
      db.pragma('wal_checkpoint(TRUNCATE)');
    }
    return summary;
  } finally {
    db.close();
  }
}

function printSummary(summary) {
  console.log(`Cutoff: ${summary.expired.cutoff}`);
  console.log(`Expired plans deleted: ${summary.expired.plans}`);
  console.log(`Outside Catalonia plans deleted: ${summary.outsideCatalonia.plans}`);
  console.log(`Temporally invalid plans deleted: ${summary.temporallyInvalid.plans}`);
  console.log(`Plan sources deleted: ${
    summary.expired.planSources
    + summary.outsideCatalonia.planSources
    + summary.temporallyInvalid.planSources
  }`);
  console.log(`Plan categories deleted: ${
    summary.expired.planCategories
    + summary.outsideCatalonia.planCategories
    + summary.temporallyInvalid.planCategories
  }`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    printSummary(purgeOldPlans());
  } catch (error) {
    console.error(`Purga fallida: ${error.message}`);
    process.exitCode = 1;
  }
}
