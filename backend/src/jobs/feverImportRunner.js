import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { ImpactCatalogClient } from '../fever/impactClient.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { CataloniaAdministrativeResolver } from '../geography/cataloniaAdministrativeResolver.js';
import { FeverImporter } from '../importers/fever.importer.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from './updateIcgcGeography.js';

export async function runFeverImport(config, {
  databasePath = config.databasePath, migrateDatabase = false, allowMassRemoval = false,
  fetchImpl, now, manifestPath = DEFAULT_ICGC_MANIFEST_PATH, logger = console,
  beforeTransaction, afterPersist,
} = {}) {
  const client = new ImpactCatalogClient({
    accountSid: config.impactAccountSid, authToken: config.impactAuthToken, fetchImpl,
  });
  const downloadStarted = performance.now();
  const download = await client.discoverSpain();
  const downloadMs = performance.now() - downloadStarted;
  const snapshotStarted = performance.now();
  const loaded = await readAndVerifyIcgcSnapshot(manifestPath);
  const resolver = new CataloniaAdministrativeResolver(loaded.snapshot, loaded.metadata);
  const snapshotLoadMs = performance.now() - snapshotStarted;
  const resolvedPath = path.resolve(databasePath);
  const db = openDatabase(resolvedPath);
  try {
    const databaseBytesBefore = fs.statSync(resolvedPath).size;
    if (migrateDatabase) migrate(db);
    const importer = new FeverImporter({
      db, resolver, snapshotChecksum: loaded.manifest.snapshotSha256,
      lookaheadDays: config.feverLookaheadDays, ...(now ? { now } : {}),
    });
    const summary = await importer.run(download, {
      allowMassRemoval,
      beforeTransaction,
      afterTransaction: ({ summary: result }) => {
        result.performance.downloadMs = downloadMs;
        result.performance.snapshotLoadMs = snapshotLoadMs;
        for (const key of Object.keys(result.performance)) result.performance[key] = Number(result.performance[key].toFixed(1));
        result.integrityCheck = db.pragma('integrity_check', { simple: true });
        result.databaseBytesBefore = databaseBytesBefore;
        result.databaseBytesAfter = fs.statSync(resolvedPath).size;
        result.walBytes = fs.existsSync(`${resolvedPath}-wal`) ? fs.statSync(`${resolvedPath}-wal`).size : 0;
        result.persistedCounts = db.prepare(`SELECT
          COUNT(DISTINCT p.id) plans, COUNT(DISTINCT ps.id) plan_sources,
          COUNT(DISTINCT CASE WHEN o.status='active' THEN o.id END) active_occurrences,
          COUNT(DISTINCT CASE WHEN o.status='inactive' THEN o.id END) inactive_occurrences
          FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id JOIN sources s ON s.id=ps.source_id
          LEFT JOIN plan_occurrences o ON o.plan_source_id=ps.id WHERE s.key='fever'`).get();
        afterPersist?.(db, result);
      },
    });
    logger.log(`Fever import: ${JSON.stringify(summary)}`);
    return summary;
  } finally { db.close(); }
}
