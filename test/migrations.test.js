import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';

test('creates the current schema including occurrences and seeds approved sources', () => {
  withTestDatabase((db) => {
    const tableNames = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map(({ name }) => name);

    for (const required of ['sources', 'plans', 'plan_sources', 'plan_source_images', 'plan_occurrences', 'categories', 'plan_categories', 'import_runs']) {
      assert.ok(tableNames.includes(required), `missing table ${required}`);
    }

    const source = db.prepare("SELECT * FROM sources WHERE key = 'gencat-agenda'").get();
    assert.equal(source.enabled, 1);
    assert.equal(source.allows_data_reuse, 1);
    assert.equal(source.allows_transformation, 1);
    assert.equal(source.allows_images, 0);
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
    const planColumns = new Set(db.pragma('table_info(plans)').map(({ name }) => name));
    assert.ok(planColumns.has('inactive_at'));
    const imageColumns = new Set(db.pragma('table_info(plan_source_images)').map(({ name }) => name));
    for (const column of ['plan_source_id', 'role', 'url', 'ratio', 'width', 'height', 'is_fallback', 'attribution', 'last_seen_at']) {
      assert.ok(imageColumns.has(column));
    }
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
    assert.ok([...occurrenceIndexes].some((name) => name.startsWith('sqlite_autoindex_plan_occurrences')));
  });
});
