import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { ImpactCatalogClient } from '../fever/impactClient.js';
import { analyzeFeverGeography } from '../fever/geographyAnalysis.js';
import { analyzeFeverNormalization } from '../fever/normalizationAnalysis.js';
import { CataloniaAdministrativeResolver } from '../geography/cataloniaAdministrativeResolver.js';
import {
  DEFAULT_ICGC_MANIFEST_PATH,
} from './updateIcgcGeography.js';

function printRanking(logger, title, rows) {
  logger.log(`${title}: ${rows.map(({ name, count }) => `${name}=${count}`).join(', ') || '-'}`);
}

function printSummary(summary, performanceSummary, logger = console) {
  logger.log('Fever geography dry-run (local ICGC snapshot; memory-only; SQLite is not opened)');
  logger.log(`Eligible / publishable / coordinates: ${summary.eligibleProducts} / ${summary.publishableProducts} / ${summary.coordinatesReceived}`);
  logger.log(`Resolved / unresolved / ambiguous / suspicious: ${summary.resolved} / ${summary.unresolved} / ${summary.ambiguous} / ${summary.suspicious}`);
  logger.log(`Publishable resolved / unresolved / ambiguous: ${summary.publicableGeography.resolved} / ${summary.publicableGeography.unresolved} / ${summary.publicableGeography.ambiguous}`);
  logger.log(`Distinct municipalities / comarques / provinces: ${summary.distinctMunicipalities} / ${summary.distinctComarques} / ${summary.distinctProvinces}`);
  logger.log(`Empty codes / names: ${summary.emptyCodes} / ${summary.emptyNames}`);
  logger.log(`Text2 matches / differs from municipality: ${summary.text2MatchesMunicipality} / ${summary.text2DoesNotMatchMunicipality}`);
  logger.log(`Bbox candidates average / maximum: ${summary.bboxCandidates.average.toFixed(3)} / ${summary.bboxCandidates.maximum}`);
  logger.log(`Snapshot load / resolve milliseconds: ${performanceSummary.loadMs.toFixed(1)} / ${performanceSummary.resolveMs.toFixed(1)}`);
  printRanking(logger, 'By province', summary.byProvince);
  printRanking(logger, 'Top comarques', summary.topComarques);
  printRanking(logger, 'Top municipalities', summary.topMunicipalities);
  for (const [group, examples] of Object.entries(summary.examples)) {
    for (const example of examples) {
      logger.log(`- ${group} | ${example.catalogItemId || '-'} | ${example.name || '-'} | ${example.coordinates.latitude},${example.coordinates.longitude}${example.reason ? ` | ${example.reason}` : ''}${example.candidates?.length ? ` | ${example.candidates.map(({ code, name }) => `${code}:${name}`).join(',')}` : ''}`);
    }
  }
}

export async function dryRunFeverGeography(config = loadConfig(), {
  fetchImpl,
  now,
  logger = console,
  manifestPath = DEFAULT_ICGC_MANIFEST_PATH,
} = {}) {
  const client = new ImpactCatalogClient({
    accountSid: config.impactAccountSid,
    authToken: config.impactAuthToken,
    fetchImpl,
  });
  const download = await client.discoverSpain();
  const normalization = analyzeFeverNormalization(download, {
    lookaheadDays: config.feverLookaheadDays,
    ...(now ? { now } : {}),
  });
  const loadStarted = performance.now();
  const resolver = await CataloniaAdministrativeResolver.fromManifest(manifestPath);
  const loadMs = performance.now() - loadStarted;
  const resolveStarted = performance.now();
  const result = analyzeFeverGeography(normalization, resolver);
  const resolveMs = performance.now() - resolveStarted;
  const performanceSummary = { loadMs, resolveMs };
  printSummary(result.summary, performanceSummary, logger);
  return { ...result, normalization, performance: performanceSummary };
}

async function main() {
  try { await dryRunFeverGeography(); }
  catch (error) {
    console.error(`Fever geography dry-run failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
