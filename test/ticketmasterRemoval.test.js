import assert from 'node:assert/strict';
import test from 'node:test';
import { removeTicketmasterEvent, parseRemovalArguments } from '../backend/src/jobs/removeTicketmasterEvent.js';
import { withTestDatabase } from './helpers.js';

const NOW = '2026-08-18T12:00:00.000Z';

function seedPlan(db, { shared = false, eventId = 'tm-remove' } = {}) {
  const ticketmaster = db.prepare("SELECT id FROM sources WHERE key='ticketmaster-discovery-feed'").get();
  const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
  const planId = Number(db.prepare(`INSERT INTO plans (
    kind, fingerprint, original_title, title_ca, start_date, end_date, permanent,
    image_reuse_allowed, featured, quality_score, status, created_at, updated_at
  ) VALUES ('event', ?, 'Pla retirada', 'Pla retirada', '2026-09-01', '2026-09-01', 0,
    0, 0, 70, 'active', ?, ?)` ).run(`remove-${eventId}`, NOW, NOW).lastInsertRowid);
  const insertSource = db.prepare(`INSERT INTO plan_sources (
    plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
  ) VALUES (?, ?, ?, '{}', ?, ?)`);
  insertSource.run(planId, ticketmaster.id, eventId, NOW, NOW);
  if (shared) insertSource.run(planId, gencat.id, 'gencat-keep', NOW, NOW);
  return { planId, ticketmasterId: ticketmaster.id, gencatId: gencat.id };
}

test('validates the removal command arguments', () => {
  assert.deepEqual(parseRemovalArguments(['event-1', '--purge', '--dry-run']), {
    eventId: 'event-1', dryRun: true, purge: true,
  });
  assert.deepEqual(parseRemovalArguments(['event-1']), {
    eventId: 'event-1', dryRun: false, purge: false,
  });
  assert.throws(() => parseRemovalArguments([]), /Ús:/);
  assert.throws(() => parseRemovalArguments(['one', 'two']), /Ús:/);
  assert.throws(() => parseRemovalArguments(['one', '--force']), /Ús:/);
});

test('dry-run reports an exclusive removal without writing', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db);
    const result = removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-remove', dryRun: true, removedAt: NOW,
    });
    assert.equal(result.outcome, 'dry-run');
    assert.equal(result.planDeactivated, true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?').get(planId).count, 1);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'active');
  });
});

test('removes exclusive Ticketmaster provenance and deactivates the plan', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db);
    const result = removeTicketmasterEvent({ databasePath: db.name }, { eventId: 'tm-remove', removedAt: NOW });
    assert.equal(result.outcome, 'removed');
    assert.equal(result.planDeactivated, true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?').get(planId).count, 0);
    assert.deepEqual(db.prepare('SELECT status, inactive_at FROM plans WHERE id=?').get(planId), {
      status: 'inactive', inactive_at: NOW,
    });
  });
});

test('preserves a shared plan and never removes its Gencat provenance', () => {
  withTestDatabase((db) => {
    const { planId, gencatId } = seedPlan(db, { shared: true });
    const result = removeTicketmasterEvent({ databasePath: db.name }, { eventId: 'tm-remove', removedAt: NOW });
    assert.equal(result.planDeactivated, false);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'active');
    assert.deepEqual(db.prepare('SELECT source_id, source_record_id FROM plan_sources WHERE plan_id=?').all(planId), [
      { source_id: gencatId, source_record_id: 'gencat-keep' },
    ]);
  });
});

test('an unknown or already removed ID is idempotent and changes nothing', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db);
    const before = db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count;
    assert.equal(removeTicketmasterEvent({ databasePath: db.name }, { eventId: 'unknown' }).outcome, 'not-found');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, before);
    removeTicketmasterEvent({ databasePath: db.name }, { eventId: 'tm-remove', removedAt: NOW });
    assert.equal(removeTicketmasterEvent({ databasePath: db.name }, { eventId: 'tm-remove' }).outcome, 'not-found');
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'inactive');
  });
});

test('purges an exclusive Ticketmaster plan immediately with its category links', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db, { eventId: 'tm-purge' });
    const categoryId = db.prepare("SELECT id FROM categories WHERE slug='musica'").get().id;
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(planId, categoryId);

    const result = removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-purge', purge: true, removedAt: NOW,
    });
    assert.equal(result.planPurged, true);
    assert.equal(result.planCategoriesDeleted, 1);
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id=?').get(planId), undefined);
    assert.equal(db.prepare('SELECT 1 FROM plan_sources WHERE plan_id=?').get(planId), undefined);
    assert.ok(db.prepare('SELECT 1 FROM categories WHERE id=?').get(categoryId));
  });
});

test('purge dry-run previews physical deletion with zero writes', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db, { eventId: 'tm-preview' });
    const result = removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-preview', purge: true, dryRun: true, removedAt: NOW,
    });
    assert.equal(result.planWouldBePurged, true);
    assert.equal(result.planPurged, false);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'active');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?').get(planId).count, 1);
  });
});

test('purge removes only Ticketmaster from a shared Gencat plan', () => {
  withTestDatabase((db) => {
    const { planId, gencatId } = seedPlan(db, { shared: true, eventId: 'tm-shared-purge' });
    const result = removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-shared-purge', purge: true, removedAt: NOW,
    });
    assert.equal(result.planWouldBePurged, false);
    assert.equal(result.planPurged, false);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'active');
    assert.deepEqual(db.prepare('SELECT source_id, source_record_id FROM plan_sources WHERE plan_id=?').all(planId), [
      { source_id: gencatId, source_record_id: 'gencat-keep' },
    ]);
  });
});

test('purge never deletes a plan while another Ticketmaster source remains', () => {
  withTestDatabase((db) => {
    const { planId, ticketmasterId } = seedPlan(db, { eventId: 'tm-session-one' });
    db.prepare(`INSERT INTO plan_sources (
      plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
    ) VALUES (?, ?, 'tm-session-two', '{}', ?, ?)`)
      .run(planId, ticketmasterId, NOW, NOW);
    const result = removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-session-one', purge: true, removedAt: NOW,
    });
    assert.equal(result.planPurged, false);
    assert.ok(db.prepare('SELECT 1 FROM plans WHERE id=?').get(planId));
    assert.deepEqual(db.prepare('SELECT source_record_id FROM plan_sources WHERE plan_id=?').all(planId), [
      { source_record_id: 'tm-session-two' },
    ]);
  });
});

test('purge rolls back provenance, status and categories after a failure', () => {
  withTestDatabase((db) => {
    const { planId } = seedPlan(db, { eventId: 'tm-rollback' });
    const categoryId = db.prepare("SELECT id FROM categories WHERE slug='musica'").get().id;
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(planId, categoryId);

    assert.throws(() => removeTicketmasterEvent({ databasePath: db.name }, {
      eventId: 'tm-rollback',
      purge: true,
      removedAt: NOW,
      beforeDeletePlan() { throw new Error('simulated purge failure'); },
    }), /simulated purge failure/);
    assert.deepEqual(db.prepare('SELECT status, inactive_at FROM plans WHERE id=?').get(planId), {
      status: 'active', inactive_at: null,
    });
    assert.ok(db.prepare("SELECT 1 FROM plan_sources WHERE plan_id=? AND source_record_id='tm-rollback'").get(planId));
    assert.ok(db.prepare('SELECT 1 FROM plan_categories WHERE plan_id=?').get(planId));
  });
});
