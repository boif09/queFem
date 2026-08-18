import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';

test('creates the six milestone tables and seeds the approved source', () => {
  withTestDatabase((db) => {
    const tableNames = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map(({ name }) => name);

    for (const required of ['sources', 'plans', 'plan_sources', 'categories', 'plan_categories', 'import_runs']) {
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
  });
});
