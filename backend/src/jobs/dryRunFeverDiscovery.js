import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { ImpactCatalogClient } from '../fever/impactClient.js';
import { analyzeFeverDiscovery } from '../fever/discoveryPolicy.js';

function printSummary(summary, lookaheadDays) {
  console.log('Fever/Impact discovery dry-run (read-only; SQLite is not opened)');
  const rows = [
    ['Pages downloaded', summary.pages], ['Spain items', summary.spainItems],
    ['Matching catalog/campaign', summary.matchingCatalogCampaign], ['Catalunya items', summary.cataloniaItems],
    ['Active/future by ExpirationDate', summary.activeFuture], ['Expired', summary.expired],
    ['Gift cards', summary.giftCards], ['Active non-gift candidates', summary.activeNonGiftCandidates],
    [`Candidates with a future session <=${lookaheadDays} days`, summary.candidatesWithFutureSessionInHorizon],
    ['With / without ImageUrl', `${summary.withImage} / ${summary.withoutImage}`],
    ['Valid / invalid coordinates', `${summary.validCoordinates} / ${summary.invalidCoordinates}`],
    ['Tier 1 / 2 / 3 / 4 / other', `${summary.tiers.tier1} / ${summary.tiers.tier2} / ${summary.tiers.tier3} / ${summary.tiers.tier4} / ${summary.tiers.other}`],
    ['With / without SubCategory', `${summary.withSubCategory} / ${summary.withoutSubCategory}`],
    ['Valid / invalid fever.pxf.io URLs', `${summary.validAffiliateUrls} / ${summary.invalidAffiliateUrls}`],
    ['Sessions 1 / 2-10 / 11-50 / 51+', `${summary.sessionDistribution.one} / ${summary.sessionDistribution.twoToTen} / ${summary.sessionDistribution.elevenToFifty} / ${summary.sessionDistribution.fiftyOnePlus}`],
    ['Invalid/unparseable sessions', summary.invalidSessions],
    ['First / last observed session', `${summary.firstObservedSession || '-'} / ${summary.lastObservedSession || '-'}`],
  ];
  for (const [label, value] of rows) console.log(`${label}: ${value}`);
}

export async function dryRunFeverDiscovery(config = loadConfig(), { fetchImpl, now } = {}) {
  const client = new ImpactCatalogClient({
    accountSid: config.impactAccountSid, authToken: config.impactAuthToken, fetchImpl,
  });
  const download = await client.discoverSpain();
  const summary = analyzeFeverDiscovery(download, { lookaheadDays: config.feverLookaheadDays, ...(now ? { now } : {}) });
  printSummary(summary, config.feverLookaheadDays);
  return summary;
}

async function main() {
  try { await dryRunFeverDiscovery(); }
  catch (error) { console.error(`Fever/Impact discovery dry-run failed: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
