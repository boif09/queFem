import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectInactivePlans,
  purgeInactivePlans,
} from '../backend/src/retention/inactivePlanRetention.js';
import { TicketmasterReconciliationRepository } from '../backend/src/db/repositories/ticketmasterReconciliation.repository.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const atDaysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function insertPlan(db, {
  fingerprint,
  status = 'inactive',
  inactiveAt = atDaysAgo(8),
  title = fingerprint,
} = {}) {
  return Number(db.prepare(`INSERT INTO plans (
    kind, fingerprint, original_title, title_ca, permanent, image_reuse_allowed,
    featured, quality_score, status, inactive_at, created_at, updated_at
  ) VALUES ('event', ?, ?, ?, 0, 0, 0, 70, ?, ?, ?, ?)`)
    .run(fingerprint, title, title, status, inactiveAt, atDaysAgo(20), atDaysAgo(1)).lastInsertRowid);
}

function addSource(db, planId, sourceKey, recordId) {
  const source = db.prepare('SELECT id FROM sources WHERE key = ?').get(sourceKey);
  db.prepare(`INSERT INTO plan_sources (
    plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
  ) VALUES (?, ?, ?, '{}', ?, ?)`)
    .run(planId, source.id, recordId, NOW.toISOString(), NOW.toISOString());
}

test('purges plans older than or exactly seven days and keeps recent or active plans', () => {
  withTestDatabase((db) => {
    const older = insertPlan(db, { fingerprint: 'older', inactiveAt: atDaysAgo(8) });
    const exact = insertPlan(db, { fingerprint: 'exact', inactiveAt: atDaysAgo(7) });
    const recent = insertPlan(db, { fingerprint: 'recent', inactiveAt: atDaysAgo(6) });
    const active = insertPlan(db, { fingerprint: 'active', status: 'active', inactiveAt: null });

    const summary = purgeInactivePlans(db, { retentionDays: 7, now: NOW });
    assert.equal(summary.deleted, 2);
    assert.equal(summary.tooRecent, 1);
    assert.deepEqual(db.prepare('SELECT id FROM plans ORDER BY id').all().map(({ id }) => id), [recent, active]);
    assert.ok(!db.prepare('SELECT 1 FROM plans WHERE id=?').get(older));
    assert.ok(!db.prepare('SELECT 1 FROM plans WHERE id=?').get(exact));
  });
});

test('never purges inactive plans that still have Gencat, Ticketmaster or shared provenance', () => {
  withTestDatabase((db) => {
    const gencat = insertPlan(db, { fingerprint: 'with-gencat' });
    const ticketmaster = insertPlan(db, { fingerprint: 'with-ticketmaster' });
    const shared = insertPlan(db, { fingerprint: 'shared' });
    addSource(db, gencat, 'gencat-agenda', 'gencat-one');
    addSource(db, ticketmaster, 'ticketmaster-discovery-feed', 'tm-one');
    addSource(db, shared, 'gencat-agenda', 'gencat-shared');
    addSource(db, shared, 'ticketmaster-discovery-feed', 'tm-shared');

    const summary = purgeInactivePlans(db, { retentionDays: 7, now: NOW });
    assert.equal(summary.deleted, 0);
    assert.equal(summary.stillHaveSources, 3);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 4);
  });
});

test('dry-run performs zero writes and a second real execution is idempotent', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'dry-run' });
    const preview = purgeInactivePlans(db, { retentionDays: 7, now: NOW, dryRun: true });
    assert.equal(preview.eligibleForPurge, 1);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id=?').get(planId));

    assert.equal(purgeInactivePlans(db, { retentionDays: 7, now: NOW }).deleted, 1);
    assert.equal(purgeInactivePlans(db, { retentionDays: 7, now: NOW }).deleted, 0);
  });
});

test('deletes only plan_categories and preserves shared category records and links', () => {
  withTestDatabase((db) => {
    const eligible = insertPlan(db, { fingerprint: 'categorized' });
    const active = insertPlan(db, { fingerprint: 'categorized-active', status: 'active', inactiveAt: null });
    const categoryId = db.prepare("SELECT id FROM categories WHERE slug='musica'").get().id;
    const link = db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)');
    link.run(eligible, categoryId);
    link.run(active, categoryId);

    const summary = purgeInactivePlans(db, { retentionDays: 7, now: NOW });
    assert.equal(summary.planCategoriesDeleted, 1);
    assert.ok(db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId));
    assert.deepEqual(db.prepare('SELECT plan_id FROM plan_categories WHERE category_id=?').all(categoryId), [{ plan_id: active }]);
  });
});

test('rolls back category and plan deletion when the transaction fails', () => {
  withTestDatabase((db) => {
    const planId = insertPlan(db, { fingerprint: 'rollback' });
    const categoryId = db.prepare("SELECT id FROM categories WHERE slug='musica'").get().id;
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(planId, categoryId);

    assert.throws(() => purgeInactivePlans(db, {
      retentionDays: 7,
      now: NOW,
      beforeDeletePlan() { throw new Error('simulated failure'); },
    }), /simulated failure/);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id=?').get(planId));
    assert.ok(db.prepare('SELECT 1 FROM plan_categories WHERE plan_id=?').get(planId));
  });
});

test('does not purge missing timestamps or a plan just deactivated by reconciliation', () => {
  withTestDatabase((db) => {
    insertPlan(db, { fingerprint: 'legacy', inactiveAt: null });
    const fresh = insertPlan(db, { fingerprint: 'fresh', status: 'active', inactiveAt: null });
    addSource(db, fresh, 'ticketmaster-discovery-feed', 'tm-fresh');
    const sourceId = db.prepare("SELECT id FROM sources WHERE key='ticketmaster-discovery-feed'").get().id;
    const repository = new TicketmasterReconciliationRepository(db);
    const row = repository.findSourceRecord(sourceId, 'tm-fresh');
    repository.removeSourceLinks([row], { removedAt: NOW.toISOString() });

    const inspection = inspectInactivePlans(db, { retentionDays: 7, now: NOW });
    assert.equal(inspection.missingInactiveAt, 1);
    assert.equal(inspection.tooRecent, 1);
    assert.equal(purgeInactivePlans(db, { retentionDays: 7, now: NOW }).deleted, 0);
    assert.deepEqual(db.prepare('SELECT status, inactive_at FROM plans WHERE id=?').get(fresh), {
      status: 'inactive', inactive_at: NOW.toISOString(),
    });
  });
});
