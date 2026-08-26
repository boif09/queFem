import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { runFeverImport } from './feverImportRunner.js';
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
  return runFeverImport(config, {
    databasePath, migrateDatabase: true, allowMassRemoval, fetchImpl, now, manifestPath, logger,
  });
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
