import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AMBIGUITY_POLICY, DibaImporter, DIBA_FEEDS } from '../backend/src/diba/dibaImporter.js';
import { reviewQueuePath, updateReviewQueue } from '../backend/src/diba/reviewQueue.js';
import { withTestDatabase } from './helpers.js';

const FEED = DIBA_FEEDS[0];
const NOW = '2026-08-31T10:00:00Z';
const MUNICIPALITIES = new Map([['08121', {
  municipality: 'Mataró', comarca: 'Maresme', province: 'Barcelona',
  municipalityCode: '080121', comarcaCode: '21', provinceCode: '08',
}]]);

function raw(id, overrides = {}) {
  return {
    acte_id: String(id), titol: 'Concert de prova', descripcio: 'Text',
    data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 21:00:00', observacions_horari: '19 h',
    rel_municipis: { ine: '08121', municipi_nom: 'Mataró' },
    grup_adreca: { adreca_nom: 'Teatre', adreca: 'Carrer Major 1', localitzacio: '41.54,2.44' },
    acte_url: 'https://diba.example/event', ...overrides,
  };
}
function importer(db, records, options = {}) {
  return new DibaImporter({
    db, client: { fetchDataset: async () => ({ records }) }, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z'),
    reviewedOverrides: { version: 1, decisions: [] }, finalReviewDecisions: { version: 1, decisions: [] }, finalDeferredKeys: new Set(),
    ambiguityPolicy: AMBIGUITY_POLICY.REVIEW_QUEUE, ...options,
  });
}
function enableDiba(db) { db.prepare("UPDATE sources SET enabled=1 WHERE key LIKE 'diba-%'").run(); }
function addPlan(db, { fingerprint, title = 'Concert de prova', municipality = 'Mataró', venue = null, address = null, sourceKey = 'gencat-agenda', sourceRecordId }) {
  const planId = Number(db.prepare(`INSERT INTO plans
    (kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,address,status,created_at,updated_at)
    VALUES ('event',?,?,'2026-09-10','2026-09-10',?,?,?,'active',?,?)`)
    .run(fingerprint, title, municipality, venue, address, NOW, NOW).lastInsertRowid);
  const sourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey).id;
  db.prepare(`INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
    VALUES (?,?,?,?, '{}',?,?)`).run(planId, sourceId, sourceRecordId, null, NOW, NOW);
  return planId;
}
function sourcePlan(db, sourceKey, sourceRecordId) {
  return db.prepare(`SELECT ps.plan_id AS planId,p.status FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
    JOIN plans p ON p.id=ps.plan_id WHERE s.key=? AND ps.source_record_id=?`).get(sourceKey, sourceRecordId);
}
function planCount(db) { return db.prepare('SELECT COUNT(*) count FROM plans').get().count; }

test('review-queue policy imports a possible duplicate of a published plan as a separate plan and queues it', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const gencatPlanId = addPlan(db, { fingerprint: 'gencat-possible', sourceRecordId: 'g-possible' });
    const before = planCount(db);
    const result = await importer(db, [raw('new-possible')]).run({ feeds: [FEED] });
    const summary = result.datasets[0];
    assert.equal(summary.safety.status, 'approved');
    assert.equal(summary.safety.policy, 'review-queue');
    assert.equal(summary.safety.reviewQueued, 1);
    assert.equal(summary.catalogCommitted, true);
    const imported = sourcePlan(db, FEED.sourceKey, 'new-possible');
    assert.ok(imported, 'the DIBA record is imported instead of stalling the feed');
    assert.notEqual(imported.planId, gencatPlanId, 'a possible duplicate is never silently merged');
    assert.equal(planCount(db), before + 1);
    assert.equal(summary.reviewQueue.length, 1);
    const [item] = summary.reviewQueue;
    assert.equal(item.kind, 'POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN');
    assert.equal(item.defaultAction, 'IMPORTED_AS_SEPARATE_PLAN');
    assert.deepEqual(item.records.map(({ sourceRecordId }) => sourceRecordId), ['new-possible']);
    assert.equal(item.records[0].title, 'Concert de prova');
    assert.equal(item.candidatePlans[0].planId, gencatPlanId);
    assert.deepEqual(item.candidatePlans[0].sources, ['gencat-agenda']);
  });
});

test('review-queue policy imports an unresolved same-feed pair instead of blocking the feed', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const result = await importer(db, [raw('same-a'), raw('same-b'), raw('unrelated', { titol: 'Una altra cosa', acte_url: 'https://diba.example/other' })]).run({ feeds: [FEED] });
    const summary = result.datasets[0];
    assert.equal(summary.safety.status, 'approved');
    assert.ok(sourcePlan(db, FEED.sourceKey, 'same-a'));
    assert.ok(sourcePlan(db, FEED.sourceKey, 'same-b'));
    assert.ok(sourcePlan(db, FEED.sourceKey, 'unrelated'), 'unrelated records keep flowing');
    assert.equal(summary.reviewQueue.length, 1);
    assert.equal(summary.reviewQueue[0].kind, 'POSSIBLE_DUPLICATE_WITHIN_FEED');
    assert.deepEqual(summary.reviewQueue[0].records.map(({ sourceRecordId }) => sourceRecordId), ['same-a', 'same-b']);
  });
});

