import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { isOutsideCatalonia } from '../location/cataloniaScope.js';
import { isTemporallyInvalid } from '../quality/temporalCoherence.js';

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.function('is_outside_catalonia', { deterministic: true }, (province, comarca, municipality, locality) => (
    isOutsideCatalonia({
      province,
      comarca,
      municipality,
      locality,
    }) ? 1 : 0
  ));
  db.function(
    'is_temporally_invalid',
    { deterministic: true },
    (kind, permanent, startDate, endDate, currentYear) => (
      isTemporallyInvalid({
        kind,
        permanent,
        start_date: startDate,
        end_date: endDate,
      }, { currentYear }) ? 1 : 0
    ),
  );
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}
