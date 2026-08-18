import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const configuredDatabasePath = env.DATABASE_PATH || './data/quefem.sqlite';

  return {
    projectRoot,
    port: positiveInteger(env.PORT, 3000),
    databasePath: path.isAbsolute(configuredDatabasePath)
      ? configuredDatabasePath
      : path.resolve(projectRoot, configuredDatabasePath),
    gencatSyncEnabled: env.GENCAT_SYNC_ENABLED !== 'false',
    gencatPageSize: positiveInteger(env.GENCAT_PAGE_SIZE, 1000),
    eventRetentionDays: nonNegativeInteger(env.EVENT_RETENTION_DAYS, 0),
    defaultLanguage: env.DEFAULT_LANGUAGE || 'ca',
  };
}
