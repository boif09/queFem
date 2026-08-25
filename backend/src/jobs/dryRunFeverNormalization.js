import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { ImpactCatalogClient } from '../fever/impactClient.js';
import { analyzeFeverNormalization } from '../fever/normalizationAnalysis.js';

function printSummary(summary, logger = console) {
  const p = summary.products;
  const s = summary.sessions;
  const d = summary.distribution;
  const dates = summary.dates;
  const n = summary.normalization;
  logger.log('Fever normalization/occurrences dry-run (memory-only; SQLite is not opened)');
  logger.log(`Reference / horizon end: ${summary.today} / ${summary.horizonEnd} (${summary.lookaheadDays} days)`);
  const rows = [
    ['Pages / Spain items', `${p.pages} / ${p.spainItems}`],
    ['Matching catalog/campaign', p.matchingCatalogCampaign],
    ['Catalunya / Gift Cards excluded / eligible non-gift', `${p.cataloniaItems} / ${p.giftCardsExcluded} / ${p.eligibleNonGift}`],
    ['Products with parsed / publishable / no valid occurrence', `${p.withParsedOccurrence} / ${p.withPublishableOccurrence} / ${p.withoutValidOccurrence}`],
    ['Manufacturer tokens / parsed / invalid / duplicates', `${s.tokens} / ${s.parsed} / ${s.invalid} / ${s.duplicates}`],
    ['Sessions date-only / with time / offset-or-Z / time-no-offset', `${s.dateOnly} / ${s.withTime} / ${s.withOffsetOrZ} / ${s.withTimeWithoutOffset}`],
    ['Sessions past / future / within horizon / outside horizon', `${s.past} / ${s.future} / ${s.futureWithinHorizon} / ${s.futureOutsideHorizon}`],
    ['Formats local-minute / date-only / explicit-offset / explicit-Z', `${s.formats.localMinute} / ${s.formats.dateOnly} / ${s.formats.explicitOffset} / ${s.formats.explicitZ}`],
    ['Products with 0 / 1 / 2-10 / 11-50 / 51+ sessions', `${d.zero} / ${d.one} / ${d.twoToTen} / ${d.elevenToFifty} / ${d.fiftyOnePlus}`],
    ['Maximum sessions in one product', d.maximum],
    ['First / last observed session', `${dates.firstObserved || '-'} / ${dates.lastObserved || '-'}`],
    ['First future / last within horizon / last future', `${dates.firstFuture || '-'} / ${dates.lastWithinHorizon || '-'} / ${dates.lastFuture || '-'}`],
    ['Coordinates valid / invalid', `${n.validCoordinates} / ${n.invalidCoordinates}`],
    ['Affiliate URLs valid / invalid', `${n.validAffiliateUrls} / ${n.invalidAffiliateUrls}`],
    ['ImageUrl present / absent', `${n.withImage} / ${n.withoutImage}`],
    ['Clean description present / empty', `${n.withCleanDescription} / ${n.withoutCleanDescription}`],
    ['SubCategory present / absent', `${n.withSubCategory} / ${n.withoutSubCategory}`],
    ['Tiers 1 / 2 / 3 / 4 / other', `${n.tiers.tier1} / ${n.tiers.tier2} / ${n.tiers.tier3} / ${n.tiers.tier4} / ${n.tiers.other}`],
  ];
  for (const [label, value] of rows) logger.log(`${label}: ${value}`);
  const nonPublishable = summary.nonPublishable;
  logger.log(`Non-publishable past-only / outside-only / mixed / no sessions / other: ${nonPublishable.pastOnly.count} / ${nonPublishable.futureOutsideHorizonOnly.count} / ${nonPublishable.mixed.count} / ${nonPublishable.noSessions.count} / ${nonPublishable.other.count}`);
  for (const [name, group] of Object.entries(nonPublishable)) {
    for (const example of group.examples) {
      logger.log(`- non-publishable ${name} | ${example.catalogItemId || '-'} | ${example.name || '-'} | ${example.firstSession || '-'} / ${example.lastSession || '-'}`);
    }
  }
  const sanity = summary.expirationSanity;
  logger.log(`Expiration sanity expired+future / future+no-future-session: ${sanity.expiredWithFutureOccurrence.count} / ${sanity.futureExpirationWithoutFutureOccurrence.count}`);
  for (const [name, group] of Object.entries(sanity)) {
    for (const example of group.examples) {
      logger.log(`- expiration ${name} | ${example.catalogItemId || '-'} | ${example.name || '-'} | ${example.firstSession || '-'} / ${example.lastSession || '-'}`);
    }
  }
  if (summary.anomalies.length) {
    logger.log(`Anomaly examples (limited to ${summary.anomalies.length}):`);
    for (const anomaly of summary.anomalies) {
      logger.log(`- ${anomaly.catalogItemId || '-'} | ${anomaly.name || '-'} | ${anomaly.reason}${anomaly.value ? ` | ${anomaly.value}` : ''}`);
    }
  }
}

export async function dryRunFeverNormalization(config = loadConfig(), { fetchImpl, now, logger = console } = {}) {
  const client = new ImpactCatalogClient({
    accountSid: config.impactAccountSid,
    authToken: config.impactAuthToken,
    fetchImpl,
  });
  const download = await client.discoverSpain();
  const result = analyzeFeverNormalization(download, {
    lookaheadDays: config.feverLookaheadDays,
    ...(now ? { now } : {}),
  });
  printSummary(result.summary, logger);
  return result;
}

async function main() {
  try { await dryRunFeverNormalization(); }
  catch (error) {
    console.error(`Fever normalization dry-run failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
