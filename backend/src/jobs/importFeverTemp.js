import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { ImpactCatalogClient } from '../fever/impactClient.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { CataloniaAdministrativeResolver } from '../geography/cataloniaAdministrativeResolver.js';
import { FeverImporter } from '../importers/fever.importer.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from './updateIcgcGeography.js';

function comparablePath(value) {
  const absolute = path.resolve(value);
  const normalize = (candidate) => process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  try { return normalize(fs.realpathSync.native(absolute)); }
  catch {
    let existing = absolute;
    const missing = [];
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return normalize(absolute);
      missing.unshift(path.basename(existing));
      existing = parent;
    }
    return normalize(path.join(fs.realpathSync.native(existing), ...missing));
  }
}

function samePhysicalFile(leftPath, rightPath) {
  if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) return false;
  const left = fs.statSync(leftPath);
  const right = fs.statSync(rightPath);
  return left.dev === right.dev && left.ino === right.ino;
}

export function assertTemporaryDatabasePath(targetPath, configuredRealPath) {
  if (!targetPath) throw new Error('A temporary --database path is required');
  if (comparablePath(targetPath) === comparablePath(configuredRealPath)
    || samePhysicalFile(path.resolve(targetPath), path.resolve(configuredRealPath))) {
    throw new Error('Fever M4B refuses to write the configured real DATABASE_PATH');
  }
}

export async function cloneDatabaseReadonly(sourcePath, targetPath) {
  assertTemporaryDatabasePath(targetPath, sourcePath);
  if (fs.existsSync(targetPath)) throw new Error('Temporary clone target already exists');
  fs.mkdirSync(path.dirname(path.resolve(targetPath)), { recursive: true });
  const source = openDatabase(sourcePath, { readonly: true });
  try { await source.backup(path.resolve(targetPath)); }
  finally { source.close(); }
}

export async function importFeverTemp(config = loadConfig(), {
  databasePath, cloneReal = false, allowMassRemoval = false, fetchImpl, now,
  manifestPath = DEFAULT_ICGC_MANIFEST_PATH, logger = console,
} = {}) {
  assertTemporaryDatabasePath(databasePath, config.databasePath);
  if (cloneReal) await cloneDatabaseReadonly(config.databasePath, databasePath);
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
  const db = openDatabase(path.resolve(databasePath));
  try {
    const databaseBytesBefore = fs.statSync(path.resolve(databasePath)).size;
    migrate(db);
    const importer = new FeverImporter({
      db, resolver, snapshotChecksum: loaded.manifest.snapshotSha256,
      lookaheadDays: config.feverLookaheadDays, ...(now ? { now } : {}),
    });
    const summary = await importer.run(download, { allowMassRemoval });
    summary.performance.downloadMs = downloadMs;
    summary.performance.snapshotLoadMs = snapshotLoadMs;
    for (const key of Object.keys(summary.performance)) {
      summary.performance[key] = Number(summary.performance[key].toFixed(1));
    }
    summary.integrityCheck = db.pragma('integrity_check', { simple: true });
    summary.databaseBytesBefore = databaseBytesBefore;
    summary.databaseBytesAfter = fs.statSync(path.resolve(databasePath)).size;
    summary.walBytes = fs.existsSync(`${path.resolve(databasePath)}-wal`)
      ? fs.statSync(`${path.resolve(databasePath)}-wal`).size : 0;
    summary.persistedCounts = db.prepare(`SELECT
      COUNT(DISTINCT p.id) plans,
      COUNT(DISTINCT ps.id) plan_sources,
      COUNT(DISTINCT CASE WHEN o.status='active' THEN o.id END) active_occurrences,
      COUNT(DISTINCT CASE WHEN o.status='inactive' THEN o.id END) inactive_occurrences
      FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id
      JOIN sources s ON s.id=ps.source_id
      LEFT JOIN plan_occurrences o ON o.plan_source_id=ps.id WHERE s.key='fever'`).get();
    logger.log(`Fever M4B temporary import: ${JSON.stringify(summary)}`);
    return summary;
  } finally { db.close(); }
}

function parseArguments(argv) {
  const allowed = new Set(['--database', '--clone-real', '--allow-mass-removal']);
  for (const argument of argv) {
    if (argument.startsWith('--') && !allowed.has(argument)) throw new Error(`Unknown argument: ${argument}`);
  }
  const databaseIndex = argv.indexOf('--database');
  if (databaseIndex < 0 || !argv[databaseIndex + 1] || argv[databaseIndex + 1].startsWith('--')) {
    throw new Error('Usage: npm run fever:import:temp -- --database <temporary.sqlite> [--clone-real] [--allow-mass-removal]');
  }
  return {
    databasePath: argv[databaseIndex + 1], cloneReal: argv.includes('--clone-real'),
    allowMassRemoval: argv.includes('--allow-mass-removal'),
  };
}

async function main() {
  try { await importFeverTemp(loadConfig(), parseArguments(process.argv.slice(2))); }
  catch (error) { console.error(`Fever M4B temporary import failed: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
