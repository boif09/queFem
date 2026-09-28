import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';
import { purgeExpiredPlans } from '../backend/src/retention/eventRetention.js';
import { purgeOutsideCataloniaPlans } from '../backend/src/location/cataloniaScope.js';
import { purgeTemporallyInvalidPlans } from '../backend/src/quality/temporalCoherence.js';
import { purgeInactivePlans } from '../backend/src/retention/inactivePlanRetention.js';
import { RecurringProductionAppliedGroupRepository } from '../backend/src/db/repositories/recurringProductionAppliedGroup.repository.js';

const NOW = '2026-09-24T10:00:00.000Z';

function insertPlan(db, overrides = {}) {
  const defaults = {
    fingerprint: `plan-${Math.random()}`, title: 'Test plan', permanent: 0,
    status: 'active', startDate: '2026-01-01', endDate: '2026-01-01',
    province: 'Barcelona', comarca: 'Barcelonès', municipality: 'Barcelona',
    inactiveAt: null,
  };
  const p = { ...defaults, ...overrides };
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_title, permanent, status, start_date, end_date,
      province, comarca, municipality, inactive_at, quality_score, created_at, updated_at)
    VALUES ('event', @fingerprint, @title, @permanent, @status, @startDate, @endDate,
      @province, @comarca, @municipality, @inactiveAt, 70, @createdAt, @updatedAt)
  `).run({ ...p, createdAt: NOW, updatedAt: NOW }).lastInsertRowid);
}

function makeAlias(db, { canonicalPlanId, aliasPlanId, groupKey = 'gencat-agenda|x|y' }) {
  new PlanAliasRepository(db).create({ aliasPlanId, canonicalPlanId, groupKey, reason: 'test' }, { now: NOW });
}

test('purgeExpiredPlans never deletes a canonical plan even once all its occurrences are in the past, and does not throw', () => {
  withTestDatabase((db) => {
    // A canonical plan whose own start_date/end_date are long expired (as
    // would happen once every occurrence of a consolidated recurring
    // production is in the past) must survive purgeExpiredPlans — deleting
    // it would violate plan_aliases.canonical_plan_id's foreign key and,
    // without the guard, would abort the whole purge transaction.
    const canonical = insertPlan(db, { startDate: '2020-01-01', endDate: '2020-01-01' });
    const alias = insertPlan(db, { startDate: '2020-01-01', endDate: '2020-01-01' });
    makeAlias(db, { canonicalPlanId: canonical, aliasPlanId: alias });

    const unrelatedExpired = insertPlan(db, { startDate: '2020-01-01', endDate: '2020-01-01' });

    const summary = purgeExpiredPlans(db, { retentionDays: 0, now: new Date(NOW) });
    assert.deepEqual(db.prepare('SELECT id FROM plans WHERE id IN (?,?)').all(canonical, alias).map((r) => r.id).sort(), [alias, canonical].sort());
    assert.equal(db.prepare('SELECT id FROM plans WHERE id = ?').get(unrelatedExpired), undefined, 'an unrelated expired plan is still purged normally');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

test('purgeOutsideCataloniaPlans never deletes an alias or canonical plan even if its geography matches', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { province: 'Fora de Catalunya', comarca: 'Fora Estat Espanyol' });
    const alias = insertPlan(db, { province: 'Fora de Catalunya', comarca: 'Fora Estat Espanyol' });
    makeAlias(db, { canonicalPlanId: canonical, aliasPlanId: alias });

    const summary = purgeOutsideCataloniaPlans(db);
    // protectedByAlias makes the raw match count visible even though these
    // 2 plans were correctly excluded from actual deletion (cross-review
    // finding: a caller logging "Purged N" must not be misled).
    assert.equal(summary.plans, 0);
    assert.equal(summary.protectedByAlias, 2);
    assert.deepEqual(db.prepare('SELECT id FROM plans WHERE id IN (?,?)').all(canonical, alias).map((r) => r.id).sort(), [alias, canonical].sort());
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

test('purgeTemporallyInvalidPlans never deletes an alias or canonical plan even if its dates match the invalid pattern', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { startDate: '2024-13-45', endDate: '2024-13-45' });
    const alias = insertPlan(db, { startDate: '2024-13-45', endDate: '2024-13-45' });
    makeAlias(db, { canonicalPlanId: canonical, aliasPlanId: alias });

    purgeTemporallyInvalidPlans(db, { now: new Date(NOW) });
    assert.deepEqual(db.prepare('SELECT id FROM plans WHERE id IN (?,?)').all(canonical, alias).map((r) => r.id).sort(), [alias, canonical].sort());
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

test('purgeInactivePlans never deletes a CANONICAL plan either, not just an alias, if it somehow becomes inactive with zero sources (cross-review finding)', () => {
  withTestDatabase((db) => {
    // A canonical plan is normally status='active', but must still be
    // protected if it ever independently ends up inactive+source-less (e.g.
    // an unrelated admin correction) — the original fix only excluded
    // alias_plan_id, missing this symmetric case.
    const canonical = insertPlan(db, { status: 'inactive', permanent: 1, inactiveAt: '2020-01-01T00:00:00.000Z' });
    const alias = insertPlan(db, { status: 'inactive', permanent: 1, inactiveAt: '2020-01-01T00:00:00.000Z' });
    makeAlias(db, { canonicalPlanId: canonical, aliasPlanId: alias });

    const summary = purgeInactivePlans(db, { retentionDays: 1, now: new Date(NOW) });
    assert.equal(summary.isRecurringAlias, 2);
    assert.equal(summary.deleted, 0);
    assert.ok(db.prepare('SELECT id FROM plans WHERE id = ?').get(canonical));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});

test('purgeInactivePlans (existing, already-guarded path) never deletes an alias plan once it has zero plan_sources', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db);
    const alias = insertPlan(db, { status: 'inactive', permanent: 1, inactiveAt: '2020-01-01T00:00:00.000Z' });
    makeAlias(db, { canonicalPlanId: canonical, aliasPlanId: alias });

    const summary = purgeInactivePlans(db, { retentionDays: 1, now: new Date(NOW) });
    assert.equal(summary.isRecurringAlias, 1);
    assert.equal(summary.deleted, 0);
    assert.ok(db.prepare('SELECT id FROM plans WHERE id = ?').get(alias));
  });
});

test('a canonical plan is protected DIRECTLY via recurring_production_applied_groups even with no corresponding plan_aliases row (second cross-review round finding)', () => {
  withTestDatabase((db) => {
    // Simulates a partial/manual DB edit that removed the alias row but left
    // the applied-group mapping — the earlier "always transitively covered
    // by plan_aliases" reasoning was not actually schema-guaranteed, since
    // recurring_production_applied_groups only has an FK to plans, not to
    // plan_aliases.
    const canonical = insertPlan(db, { status: 'inactive', permanent: 1, inactiveAt: '2020-01-01T00:00:00.000Z' });
    new RecurringProductionAppliedGroupRepository(db).create({
      groupKey: 'gencat-agenda|x|y', source: 'gencat-agenda', canonicalPlanId: canonical, appliedBy: 'test',
    });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases WHERE canonical_plan_id = ?').get(canonical).n, 0, 'no alias row exists for this canonical');

    const summary = purgeInactivePlans(db, { retentionDays: 1, now: new Date(NOW) });
    assert.equal(summary.isRecurringAlias, 1);
    assert.equal(summary.deleted, 0);
    assert.ok(db.prepare('SELECT id FROM plans WHERE id = ?').get(canonical));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
});