test('review-queue ids are stable across runs and a repeated import creates nothing new', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    addPlan(db, { fingerprint: 'gencat-possible', sourceRecordId: 'g-possible' });
    const first = (await importer(db, [raw('new-possible')]).run({ feeds: [FEED] })).datasets[0];
    const afterFirst = planCount(db);
    const second = (await importer(db, [raw('new-possible')]).run({ feeds: [FEED] })).datasets[0];
    assert.equal(planCount(db), afterFirst);
    assert.equal(second.safety.status, 'approved');
    assert.equal(second.reviewQueue.length, 1);
    assert.equal(second.reviewQueue[0].id, first.reviewQueue[0].id);
  });
});

test('the default block policy is unchanged and still rejects the same possible duplicate', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    addPlan(db, { fingerprint: 'gencat-possible', sourceRecordId: 'g-possible' });
    const before = planCount(db);
    await assert.rejects(importer(db, [raw('new-possible')], { ambiguityPolicy: AMBIGUITY_POLICY.BLOCK }).run({ feeds: [FEED] }), /recurring safety guard/);
    assert.equal(planCount(db), before);
    assert.throws(() => importer(db, [], { ambiguityPolicy: 'ignore' }), /Unsupported DIBA ambiguity policy/);
  });
});

test('a human decision whose target no longer exists is queued as stale instead of blocking', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const decision = {
      source: { sourceKey: FEED.sourceKey, sourceRecordId: 'stale-link' }, decision: 'LINK_TO_EXISTING',
      target: { sourceKey: 'gencat-agenda', sourceRecordId: 'purged-event' }, reason: 'reviewed', reviewedAt: '2026-09-07', reviewer: 'human-review',
    };
    const options = { reviewedOverrides: { version: 1, decisions: [decision] } };
    await assert.rejects(importer(db, [raw('stale-link')], { ...options, ambiguityPolicy: AMBIGUITY_POLICY.BLOCK }).run({ feeds: [FEED] }), /recurring safety guard/);
    const summary = (await importer(db, [raw('stale-link')], options).run({ feeds: [FEED] })).datasets[0];
    assert.equal(summary.safety.status, 'approved');
    assert.ok(sourcePlan(db, FEED.sourceKey, 'stale-link'));
    assert.equal(summary.reviewQueue[0].kind, 'STALE_REVIEW_DECISION');
    assert.equal(summary.reviewQueue[0].defaultAction, 'STALE_DECISION_IGNORED');
    assert.equal(summary.reviewQueue[0].staleTarget.sourceRecordId, 'purged-event');
  });
});

test('conflicts around an existing human decision still block under the review-queue policy', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    addPlan(db, { fingerprint: 'gencat-target', title: 'Concert de prova', venue: 'Teatre', address: 'Carrer Major 1', sourceRecordId: 'g-target' });
    addPlan(db, { fingerprint: 'gencat-other', sourceRecordId: 'g-other' });
    const decision = {
      source: { sourceKey: FEED.sourceKey, sourceRecordId: 'reviewed-conflict' }, decision: 'LINK_TO_EXISTING',
      target: { sourceKey: 'gencat-agenda', sourceRecordId: 'g-target' }, reason: 'reviewed', reviewedAt: '2026-09-07', reviewer: 'human-review',
    };
    const before = planCount(db);
    let failure;
    await assert.rejects(importer(db, [raw('reviewed-conflict')], { reviewedOverrides: { version: 1, decisions: [decision] } }).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    assert.equal(planCount(db), before);
    assert.ok(failure.results[0].safety.blockers.some(({ code }) => code === 'REVIEWED_COMPONENT_TOPOLOGY_CHANGED'));
  });
});

test('updateReviewQueue keeps firstSeenAt, drops resolved items and preserves feeds that were not refreshed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-diba-queue-'));
  try {
    const file = reviewQueuePath(path.join(directory, 'quefem.sqlite'));
    const item = (id, sourceKey, kind = 'POSSIBLE_DUPLICATE_WITHIN_FEED') => ({ id, sourceKey, kind, records: [], candidatePlans: [] });
    updateReviewQueue(file, [
      { sourceKey: 'diba-tourisme', reviewQueue: [item('a', 'diba-tourisme'), item('b', 'diba-tourisme')] },
      { sourceKey: 'diba-escenari', reviewQueue: [item('c', 'diba-escenari', 'STALE_REVIEW_DECISION')] },
    ], new Date('2026-10-14T05:45:00Z'));
    const second = updateReviewQueue(file, [
      { sourceKey: 'diba-tourisme', reviewQueue: [item('a', 'diba-tourisme')] },
      { sourceKey: 'diba-escenari', failed: true, reviewQueue: [item('zzz', 'diba-escenari')] },
      { sourceKey: 'diba-museus' },
    ], new Date('2026-10-15T05:45:00Z'));
    assert.deepEqual(second.items.map(({ id }) => id), ['c', 'a'], 'sorted by source key, then id');
    const a = second.items.find(({ id }) => id === 'a');
    assert.equal(a.firstSeenAt, '2026-10-14T05:45:00.000Z');
    assert.equal(a.lastSeenAt, '2026-10-15T05:45:00.000Z');
    assert.ok(!second.items.some(({ id }) => id === 'b'), 'a resolved item leaves the queue');
    assert.ok(second.items.some(({ id }) => id === 'c'), 'a failed feed keeps its previous backlog');
    assert.ok(!second.items.some(({ id }) => id === 'zzz'), 'a failed feed does not publish a half-computed queue');
    assert.deepEqual(second.counts, { POSSIBLE_DUPLICATE_WITHIN_FEED: 1, STALE_REVIEW_DECISION: 1 });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).total, 2);
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
