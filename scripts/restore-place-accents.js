// One-off, operator-run correction of plans.comarca, plans.municipality and plans.locality to the official ICGC spelling (see
// backend/src/location/placeNameRestorer.js). Gencat stores de-accented slugs and its importer never refreshes existing
// rows, so plans imported before the normalizer was fixed keep "Barcelones" / "Alcarras" forever.
//
// Default is a read-only dry-run. Nothing is written unless --apply is passed together with --expected-changes=<n> and
// --expected-hash=<h>, the count and the fingerprint of the exact change set the dry-run printed: if the data moved in
// between (even keeping the same count) the run aborts. Only the comarca, municipality and locality columns are
// updated; updated_at, fingerprints, provenance and every other column are left untouched. A rollback SQL and a JSON log
// are written before the change. Take a backup first.
//
//   node scripts/restore-place-accents.js                         # dry-run
//   node scripts/restore-place-accents.js --fields=locality       # only that column (default: all three)
//   node scripts/restore-place-accents.js --apply --expected-changes=1234 --expected-hash=0123456789ab
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { loadConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/database.js';
import { defaultPlaceNameRestorer } from '../backend/src/location/placeNameRestorer.js';

// A locality is free text: it is only touched when it is exactly an official municipality name.
const FIELDS = [['comarca', 'restoreComarca'], ['municipality', 'restoreMunicipality'], ['locality', 'restoreMunicipality']];
const FIELD_NAMES = FIELDS.map(([field]) => field);

// Pure read: every plan whose comarca or municipality differs from its official spelling.
export function computePlaceNameChanges(db, restorer = defaultPlaceNameRestorer(), fields = FIELD_NAMES) {
  const rows = db.prepare('SELECT id, comarca, municipality, locality FROM plans WHERE comarca IS NOT NULL OR municipality IS NOT NULL OR locality IS NOT NULL ORDER BY id').all();
  const changes = [];
  for (const row of rows) {
    const next = {};
    for (const [field, method] of FIELDS.filter(([name]) => fields.includes(name))) {
      const restored = restorer[method](row[field]);
      if (restored !== row[field]) next[field] = restored;
    }
    if (Object.keys(next).length) changes.push({ id: row.id, before: { comarca: row.comarca, municipality: row.municipality, locality: row.locality }, next });
  }
  return { scanned: rows.length, changes };
}

function sqlString(value) { return value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`; }

// Fingerprint of the exact change set (plan, old values, new values), so a same-size but different set is detected.
export function changeSetHash(changes) {
  return createHash('sha256').update(JSON.stringify(changes.map(({ id, before, next }) => [id, before, next]))).digest('hex').slice(0, 12);
}

// One statement per field, guarded by the value the correction wrote: a plan whose place name was changed again after
// the correction (for example by an importer) is left alone instead of being overwritten with the old value.
export function rollbackSql(changes) {
  return changes.flatMap(({ id, before, next }) => Object.keys(next).map((field) => (
    `UPDATE plans SET ${field} = ${sqlString(before[field])} WHERE id = ${id} AND ${field} = ${sqlString(next[field])};`
  )));
}

// One transaction. Re-computes inside it, so data that changed since the dry-run aborts with zero writes.
export function applyPlaceNameChanges(db, { expectedChanges, expectedHash, restorer = defaultPlaceNameRestorer(), fields = FIELD_NAMES, beforeWrite } = {}) {
  return db.transaction(() => {
    const fresh = computePlaceNameChanges(db, restorer, fields);
    if (fresh.changes.length !== expectedChanges) {
      throw new Error(`Expected ${expectedChanges} changes but found ${fresh.changes.length}; run the dry-run again. No writes performed.`);
    }
    if (changeSetHash(fresh.changes) !== expectedHash) {
      throw new Error(`The set of changes differs from the dry-run (hash ${changeSetHash(fresh.changes)}, expected ${expectedHash}); run the dry-run again. No writes performed.`);
    }
    beforeWrite?.(fresh);
    const update = {
      comarca: db.prepare('UPDATE plans SET comarca = ? WHERE id = ?'),
      municipality: db.prepare('UPDATE plans SET municipality = ? WHERE id = ?'),
      locality: db.prepare('UPDATE plans SET locality = ? WHERE id = ?'),
    };
    for (const { id, next } of fresh.changes) for (const [field, value] of Object.entries(next)) update[field].run(value, id);
    const remaining = computePlaceNameChanges(db, restorer, fields).changes.length;
    if (remaining !== 0) throw new Error(`Invariant failed: ${remaining} plans still differ after the update.`);
    return fresh;
  })();
}

function summarise(changes) {
  const counts = new Map();
  for (const { before, next } of changes) {
    for (const [field] of FIELDS) {
      if (next[field] !== undefined) {
        const key = `${field}: ${before[field]} -> ${next[field]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('--apply and --dry-run cannot both be passed.');
  const get = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
  let expected = NaN;
  let expectedHash = '';
  if (apply) {
    const rawExpected = get('expected-changes') ?? '';
    expected = /^\d+$/.test(rawExpected) ? Number.parseInt(rawExpected, 10) : NaN;
    expectedHash = get('expected-hash') ?? '';
    if (!Number.isInteger(expected) || !/^[0-9a-f]{12}$/.test(expectedHash)) throw new Error('--apply requires --expected-changes=<n> and --expected-hash=<h>, both printed by the dry-run.');
  }
  const fields = (get('fields') ?? FIELD_NAMES.join(',')).split(',');
  if (!fields.length || fields.some((field) => !FIELD_NAMES.includes(field))) throw new Error(`--fields must be a comma-separated subset of ${FIELD_NAMES.join(', ')}.`);
  const config = loadConfig();
  const db = openDatabase(config.databasePath, apply ? { readonly: false, configureJournal: true } : { readonly: true });
  try {
    const result = computePlaceNameChanges(db, undefined, fields);
    const byField = Object.fromEntries(FIELDS.map(([field]) => [field, result.changes.filter(({ next }) => next[field] !== undefined).length]));
    console.log(`${result.scanned} plans scanned; ${result.changes.length} would change (comarca ${byField.comarca}, municipality ${byField.municipality}, locality ${byField.locality}).`);
    const table = summarise(result.changes);
    console.log(`${table.length} distinct corrections:`);
    for (const [line, count] of table) console.log(`  ${String(count).padStart(5)}  ${line}`);
    const hash = changeSetHash(result.changes);
    if (!apply) { console.log(`\nDry-run only. To apply: --apply --expected-changes=${result.changes.length} --expected-hash=${hash}${fields.length === FIELD_NAMES.length ? '' : ` --fields=${fields.join(',')}`}`); return; }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = get('out-dir') || path.resolve(config.projectRoot, 'data/consolidation-logs');
    mkdirSync(outDir, { recursive: true });
    const applied = applyPlaceNameChanges(db, {
      expectedChanges: expected,
      expectedHash,
      fields,
      beforeWrite: (fresh) => {
        writeFileSync(path.join(outDir, `place-accents-${timestamp}.rollback.sql`), `-- Restores comarca/municipality/locality as they were before restore-place-accents.js (${timestamp}).\nBEGIN TRANSACTION;\n${rollbackSql(fresh.changes).join('\n')}\nCOMMIT;\n`);
        writeFileSync(path.join(outDir, `place-accents-${timestamp}.log.json`), JSON.stringify({ timestamp, dbPath: config.databasePath, changes: fresh.changes }, null, 2));
      },
    });
    console.log(`\nApplied ${applied.changes.length} plan updates.\nRollback SQL and log: ${outDir}\\place-accents-${timestamp}.*`);
  } finally { db.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; }
}
