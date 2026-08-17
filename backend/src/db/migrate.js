import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { loadConfig } from '../config.js';
import { openDatabase } from './database.js';

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE filename = ?');
  const record = db.prepare(
    'INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
  );
  const migrationFiles = fs.readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  const applyMigration = db.transaction((filename) => {
    db.exec(fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8'));
    record.run(filename, new Date().toISOString());
  });

  for (const filename of migrationFiles) {
    if (!applied.get(filename)) {
      applyMigration(filename);
    }
  }
}

function main() {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    console.log(`Base de dades preparada: ${config.databasePath}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
