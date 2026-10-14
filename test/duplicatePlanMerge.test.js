import assert from 'node:assert/strict';
import test from 'node:test';
import { AMBIGUITY_POLICY, DibaImporter, DIBA_FEEDS } from '../backend/src/diba/dibaImporter.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';
import {
  applyMerge, computeMergePlan, loadDuplicateMergeDecisions, rollbackStatements,
} from '../backend/src/deduplication/duplicatePlanMerge.js';
import { withTestDatabase } from './helpers.js';

const FEED = DIBA_FEEDS[0];
const NOW = '2026-08-31T10:00:00Z';
const MUNICIPALITIES = new Map([['08121', {
  municipality: 'Mataró', comarca: 'Maresme', province: 'Barcelona',
  municipalityCode: '080121', comarcaCode: '21', provinceCode: '08',
}]]);

function enableDiba(db) { db.prepare("UPDATE sources SET enabled=1 WHERE key LIKE 'diba-%'").run(); }
function addPlan(db, { fingerprint, title = 'Concert de prova', municipality = 'Mataró', startDate = '2026-09-10', endDate = '2026-09-10', status = 'active', sourceKey, sourceRecordId }) {
  const planId = Number(db.prepare(`INSERT INTO plans
    (kind,fingerprint,original_title,start_date,end_date,municipality,status,created_at,updated_at)
    VALUES ('event',?,?,?,?,?,?,?,?)`).run(fingerprint, title, startDate, endDate, municipality, status, NOW, NOW).lastInsertRowid);
  attach(db, planId, sourceKey, sourceRecordId);
  return planId;
}
function attach(db, planId, sourceKey, sourceRecordId) {
  const sourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey).id;
  return Number(db.prepare(`INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
    VALUES (?,?,?,?, '{}',?,?)`).run(planId, sourceId, sourceRecordId, null, NOW, NOW).lastInsertRowid);
}
function decision(aliasPlanId, canonicalPlanId, overrides = {}) {
  return {
    aliasPlanId, canonicalPlanId, title: 'Concert de prova', decision: 'MERGE',
    reason: 'Same title, dates and municipality', reviewedAt: '2026-10-14', reviewer: 'project-owner', ...overrides,
  };
}
function pair(db, { dibaOverrides = {}, gencatOverrides = {} } = {}) {
  enableDiba(db);
  const canonicalPlanId = addPlan(db, { fingerprint: 'gencat-plan', sourceKey: 'gencat-agenda', sourceRecordId: 'g-1', ...gencatOverrides });
  const aliasPlanId = addPlan(db, { fingerprint: 'diba-plan', sourceKey: FEED.sourceKey, sourceRecordId: 'd-1', ...dibaOverrides });
  return { canonicalPlanId, aliasPlanId };
}
function raw(id) {
  return {
    acte_id: String(id), titol: 'Concert de prova', descripcio: 'Text',
    data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 21:00:00', observacions_horari: '19 h',
    rel_municipis: { ine: '08121', municipi_nom: 'Mataró' },
    grup_adreca: { adreca_nom: 'Teatre', adreca: 'Carrer Major 1', localitzacio: '41.54,2.44' },
    acte_url: 'https://diba.example/event',
  };
}
function importer(db, records) {
  return new DibaImporter({
    db, client: { fetchDataset: async () => ({ records }) }, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z'),
    reviewedOverrides: { version: 1, decisions: [] }, finalReviewDecisions: { version: 1, decisions: [] }, finalDeferredKeys: new Set(),
    ambiguityPolicy: AMBIGUITY_POLICY.REVIEW_QUEUE,
  });
}
const planRow = (db, id) => db.prepare('SELECT id,status,permanent,inactive_at,updated_at FROM plans WHERE id=?').get(id);
const owner = (db, sourceRecordId) => db.prepare('SELECT plan_id FROM plan_sources WHERE source_record_id=?').get(sourceRecordId).plan_id;

test('merge moves DIBA provenance to the Gencat plan, keeps the old id as a 301 alias and merges categories', () => {
  withTestDatabase((db) => {
    const { canonicalPlanId, aliasPlanId } = pair(db);
    const [first, second] = db.prepare('SELECT id FROM categories ORDER BY id LIMIT 2').all();
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(canonicalPlanId, first.id);
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(aliasPlanId, first.id);
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(aliasPlanId, second.id);
    const precheck = computeMergePlan(db, decision(aliasPlanId, canonicalPlanId));
    assert.equal(precheck.ok, true, precheck.problems.join(' | '));
    assert.deepEqual(precheck.newCategoryIds, [second.id]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0, 'the dry-run computation writes nothing');

    applyMerge(db, precheck);
    assert.equal(owner(db, 'd-1'), canonicalPlanId);
    assert.equal(owner(db, 'g-1'), canonicalPlanId);
    assert.equal(planRow(db, canonicalPlanId).status, 'active');
    const alias = planRow(db, aliasPlanId);
    assert.equal(alias.status, 'inactive');
    assert.equal(alias.permanent, 1);
    assert.ok(alias.inactive_at);
    assert.equal(new PlanAliasRepository(db).findCanonicalId(aliasPlanId), canonicalPlanId);
    assert.deepEqual(db.prepare('SELECT category_id FROM plan_categories WHERE plan_id=? ORDER BY category_id').all(canonicalPlanId).map((row) => row.category_id), [first.id, second.id].sort((a, b) => a - b));
    assert.equal(db.pragma('foreign_key_check').length, 0);
  });
});

