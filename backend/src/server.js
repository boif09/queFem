import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);

const app = createApp({
  db,
  defaultLanguage: config.defaultLanguage,
  eventRetentionDays: config.eventRetentionDays,
  ticketmasterImagesEnabled: config.ticketmasterImagesEnabled,
  ticketmasterImageCachePath: config.ticketmasterImageCachePath,
  ticketmasterImageCacheTtlHours: config.ticketmasterImageCacheTtlHours,
  ticketmasterImageCacheMaxMb: config.ticketmasterImageCacheMaxMb,
  ticketmasterImageRequestTimeoutMs: config.ticketmasterImageRequestTimeoutMs,
  ticketmasterImageMaximumBytes: config.ticketmasterImageMaximumBytes,
  feverImagesEnabled: config.feverImagesEnabled,
  feverImageCachePath: config.feverImageCachePath,
  feverImageCacheTtlHours: config.feverImageCacheTtlHours,
  feverImageCacheMaxMb: config.feverImageCacheMaxMb,
  feverImageRequestTimeoutMs: config.feverImageRequestTimeoutMs,
  feverImageMaximumBytes: config.feverImageMaximumBytes,
});
const server = app.listen(config.port, config.host, () => {
  console.log(`API de Què Fem? disponible a http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
