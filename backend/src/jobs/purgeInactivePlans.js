import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { purgeInactivePlans } from '../retention/inactivePlanRetention.js';

export function runInactivePlanPurge(
  config = loadConfig(),
  { dryRun = false, now = new Date() } = {},
) {
  const db = openDatabase(config.databasePath, { readonly: dryRun });
  try {
    if (!dryRun) migrate(db);
    return purgeInactivePlans(db, {
      retentionDays: config.inactivePlanRetentionDays,
      now,
      dryRun,
    });
  } finally {
    db.close();
  }
}

export function printInactivePurgeSummary(summary, { dryRun = false } = {}) {
  console.log(dryRun ? 'Inactive plan purge dry-run (no SQLite writes)' : 'Inactive plan purge');
  console.log(`Inactive plans found: ${summary.inactivePlansFound}`);
  console.log(`Eligible for purge: ${summary.eligibleForPurge}`);
  console.log(`Too recent: ${summary.tooRecent}`);
  console.log(`Still have sources: ${summary.stillHaveSources}`);
  console.log(`Missing inactive_at: ${summary.missingInactiveAt}`);
  console.log(`${dryRun ? 'Would delete' : 'Deleted'}: ${dryRun ? summary.eligibleForPurge : summary.deleted}`);
  for (const plan of summary.eligible) {
    console.log(`- ${plan.id} | ${plan.title} | inactive_at=${plan.inactiveAt} | ${plan.daysInactive} days`);
  }
}

function parseArguments(args) {
  if (args.some((argument) => argument !== '--dry-run')) {
    throw new Error('Ús: npm run purge:inactive -- [--dry-run]');
  }
  return { dryRun: args.includes('--dry-run') };
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    printInactivePurgeSummary(runInactivePlanPurge(loadConfig(), options), options);
  } catch (error) {
    console.error(`Purga de plans inactius fallida: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
