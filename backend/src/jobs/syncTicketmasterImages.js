import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { PlanSourceImageRepository } from '../db/repositories/planSourceImage.repository.js';
import { TicketmasterImageClient } from '../ticketmaster/imageClient.js';
import { TicketmasterImageCache } from '../ticketmaster/imageCache.js';
import { TicketmasterImageSyncLock } from '../ticketmaster/imageSyncLock.js';
import { selectTicketmasterImages } from '../ticketmaster/imageSelector.js';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function syncTicketmasterImages(
  config = loadConfig(),
  { fetchImpl, logger = console, requestIntervalMs = 650, force = false, now = () => new Date() } = {},
) {
  if (!config.ticketmasterImagesEnabled) {
    throw new Error('TICKETMASTER_IMAGES_ENABLED ha de ser true per executar la sincronització local.');
  }
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const repository = new PlanSourceImageRepository(db);
    const client = new TicketmasterImageClient({
      apiKey: config.ticketmasterApiKey,
      fetchImpl,
      timeoutMs: config.ticketmasterImageRequestTimeoutMs || 15_000,
    });
    const cache = new TicketmasterImageCache({
      directory: config.ticketmasterImageCachePath
        || path.resolve(path.dirname(config.databasePath), 'cache', 'ticketmaster-images'),
      ttlHours: config.ticketmasterImageCacheTtlHours || 6,
      maximumMb: config.ticketmasterImageCacheMaxMb || 512,
      now,
    });
    const refreshCutoff = new Date(
      now().getTime() - (config.ticketmasterImageMetadataRefreshHours || 24) * 60 * 60 * 1000,
    ).toISOString();
    const refresh = repository.findTicketmasterSourcesForRefresh(refreshCutoff, { force });
    const sources = refresh.sources;
    const summary = {
      sourcesFound: refresh.total, eligible: sources.length, consulted: 0, withImage: 0, withoutImage: 0,
      errors: 0, created: 0, updated: 0, unchanged: 0, removed: 0,
      cacheOrphaned: 0, cacheExpired: 0, cacheEvicted: 0, cacheBytes: 0,
    };
    for (const [index, source] of sources.entries()) {
      if (index > 0 && requestIntervalMs > 0) await wait(requestIntervalMs);
      summary.consulted += 1;
      try {
        const selections = selectTicketmasterImages(await client.getEventImages(source.event_id));
        if (selections.card || selections.detail) summary.withImage += 1;
        else summary.withoutImage += 1;
        const persisted = repository.persistSelections(source.plan_source_id, selections);
        for (const key of ['created', 'updated', 'unchanged', 'removed']) summary[key] += persisted[key];
      } catch (error) {
        summary.errors += 1;
        logger.warn(`Imatges Ticketmaster omeses per l'event ${source.event_id}: ${error.message}`);
      }
    }
    const cleanup = await cache.cleanup(repository.findAllImageIds());
    summary.cacheOrphaned = cleanup.orphaned;
    summary.cacheExpired = cleanup.expired;
    summary.cacheEvicted = cleanup.evicted;
    summary.cacheBytes = cleanup.bytes;
    return summary;
  } finally {
    db.close();
  }
}

export function printTicketmasterImageSummary(summary) {
  console.log('Ticketmaster image metadata sync');
  console.log(`Sources found: ${summary.sourcesFound}`);
  console.log(`Eligible for refresh: ${summary.eligible}`);
  console.log(`Consulted: ${summary.consulted}`);
  console.log(`With image: ${summary.withImage}`);
  console.log(`Without image: ${summary.withoutImage}`);
  console.log(`Errors: ${summary.errors}`);
  console.log(`Created: ${summary.created}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Unchanged: ${summary.unchanged}`);
  console.log(`Removed: ${summary.removed}`);
  console.log(`Cache orphaned removed: ${summary.cacheOrphaned}`);
  console.log(`Cache expired removed: ${summary.cacheExpired}`);
  console.log(`Cache old entries removed by size limit: ${summary.cacheEvicted}`);
  console.log(`Cache bytes after cleanup: ${summary.cacheBytes}`);
}

export function parseImageSyncArguments(args) {
  if (args.some((argument) => argument !== '--force')) {
    throw new Error('Ús: npm run ticketmaster:images:sync -- [--force]');
  }
  return { force: args.includes('--force') };
}

async function main() {
  const config = loadConfig();
  if (!config.ticketmasterImagesEnabled) {
    console.error('Sincronització d\'imatges Ticketmaster desactivada: TICKETMASTER_IMAGES_ENABLED=false.');
    return;
  }
  const lock = new TicketmasterImageSyncLock(config.ticketmasterImageCachePath);
  try {
    if (!await lock.acquire()) {
      console.log('Ticketmaster image metadata sync skipped: another execution is already active.');
      return;
    }
    const summary = await syncTicketmasterImages(config, parseImageSyncArguments(process.argv.slice(2)));
    printTicketmasterImageSummary(summary);
  } catch (error) {
    console.error(`Sincronització d'imatges Ticketmaster fallida: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await lock.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
