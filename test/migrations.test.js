import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { PlanQueryRepository } from '../backend/src/db/repositories/planQuery.repository.js';
import { PlanSourceImageRepository } from '../backend/src/db/repositories/planSourceImage.repository.js';
import { withTestDatabase } from './helpers.js';

test('creates the current schema including occurrences and seeds approved sources', () => {
  withTestDatabase((db) => {
    const tableNames = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map(({ name }) => name);

    for (const required of ['sources', 'plans', 'plan_sources', 'plan_source_images', 'plan_occurrences', 'plan_source_geography', 'categories', 'plan_categories', 'import_runs']) {
      assert.ok(tableNames.includes(required), `missing table ${required}`);
    }

    const source = db.prepare("SELECT * FROM sources WHERE key = 'gencat-agenda'").get();
    assert.equal(source.enabled, 1);
    assert.equal(source.allows_data_reuse, 1);
    assert.equal(source.allows_transformation, 1);
    assert.equal(source.allows_images, 1);
    assert.match(source.review_notes, /Peu d'imatge/);
    assert.equal(source.requires_update_date, 1);
    assert.equal(source.dataset_id, 'rhpv-yr4f');
    const ticketmaster = db.prepare("SELECT * FROM sources WHERE key = 'ticketmaster-discovery-feed'").get();
    assert.equal(ticketmaster.enabled, 1);
    assert.equal(ticketmaster.allows_data_reuse, 1);
    assert.equal(ticketmaster.allows_transformation, 0);
    assert.equal(ticketmaster.allows_commercial_use, 0);
    assert.equal(ticketmaster.allows_images, 0);
    assert.match(ticketmaster.review_notes, /NO es Open Data/);
    assert.equal(db.prepare('SELECT count(*) AS count FROM categories').get().count, 18);
    const importRunColumns = new Set(db.pragma('table_info(import_runs)').map(({ name }) => name));
    assert.ok(importRunColumns.has('invalid'));
    assert.ok(importRunColumns.has('invalid_details'));
    assert.ok(importRunColumns.has('summary_json'));
    const planColumns = new Set(db.pragma('table_info(plans)').map(({ name }) => name));
    assert.ok(planColumns.has('inactive_at'));
    const imageColumns = new Set(db.pragma('table_info(plan_source_images)').map(({ name }) => name));
    for (const column of ['plan_source_id', 'role', 'url', 'ratio', 'width', 'height', 'is_fallback', 'attribution', 'attribution_known', 'last_seen_at']) {
      assert.ok(imageColumns.has(column));
    }
    assert.equal(db.pragma('table_info(plan_source_images)').find(({ name }) => name === 'attribution_known').dflt_value, '0');
    const occurrenceColumns = new Set(db.pragma('table_info(plan_occurrences)').map(({ name }) => name));
    for (const column of ['plan_source_id', 'occurrence_key', 'starts_at', 'ends_at', 'local_date', 'local_time', 'timezone', 'status', 'last_seen_at']) {
      assert.ok(occurrenceColumns.has(column));
    }
    assert.equal(db.pragma('table_info(plan_occurrences)').find(({ name }) => name === 'starts_at').notnull, 0);
    const occurrenceForeignKey = db.pragma('foreign_key_list(plan_occurrences)');
    assert.deepEqual(occurrenceForeignKey.map(({ table, from, to, on_delete: onDelete }) => ({ table, from, to, onDelete })), [
      { table: 'plan_sources', from: 'plan_source_id', to: 'id', onDelete: 'CASCADE' },
    ]);
    const occurrenceIndexes = new Set(db.pragma('index_list(plan_occurrences)').map(({ name }) => name));
    assert.ok(occurrenceIndexes.has('idx_plan_occurrences_source_date'));
    assert.ok(occurrenceIndexes.has('idx_plan_occurrences_date_source'));
    assert.ok(occurrenceIndexes.has('idx_plan_occurrences_source_status_date_time'));
    assert.ok([...occurrenceIndexes].some((name) => name.startsWith('sqlite_autoindex_plan_occurrences')));
    const geographyColumns = new Set(db.pragma('table_info(plan_source_geography)').map(({ name }) => name));
    for (const column of ['plan_source_id', 'resolution_status', 'latitude', 'longitude',
      'municipality_code', 'municipality_name', 'comarca_code', 'comarca_name',
      'province_code', 'province_name', 'provider', 'dataset', 'dataset_date', 'layer',
      'snapshot_checksum', 'location_basis', 'created_at', 'updated_at']) assert.ok(geographyColumns.has(column));
    assert.equal(db.pragma('table_info(plan_source_geography)').find(({ name }) => name === 'municipality_code').type, 'TEXT');
    assert.deepEqual(db.pragma('foreign_key_list(plan_source_geography)').map(({ table, from, to, on_delete: onDelete }) => ({ table, from, to, onDelete })), [
      { table: 'plan_sources', from: 'plan_source_id', to: 'id', onDelete: 'CASCADE' },
    ]);
    const fever = db.prepare("SELECT * FROM sources WHERE key='fever'").get();
    assert.equal(fever.enabled, 0);
    assert.equal(fever.allows_images, 0);
  });
});

test('migration 012 keeps legacy Gencat images unknown while preserving reviewed source images', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-gencat-migration-'));
  const db = openDatabase(path.join(directory, 'legacy.sqlite'));
  try {
    db.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const migrations = path.resolve('backend/src/db/migrations');
    for (const filename of fs.readdirSync(migrations).filter((name) => /^0(0[1-9]|1[01])_.*\.sql$/.test(name)).sort()) {
      db.exec(fs.readFileSync(path.join(migrations, filename), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(filename, '2026-09-14T00:00:00Z');
    }

    const sourceKeys = ['gencat-agenda', 'ticketmaster-discovery-feed', 'fever', 'diba-tourisme'];
    const policiesBefore = db.prepare(`
      SELECT key, enabled, allows_images, review_notes, reviewed_at
      FROM sources WHERE key IN (${sourceKeys.map(() => '?').join(',')}) ORDER BY key
    `).all(...sourceKeys);
    const insertPlan = db.prepare(`
      INSERT INTO plans (kind, fingerprint, original_title, permanent, status, created_at, updated_at)
      VALUES ('event', ?, ?, 1, 'active', ?, ?)
    `);
    const insertSource = db.prepare(`
      INSERT INTO plan_sources (
        plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
      ) VALUES (?, ?, ?, '{}', ?, ?)
    `);
    const insertImage = db.prepare(`
      INSERT INTO plan_source_images (
        plan_source_id, role, url, ratio, width, height, is_fallback,
        attribution, last_seen_at, created_at, updated_at
      ) VALUES (?, 'card', ?, '16:9', 16, 9, 0, ?, ?, ?, ?)
    `);
    const now = '2026-09-14T00:00:00Z';
    const ids = {};
    for (const [index, key] of sourceKeys.entries()) {
      const planId = Number(insertPlan.run(`migration-${key}`, `Migration ${key}`, now, now).lastInsertRowid);
      const sourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(key).id;
      const planSourceId = Number(insertSource.run(planId, sourceId, `legacy-${key}`, now, now).lastInsertRowid);
      const url = key === 'gencat-agenda'
        ? 'https://agenda.cultura.gencat.cat/content/dam/agenda/legacy.jpg'
        : `https://example.test/${index}.jpg`;
      ids[key] = {
        planId,
        imageId: Number(insertImage.run(planSourceId, url, key === 'gencat-agenda' ? null : key, now, now, now).lastInsertRowid),
      };
    }

    migrate(db);
    migrate(db);

    const imageStates = Object.fromEntries(db.prepare(`
      SELECT s.key, psi.attribution_known
      FROM plan_source_images psi
      JOIN plan_sources ps ON ps.id=psi.plan_source_id
      JOIN sources s ON s.id=ps.source_id
    `).all().map(({ key, attribution_known: known }) => [key, known]));
    assert.deepEqual(imageStates, {
      'gencat-agenda': 0,
      'ticketmaster-discovery-feed': 1,
      fever: 1,
      'diba-tourisme': 0,
    });
    assert.equal(db.pragma('table_info(plan_source_images)').find(({ name }) => name === 'attribution_known').dflt_value, '0');

    const imageRepository = new PlanSourceImageRepository(db);
    assert.equal(imageRepository.findServableImage(ids['gencat-agenda'].imageId, 'gencat-agenda'), undefined);
    assert.ok(imageRepository.findServableTicketmasterImage(ids['ticketmaster-discovery-feed'].imageId));
    const plans = [{ id: ids['gencat-agenda'].planId }];
    new PlanQueryRepository(db, { gencatImagesEnabled: true }).attachImages(plans, 'card');
    assert.equal(plans[0].image, null);

    const policiesAfter = db.prepare(`
      SELECT key, enabled, allows_images, review_notes, reviewed_at
      FROM sources WHERE key IN (${sourceKeys.map(() => '?').join(',')}) ORDER BY key
    `).all(...sourceKeys);
    assert.deepEqual(
      policiesAfter.filter(({ key }) => key !== 'gencat-agenda'),
      policiesBefore.filter(({ key }) => key !== 'gencat-agenda'),
    );
    assert.equal(policiesAfter.find(({ key }) => key === 'gencat-agenda').allows_images, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE filename='012_enable_gencat_images.sql'").get().count, 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 009 upgrades an M4A-era database and remains idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-m4a-migration-'));
  const db = openDatabase(path.join(directory, 'legacy.sqlite'));
  try {
    db.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const migrations = path.resolve('backend/src/db/migrations');
    for (const filename of fs.readdirSync(migrations).filter((name) => /^00[1-8]_.*\.sql$/.test(name)).sort()) {
      db.exec(fs.readFileSync(path.join(migrations, filename), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(filename, '2026-08-25T00:00:00Z');
    }
    db.prepare("INSERT INTO sources (key,name,enabled) VALUES ('fever','Fever legacy',1)").run();
    const otherSources = db.prepare("SELECT key,enabled FROM sources WHERE key<>'fever' ORDER BY key").all();
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='plan_source_geography'").get(), undefined);
    migrate(db);
    migrate(db);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='plan_source_geography'").get());
    assert.equal(db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE filename='009_add_fever_source_geography.sql'").get().count, 1);
    assert.equal(db.prepare("SELECT enabled FROM sources WHERE key='fever'").get().enabled, 0);
    assert.deepEqual(db.prepare("SELECT key,enabled FROM sources WHERE key IN ('gencat-agenda','ticketmaster-discovery-feed') ORDER BY key").all(), otherSources);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration 009 preserves an already disabled Fever source', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-m4a-disabled-'));
  const db = openDatabase(path.join(directory, 'legacy.sqlite'));
  try {
    db.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const migrations = path.resolve('backend/src/db/migrations');
    for (const filename of fs.readdirSync(migrations).filter((name) => /^00[1-8]_.*\.sql$/.test(name)).sort()) {
      db.exec(fs.readFileSync(path.join(migrations, filename), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(filename, '2026-08-25T00:00:00Z');
    }
    db.prepare("INSERT INTO sources (key,name,enabled) VALUES ('fever','Fever legacy',0)").run();
    migrate(db);
    assert.equal(db.prepare("SELECT enabled FROM sources WHERE key='fever'").get().enabled, 0);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
