import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MEDIA_REMOTE_FETCH_CONCURRENCY,
  MAXIMUM_MEDIA_REMOTE_FETCH_CONCURRENCY,
} from './ticketmaster/imageProxy.js';
import { DEFAULT_GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET } from './gencat/imagePolicy.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const configuredDatabasePath = env.DATABASE_PATH || './data/quefem.sqlite';
  const configuredTicketmasterImageCachePath = env.TICKETMASTER_IMAGE_CACHE_PATH
    || './data/cache/ticketmaster-images';
  const configuredFeverImageCachePath = env.FEVER_IMAGE_CACHE_PATH || './data/cache/fever-images';
  const configuredGencatImageCachePath = env.GENCAT_IMAGE_CACHE_PATH || './data/cache/gencat-images';

  return {
    projectRoot,
    seoTemplatePath: path.resolve(projectRoot, 'frontend/dist/index.html'),
    host: env.HOST || '127.0.0.1',
    port: positiveInteger(env.PORT, 3000),
    databasePath: path.isAbsolute(configuredDatabasePath)
      ? configuredDatabasePath
      : path.resolve(projectRoot, configuredDatabasePath),
    gencatSyncEnabled: env.GENCAT_SYNC_ENABLED !== 'false',
    gencatPageSize: positiveInteger(env.GENCAT_PAGE_SIZE, 1000),
    gencatImagesEnabled: env.GENCAT_IMAGES_ENABLED !== 'false',
    gencatImageCachePath: path.isAbsolute(configuredGencatImageCachePath)
      ? configuredGencatImageCachePath : path.resolve(projectRoot, configuredGencatImageCachePath),
    gencatImageCacheTtlHours: positiveInteger(env.GENCAT_IMAGE_CACHE_TTL_HOURS, 6),
    gencatImageCacheMaxMb: positiveInteger(env.GENCAT_IMAGE_CACHE_MAX_MB, 512),
    gencatImageMetadataRetryHours: positiveInteger(env.GENCAT_IMAGE_METADATA_RETRY_HOURS, 24),
    gencatHistoricalImageResolutionBudget: nonNegativeInteger(
      env.GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET,
      DEFAULT_GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET,
    ),
    gencatImageRequestTimeoutMs: positiveInteger(env.GENCAT_IMAGE_REQUEST_TIMEOUT_MS, 15000),
    gencatImageMaximumBytes: positiveInteger(env.GENCAT_IMAGE_MAX_BYTES, 10485760),
    ticketmasterApiKey: env.TICKETMASTER_API_KEY || '',
    ticketmasterLookaheadDays: positiveInteger(env.TICKETMASTER_LOOKAHEAD_DAYS, 90),
    ticketmasterImagesEnabled: env.TICKETMASTER_IMAGES_ENABLED === 'true',
    ticketmasterImageCachePath: path.isAbsolute(configuredTicketmasterImageCachePath)
      ? configuredTicketmasterImageCachePath
      : path.resolve(projectRoot, configuredTicketmasterImageCachePath),
    ticketmasterImageCacheTtlHours: positiveInteger(env.TICKETMASTER_IMAGE_CACHE_TTL_HOURS, 6),
    ticketmasterImageCacheMaxMb: positiveInteger(env.TICKETMASTER_IMAGE_CACHE_MAX_MB, 512),
    ticketmasterImageMetadataRefreshHours: positiveInteger(env.TICKETMASTER_IMAGE_METADATA_REFRESH_HOURS, 24),
    ticketmasterImageRequestTimeoutMs: positiveInteger(env.TICKETMASTER_IMAGE_REQUEST_TIMEOUT_MS, 15000),
    ticketmasterImageMaximumBytes: positiveInteger(env.TICKETMASTER_IMAGE_MAX_BYTES, 10485760),
    impactAccountSid: env.IMPACT_ACCOUNT_SID || '',
    impactAuthToken: env.IMPACT_AUTH_TOKEN || '',
    feverLookaheadDays: positiveInteger(env.FEVER_LOOKAHEAD_DAYS, 365),
    feverImagesEnabled: env.FEVER_IMAGES_ENABLED === 'true',
    feverImageCachePath: path.isAbsolute(configuredFeverImageCachePath) ? configuredFeverImageCachePath : path.resolve(projectRoot, configuredFeverImageCachePath),
    feverImageCacheTtlHours: positiveInteger(env.FEVER_IMAGE_CACHE_TTL_HOURS, 6),
    feverImageCacheMaxMb: positiveInteger(env.FEVER_IMAGE_CACHE_MAX_MB, 512),
    feverImageRequestTimeoutMs: positiveInteger(env.FEVER_IMAGE_REQUEST_TIMEOUT_MS, 15000),
    feverImageMaximumBytes: positiveInteger(env.FEVER_IMAGE_MAX_BYTES, 10485760),
    mediaRemoteFetchConcurrency: boundedInteger(
      env.MEDIA_REMOTE_FETCH_CONCURRENCY,
      DEFAULT_MEDIA_REMOTE_FETCH_CONCURRENCY,
      1,
      MAXIMUM_MEDIA_REMOTE_FETCH_CONCURRENCY,
    ),
    eventRetentionDays: nonNegativeInteger(env.EVENT_RETENTION_DAYS, 0),
    inactivePlanRetentionDays: positiveInteger(env.INACTIVE_PLAN_RETENTION_DAYS, 7),
    defaultLanguage: env.DEFAULT_LANGUAGE || 'ca',
  };
}
