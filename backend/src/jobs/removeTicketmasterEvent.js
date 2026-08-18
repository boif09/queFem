import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { TicketmasterReconciliationRepository } from '../db/repositories/ticketmasterReconciliation.repository.js';
import { deleteOrphanPlanWithinTransaction } from '../retention/inactivePlanRetention.js';

const TICKETMASTER_SOURCE_KEY = 'ticketmaster-discovery-feed';

export function parseRemovalArguments(args) {
  const dryRun = args.includes('--dry-run');
  const purge = args.includes('--purge');
  const unknownOptions = args.filter((arg) => arg.startsWith('--') && !['--dry-run', '--purge'].includes(arg));
  const eventIds = args.filter((arg) => !arg.startsWith('--'));
  if (unknownOptions.length || eventIds.length !== 1 || !eventIds[0].trim()) {
    throw new Error('Ús: npm run ticketmaster:remove -- EVENT_ID [--purge] [--dry-run]');
  }
  return { eventId: eventIds[0].trim(), dryRun, purge };
}

export function removeTicketmasterEvent(
  config = loadConfig(),
  {
    eventId,
    dryRun = false,
    purge = false,
    removedAt = new Date().toISOString(),
    beforeDeletePlan,
  },
) {
  if (typeof eventId !== 'string' || !eventId.trim()) throw new Error('Cal indicar un Ticketmaster event ID.');
  const db = openDatabase(config.databasePath, { readonly: dryRun });
  try {
    const source = db.prepare('SELECT id, key, name FROM sources WHERE key = ?').get(TICKETMASTER_SOURCE_KEY);
    if (!source) return { outcome: 'source-not-found', eventId: eventId.trim(), dryRun };

    const repository = new TicketmasterReconciliationRepository(db);
    const link = repository.findSourceRecord(source.id, eventId.trim());
    if (!link) return { outcome: 'not-found', eventId: eventId.trim(), dryRun };

    const sourcesBefore = repository.sourcesForPlan(link.plan_id);
    const remainingSources = sourcesBefore.filter((item) => !(
      item.key === TICKETMASTER_SOURCE_KEY && item.source_record_id === eventId.trim()
    ));
    const planWouldBePurged = purge && remainingSources.length === 0;
    let purgeResult = null;
    repository.removeSourceLinks([link], {
      dryRun,
      removedAt,
      afterRemoval: purge && !dryRun ? () => {
        if (repository.sourcesForPlan(link.plan_id).length !== 0) return;
        purgeResult = deleteOrphanPlanWithinTransaction(db, link.plan_id, { beforeDeletePlan });
      } : undefined,
    });

    return {
      outcome: dryRun ? 'dry-run' : 'removed',
      eventId: eventId.trim(),
      dryRun,
      plan: { id: link.plan_id, title: link.plan_title, statusBefore: link.plan_status },
      sourcesBefore,
      remainingSources,
      planDeactivated: remainingSources.length === 0,
      purgeRequested: purge,
      planWouldBePurged,
      planPurged: purgeResult?.deleted === 1,
      planCategoriesDeleted: purgeResult?.planCategoriesDeleted || 0,
    };
  } finally {
    db.close();
  }
}

export function printRemovalResult(result) {
  if (result.outcome === 'source-not-found') {
    console.log('No s’ha trobat la font Ticketmaster a SQLite. No s’ha modificat res.');
    return;
  }
  if (result.outcome === 'not-found') {
    console.log(`No s’ha trobat cap procedència Ticketmaster amb event ID ${result.eventId}. No s’ha modificat res.`);
    return;
  }
  console.log(result.dryRun ? 'Ticketmaster removal dry-run (no SQLite writes)' : 'Ticketmaster removal');
  console.log(`Event ID: ${result.eventId}`);
  console.log(`Plan: ${result.plan.id} | ${result.plan.title || 'sense títol'}`);
  console.log('Fonts abans:');
  for (const source of result.sourcesBefore) console.log(`- ${source.key} | ${source.source_record_id}`);
  console.log(`Resultat: ${result.dryRun ? 'cap canvi' : 'procedència Ticketmaster eliminada'}`);
  if (result.planWouldBePurged) {
    console.log(`Pla ${result.dryRun ? 's’eliminaria físicament' : 'eliminat físicament'} perquè no té altres fonts.`);
  } else if (result.planDeactivated) {
    console.log(`Pla ${result.dryRun ? 'quedaria' : 'ha quedat'} inactive perquè no té altres fonts.`);
  } else {
    console.log(`Pla conservat amb ${result.remainingSources.length} procedència/es restant/s.`);
    if (result.purgeRequested) console.log('No es fa DELETE físic perquè el pla conserva altres fonts.');
  }
}

async function main() {
  try {
    const options = parseRemovalArguments(process.argv.slice(2));
    printRemovalResult(removeTicketmasterEvent(loadConfig(), options));
  } catch (error) {
    console.error(`Retirada Ticketmaster fallida: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
