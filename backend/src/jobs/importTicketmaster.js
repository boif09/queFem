import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { TicketmasterDiscoveryFeedImporter } from '../importers/ticketmasterDiscoveryFeed.importer.js';
import { DiscoveryFeedClient } from '../ticketmaster/discoveryFeedClient.js';

function printSummary(summary, dryRun) {
  console.log(dryRun ? 'Ticketmaster dry-run (no SQLite writes)' : 'Ticketmaster import');
  const fields = [
    ['Feed records', 'feedRecords'], ['Accepted Ticketmaster records', 'ticketmasterSource'],
    ['  - trium', 'acceptedTrium'], ['  - mfx-es', 'acceptedMfxEs'],
    ['Excluded by source - universe', 'excludedUniverse'],
    ['Excluded by source - mfx-external', 'excludedMfxExternal'],
    ['Excluded by source - unknown/other', 'excludedOtherSource'],
    ['Within date horizon', 'withinHorizon'], ['Catalunya candidates', 'cataloniaCandidates'],
    ['Outside Catalunya skipped', 'outsideCataloniaSkipped'],
    ['Expired/out-of-horizon skipped', 'outOfHorizonSkipped'],
    ['Recurring inventory skipped', 'recurringInventorySkipped'],
    ['Product/package variants skipped', 'productVariantsSkipped'],
    ['Provider test records skipped', 'providerTestRecordsSkipped'], ['Invalid skipped', 'invalidSkipped'],
    ['New plans', 'newPlans'], ['Updates', 'updates'], ['Unchanged existing plans', 'unchanged'], ['Confirmed merges', 'confirmedMerges'],
    ['Possible merges', 'possibleMerges'], ['Reconciliation removals', 'reconciliationRemovals'],
  ];
  for (const [label, key] of fields) console.log(`${label}: ${summary[key]}`);
  if (summary.recurringDetails.length) {
    console.log('Recurring inventory detail:');
    for (const item of summary.recurringDetails) console.log(`- ${item.title} | ${item.venue || 'unknown venue'} | ${item.sessions} sessions | ${item.activeDays} active days | ${item.startDate}..${item.endDate} | ${item.reason}`);
  }
  if (summary.variantDetails.length) {
    console.log('Product/package variants:');
    for (const item of summary.variantDetails) console.log(`- ${item.eventId} | ${item.title} | ${item.confirmed ? 'skipped' : 'possible'} | ${item.reason}`);
  }
}

export async function importTicketmaster(config = loadConfig(), { dryRun = false, fetchImpl } = {}) {
  const db = openDatabase(config.databasePath, { readonly: dryRun });
  try {
    if (!dryRun) migrate(db);
    const client = new DiscoveryFeedClient({ apiKey: config.ticketmasterApiKey, fetchImpl });
    const importer = new TicketmasterDiscoveryFeedImporter({
      db, client, lookaheadDays: config.ticketmasterLookaheadDays,
    });
    const summary = await importer.run({ dryRun });
    printSummary(summary, dryRun);
    return summary;
  } finally { db.close(); }
}

async function main() {
  try { await importTicketmaster(loadConfig(), { dryRun: process.argv.includes('--dry-run') }); }
  catch (error) { console.error(`Importació Ticketmaster fallida: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
