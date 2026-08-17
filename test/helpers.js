import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';

export function withTestDatabase(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-test-'));
  const db = openDatabase(path.join(directory, 'test.sqlite'));
  migrate(db);
  const cleanup = () => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };

  try {
    const result = callback(db);
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
