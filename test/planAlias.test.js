import assert from 'node:assert/strict';
import test from 'node:test';
import { withTestDatabase } from './helpers.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';

const NOW = '2026-09-24T10:00:00.000Z';

function insertPlan(db, { fingerprint, status = 'active' } = {}) {
  return Number(db.prepare(`
    INSERT INTO plans (kind, fingerprint, original_title, permanent, quality_score, status, created_at, updated_at)
    VALUES ('event', ?, 'Test plan', 0, 70, ?, ?, ?)
  `).run(fingerprint, status, NOW, NOW).lastInsertRowid);
}

test('alias_plan_id is unique (schema constraint A)', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias = insertPlan(db, { fingerprint: 'a|x|2' });
    const otherCanonical = insertPlan(db, { fingerprint: 'a|x|3' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    assert.throws(() => repository.create({ aliasPlanId: alias, canonicalPlanId: otherCanonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW }), /UNIQUE/);
  });
});

test('alias_plan_id must differ from canonical_plan_id (schema constraint A)', () => {
  withTestDatabase((db) => {
    const plan = insertPlan(db, { fingerprint: 'a|x|1' });
    const repository = new PlanAliasRepository(db);
    assert.throws(() => repository.create({ aliasPlanId: plan, canonicalPlanId: plan, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW }), /CHECK/);
  });
});

test('canonical_plan_id must reference an existing plan (schema constraint A)', () => {
  withTestDatabase((db) => {
    const alias = insertPlan(db, { fingerprint: 'a|x|1' });
    const repository = new PlanAliasRepository(db);
    assert.throws(() => repository.create({ aliasPlanId: alias, canonicalPlanId: 999999, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW }), /FOREIGN KEY/);
  });
});

test('alias_plan_id does NOT require an existing plans row — a legacy/retention-deleted public ID can still be aliased (Phase 4C.3A legacy-URL hardening)', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const legacyId = canonical + 500_000; // guaranteed not to exist as a plans row
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(legacyId), undefined);
    const repository = new PlanAliasRepository(db);
    assert.doesNotThrow(() => repository.create({
      aliasPlanId: legacyId, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'legacy test', isLegacy: true,
    }, { now: NOW }));
    assert.equal(repository.findCanonicalId(legacyId), canonical);
    assert.equal(repository.isLegacy(legacyId), true);
  });
});

test('a normal (non-legacy) alias defaults is_legacy to false', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias = insertPlan(db, { fingerprint: 'a|x|2' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    assert.equal(repository.isLegacy(alias), false);
  });
});

test('an alias cannot chain to another alias (schema constraint D)', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const middle = insertPlan(db, { fingerprint: 'a|x|2' });
    const outer = insertPlan(db, { fingerprint: 'a|x|3' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: middle, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    // outer -> middle would be a chain (middle is itself an alias).
    assert.throws(() => repository.create({ aliasPlanId: outer, canonicalPlanId: middle, groupKey: 'gencat-agenda|x|y2', reason: 'r' }, { now: NOW }), /chain/);
  });
});

test('a plan cannot become an alias if it is already a canonical target (schema constraint E, prevents cycles)', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias = insertPlan(db, { fingerprint: 'a|x|2' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    // canonical -> alias would make canonical (already someone's target) into an alias too: a cycle.
    assert.throws(() => repository.create({ aliasPlanId: canonical, canonicalPlanId: alias, groupKey: 'gencat-agenda|x|y2', reason: 'r' }, { now: NOW }), /cycle/);
  });
});

test('a two-hop chain attempted in a single row is rejected too (alias_plan_id already canonical elsewhere)', () => {
  withTestDatabase((db) => {
    const a = insertPlan(db, { fingerprint: 'a|x|1' });
    const b = insertPlan(db, { fingerprint: 'a|x|2' });
    const c = insertPlan(db, { fingerprint: 'a|x|3' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: b, canonicalPlanId: a, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    // c -> b is caught by the no-chain trigger (b.canonical_plan_id already exists as alias target)... actually b is
    // the alias here, so this tests the other direction: nothing may point AT b as a canonical target either,
    // since b is itself an alias.
    assert.throws(() => repository.create({ aliasPlanId: c, canonicalPlanId: b, groupKey: 'gencat-agenda|x|y3', reason: 'r' }, { now: NOW }), /chain/);
  });
});

test('PlanAliasRepository.findCanonicalId resolves an alias and returns null for a non-alias', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias = insertPlan(db, { fingerprint: 'a|x|2' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    assert.equal(repository.findCanonicalId(alias), canonical);
    assert.equal(repository.findCanonicalId(canonical), null);
    assert.equal(repository.findCanonicalId(999999), null);
  });
});

test('PlanAliasRepository.isAlias / isCanonical / listForCanonical reflect written rows', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias1 = insertPlan(db, { fingerprint: 'a|x|2' });
    const alias2 = insertPlan(db, { fingerprint: 'a|x|3' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: alias1, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    repository.create({ aliasPlanId: alias2, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'r' }, { now: NOW });
    assert.equal(repository.isAlias(alias1), true);
    assert.equal(repository.isAlias(canonical), false);
    assert.equal(repository.isCanonical(canonical), true);
    assert.equal(repository.isCanonical(alias1), false);
    assert.deepEqual(repository.listForCanonical(canonical), [alias1, alias2].sort((a, b) => a - b));
  });
});