test('the generated rollback restores the exact previous state', () => {
  withTestDatabase((db) => {
    const { canonicalPlanId, aliasPlanId } = pair(db);
    const category = db.prepare('SELECT id FROM categories ORDER BY id LIMIT 1').get().id;
    db.prepare('INSERT INTO plan_categories (plan_id, category_id) VALUES (?, ?)').run(aliasPlanId, category);
    const before = { alias: planRow(db, aliasPlanId), canonical: planRow(db, canonicalPlanId), owner: owner(db, 'd-1') };
    const done = applyMerge(db, computeMergePlan(db, decision(aliasPlanId, canonicalPlanId)));
    db.exec(`BEGIN; ${rollbackStatements(done).join('\n')} COMMIT;`);
    assert.deepEqual(planRow(db, aliasPlanId), before.alias);
    assert.deepEqual(planRow(db, canonicalPlanId), before.canonical);
    assert.equal(owner(db, 'd-1'), before.owner);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_categories WHERE plan_id=?').get(canonicalPlanId).n, 0);
  });
});

test('merge refuses pairs that are not provably the same event or not safe to absorb', () => {
  const cases = [
    ['different title', { dibaOverrides: { title: 'Un altre concert' } }, /title/],
    ['different dates', { dibaOverrides: { startDate: '2026-09-11', endDate: '2026-09-11' } }, /dates differ/],
    ['different municipality', { dibaOverrides: { municipality: 'Barcelona' } }, /municipality differs/],
    ['alias plan already inactive', { dibaOverrides: { status: 'inactive' } }, /not active/],
  ];
  for (const [label, options, pattern] of cases) {
    withTestDatabase((db) => {
      const { canonicalPlanId, aliasPlanId } = pair(db, options);
      const plan = computeMergePlan(db, decision(aliasPlanId, canonicalPlanId));
      assert.equal(plan.ok, false, label);
      assert.match(plan.problems.join(' | '), pattern, label);
      assert.throws(() => applyMerge(db, plan), /Invariant failed/);
      assert.equal(owner(db, 'd-1'), aliasPlanId, `${label}: nothing was written`);
    });
  }
});

test('merge never absorbs a plan with non-DIBA provenance, occurrences or existing alias links', () => {
  withTestDatabase((db) => {
    const { canonicalPlanId, aliasPlanId } = pair(db);
    attach(db, aliasPlanId, 'gencat-agenda', 'g-extra');
    assert.match(computeMergePlan(db, decision(aliasPlanId, canonicalPlanId)).problems.join(' | '), /non-DIBA provenance/);
  });
  withTestDatabase((db) => {
    const { canonicalPlanId, aliasPlanId } = pair(db);
    const planSourceId = db.prepare('SELECT id FROM plan_sources WHERE source_record_id=?').get('d-1').id;
    db.prepare(`INSERT INTO plan_occurrences (plan_source_id, occurrence_key, local_date, timezone, status, last_seen_at, created_at, updated_at)
      VALUES (?, 'k', '2026-09-10', 'Europe/Madrid', 'active', ?, ?, ?)`).run(planSourceId, NOW, NOW, NOW);
    assert.match(computeMergePlan(db, decision(aliasPlanId, canonicalPlanId)).problems.join(' | '), /occurrence/);
  });
  withTestDatabase((db) => {
    const { canonicalPlanId, aliasPlanId } = pair(db);
    const otherCanonical = addPlan(db, { fingerprint: 'other', title: 'Altre', sourceKey: 'gencat-agenda', sourceRecordId: 'g-other' });
    new PlanAliasRepository(db).create({ aliasPlanId: canonicalPlanId, canonicalPlanId: otherCanonical, groupKey: 'x', reason: 'x' });
    assert.match(computeMergePlan(db, decision(aliasPlanId, canonicalPlanId)).problems.join(' | '), /is itself an alias/);
  });
  withTestDatabase((db) => {
    enableDiba(db);
    const first = addPlan(db, { fingerprint: 'a', sourceKey: FEED.sourceKey, sourceRecordId: 'd-a' });
    const second = addPlan(db, { fingerprint: 'b', sourceKey: FEED.sourceKey, sourceRecordId: 'd-b' });
    assert.match(computeMergePlan(db, decision(first, second)).problems.join(' | '), /no enabled gencat-agenda provenance/);
  });
});

test('after a merge a repeated DIBA import keeps the record on the Gencat plan and queues nothing', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const canonicalPlanId = addPlan(db, { fingerprint: 'gencat-possible', sourceKey: 'gencat-agenda', sourceRecordId: 'g-possible' });
    const first = (await importer(db, [raw('new-possible')]).run({ feeds: [FEED] })).datasets[0];
    assert.equal(first.reviewQueue.length, 1);
    const aliasPlanId = owner(db, 'new-possible');
    assert.notEqual(aliasPlanId, canonicalPlanId);
    applyMerge(db, computeMergePlan(db, decision(aliasPlanId, canonicalPlanId)));
    const plansBefore = db.prepare('SELECT COUNT(*) n FROM plans').get().n;
    const second = (await importer(db, [raw('new-possible')]).run({ feeds: [FEED] })).datasets[0];
    assert.equal(second.safety.status, 'approved');
    assert.equal(second.reviewQueue.length, 0, 'the merged pair is no longer an open duplicate');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plans').get().n, plansBefore, 'no plan is recreated');
    assert.equal(owner(db, 'new-possible'), canonicalPlanId);
    assert.equal(planRow(db, aliasPlanId).status, 'inactive');
    assert.equal(planRow(db, canonicalPlanId).status, 'active');
  });
});

test('the committed merge decisions are well formed', () => {
  const { decisions } = loadDuplicateMergeDecisions();
  assert.ok(decisions.length > 0);
  assert.equal(new Set(decisions.map((entry) => entry.aliasPlanId)).size, decisions.length);
  assert.ok(decisions.every((entry) => entry.reviewer === 'project-owner' && entry.aliasPlanId !== entry.canonicalPlanId));
});