test('an UPDATE cannot create a chain either, not just an INSERT (cross-review finding)', () => {
  withTestDatabase((db) => {
    const c = insertPlan(db, { fingerprint: 'a|x|1' });
    const a = insertPlan(db, { fingerprint: 'a|x|2' });
    const d = insertPlan(db, { fingerprint: 'a|x|3' });
    const b = insertPlan(db, { fingerprint: 'a|x|4' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: a, canonicalPlanId: c, groupKey: 'gencat-agenda|g1|v', reason: 'r' }, { now: NOW });
    repository.create({ aliasPlanId: b, canonicalPlanId: d, groupKey: 'gencat-agenda|g2|v', reason: 'r' }, { now: NOW });
    // Re-pointing A's canonical to B (itself an alias) would form a chain A -> B -> D.
    assert.throws(() => db.prepare('UPDATE plan_aliases SET canonical_plan_id = ? WHERE alias_plan_id = ?').run(b, a), /chain/);
  });
});

test('an UPDATE cannot create a cycle either, not just an INSERT (cross-review finding)', () => {
  withTestDatabase((db) => {
    const c = insertPlan(db, { fingerprint: 'a|x|1' }); // canonical for group 1
    const a = insertPlan(db, { fingerprint: 'a|x|2' }); // alias of c
    const f = insertPlan(db, { fingerprint: 'a|x|3' }); // canonical for group 2
    const e = insertPlan(db, { fingerprint: 'a|x|4' }); // alias of f
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: a, canonicalPlanId: c, groupKey: 'gencat-agenda|g1|v', reason: 'r' }, { now: NOW });
    repository.create({ aliasPlanId: e, canonicalPlanId: f, groupKey: 'gencat-agenda|g2|v', reason: 'r' }, { now: NOW });
    // Re-pointing the (e, f) row's alias_plan_id to c would make c — already a
    // canonical target for group 1 — simultaneously become an alias too: a cycle.
    assert.throws(() => db.prepare('UPDATE plan_aliases SET alias_plan_id = ? WHERE alias_plan_id = ?').run(c, e), /cycle/);
  });
});

test('a legitimate UPDATE that changes a row\'s own alias_plan_id and canonical_plan_id together is NOT rejected as a false-positive self-conflict (migration 014, cross-review finding)', () => {
  withTestDatabase((db) => {
    // Row 1 -> 3 exists. Re-pointing it to 3 -> 4 (i.e. plan 3 stops being an
    // alias and instead becomes the alias of a NEW canonical 4) is a single
    // UPDATE that changes both columns at once. Naive trigger WHEN clauses
    // that don't exclude the row being updated from their own conflict check
    // would see this row's OWN pre-update canonical_plan_id (3) and wrongly
    // conclude "3 is already used as a canonical elsewhere" — it isn't; that
    // was this exact row, which is being changed.
    const one = insertPlan(db, { fingerprint: 'a|x|1' });
    const three = insertPlan(db, { fingerprint: 'a|x|2' });
    const four = insertPlan(db, { fingerprint: 'a|x|3' });
    const repository = new PlanAliasRepository(db);
    repository.create({ aliasPlanId: one, canonicalPlanId: three, groupKey: 'gencat-agenda|g1|v', reason: 'r' }, { now: NOW });
    assert.doesNotThrow(() => db.prepare('UPDATE plan_aliases SET alias_plan_id = ?, canonical_plan_id = ? WHERE alias_plan_id = ?').run(three, four, one));
    assert.equal(repository.findCanonicalId(three), four);
  });
});

test('group_key and reason must be non-empty (schema constraint A)', () => {
  withTestDatabase((db) => {
    const canonical = insertPlan(db, { fingerprint: 'a|x|1' });
    const alias = insertPlan(db, { fingerprint: 'a|x|2' });
    const repository = new PlanAliasRepository(db);
    assert.throws(() => repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: '', reason: 'r' }, { now: NOW }), /CHECK/);
    assert.throws(() => repository.create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'k', reason: '' }, { now: NOW }), /CHECK/);
  });
});
