import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AMBIGUITY_POLICY, DibaImporter, DIBA_FEEDS } from '../backend/src/diba/dibaImporter.js';
import { validateDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { DibaReviewDecisionRepository, withReviewPageOverrides } from '../backend/src/diba/reviewDecisions.js';
import { updateReviewQueue } from '../backend/src/diba/reviewQueue.js';
import { createReviewApp } from '../backend/src/review/reviewApp.js';
import { withTestDatabase } from './helpers.js';

const FEED = DIBA_FEEDS[0];
const NOW = '2026-08-31T10:00:00Z';
const TOKEN = 'test-token-0123456789abcdef';
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
function importer(db, records, reviewedOverrides = { version: 1, decisions: [] }) {
  return new DibaImporter({
    db, client: { fetchDataset: async () => ({ records }) }, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z'),
    reviewedOverrides, finalReviewDecisions: { version: 1, decisions: [] }, finalDeferredKeys: new Set(),
    ambiguityPolicy: AMBIGUITY_POLICY.REVIEW_QUEUE,
  });
}
function addGencatPlan(db) {
  const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,status,created_at,updated_at)
    VALUES ('event','gencat-possible','Concert de prova','2026-09-10','2026-09-10','Mataró','active',?,?)`).run(NOW, NOW).lastInsertRowid);
  const sourceId = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get().id;
  db.prepare(`INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
    VALUES (?,?,?,?, '{}',?,?)`).run(planId, sourceId, 'g-possible', null, NOW, NOW);
  return planId;
}
const owner = (db, recordId) => db.prepare('SELECT plan_id FROM plan_sources WHERE source_record_id=?').get(recordId).plan_id;

// Imports one possible duplicate, writes the real review queue and serves the review app on an ephemeral port.
async function withReviewServer(callback, { records = [raw('new-possible')], lock } = {}) {
  await withTestDatabase(async (db) => {
    db.prepare("UPDATE sources SET enabled=1 WHERE key LIKE 'diba-%'").run();
    const gencatPlanId = addGencatPlan(db);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-review-'));
    const queuePath = path.join(directory, 'diba-review-queue.json');
    const result = await importer(db, records).run({ feeds: [FEED] });
    updateReviewQueue(queuePath, result.datasets, new Date(NOW));
    const app = createReviewApp({
      db, databasePath: path.join(directory, 'db.sqlite'), queuePath, token: TOKEN, decidedBy: 'tester',
      now: () => new Date('2026-10-14T10:00:00Z'),
      lockFactory: lock ?? (() => ({ acquire: async () => true, release: async () => {} })),
    });
    const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const { port } = server.address();
    const request = ({ method = 'GET', url = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
      const outgoing = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `localhost:${port}`, ...headers } }, (response) => {
        let text = '';
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) }));
      });
      outgoing.on('error', reject);
      if (body !== undefined) outgoing.write(body);
      outgoing.end();
    });
    const post = (url, extra = {}) => request({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-review-token': TOKEN, ...extra.headers }, body: '{}' });
    try { await callback({ db, request, post, gencatPlanId, queuePath, directory }); }
    finally { await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
  });
}

test('the page refuses unknown hosts, foreign origins, missing tokens and non-JSON writes', async () => {
  await withReviewServer(async ({ request, post, db }) => {
    assert.equal((await request({ url: '/api/items', headers: { host: 'evil.example' } })).status, 403, 'DNS rebinding');
    assert.equal((await request({ url: '/api/items' })).status, 403, 'reads need the token as well');
    const items = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items;
    const url = `/api/items/${items[0].id}/keep-separate`;
    assert.equal((await request({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'no token');
    assert.equal((await request({ method: 'POST', url, headers: { 'content-type': 'application/json', 'x-review-token': 'wrong-token-0123456789' }, body: '{}' })).status, 403, 'wrong token');
    assert.equal((await post(url, { headers: { origin: 'https://evil.example' } })).status, 403, 'foreign origin');
    assert.equal((await post(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'cross-site fetch');
    assert.equal((await request({ method: 'POST', url, headers: { 'x-review-token': TOKEN, 'content-type': 'text/plain' }, body: '{}' })).status, 415, 'not json');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM diba_review_decisions').get().n, 0, 'nothing was written');
  });
});

test('the page is served with a strict CSP and the per-launch token', async () => {
  await withReviewServer(async ({ request }) => {
    assert.equal((await request({ url: '/' })).status, 403, 'no token in the URL');
    assert.equal((await request({ url: '/?t=wrong-token-0123456789abcdef' })).status, 403);
    const page = await request({ url: `/?t=${TOKEN}` });
    assert.equal(page.status, 200);
    assert.match(page.text, new RegExp(`name="review-token" content="${TOKEN}"`));
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal((await request({ url: '/app.js' })).status, 200);
    assert.doesNotMatch(page.text, /__REVIEW_TOKEN__/);
  });
});

test('GET /api/items describes each open case from live data and writes nothing', async () => {
  await withReviewServer(async ({ request, db, gencatPlanId }) => {
    const body = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json();
    assert.equal(body.items.length, 1);
    const [item] = body.items;
    assert.equal(item.kind, 'POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN');
    assert.equal(item.candidatePlans[0].id, gencatPlanId);
    assert.equal(item.records[0].plan.title, 'Concert de prova');
    assert.equal(item.actions.merge.available, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM diba_review_decisions').get().n, 0);
  });
});

test('"mantener separado" is stored, hides the case and the importer stops queueing it; undo brings it back', async () => {
  await withReviewServer(async ({ request, post, db }) => {
    const [item] = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items;
    const kept = await post(`/api/items/${item.id}/keep-separate`);
    assert.equal(kept.status, 200);
    assert.equal((await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items.length, 0);
    assert.equal((await post(`/api/items/${item.id}/keep-separate`)).status, 404, 'a decided case cannot be decided twice');

    const repository = new DibaReviewDecisionRepository(db);
    const overrides = withReviewPageOverrides({ version: 1, decisions: [] }, repository);
    assert.doesNotThrow(() => validateDibaPolicyOverrides(overrides), 'stored decisions are valid importer overrides');
    const after = (await importer(db, [raw('new-possible')], overrides).run({ feeds: [FEED] })).datasets[0];
    assert.equal(after.reviewQueue.length, 0, 'the importer honours the decision');

    assert.equal((await post(`/api/items/${item.id}/undo`)).status, 200);
    const again = (await importer(db, [raw('new-possible')], withReviewPageOverrides({ version: 1, decisions: [] }, repository)).run({ feeds: [FEED] })).datasets[0];
    assert.equal(again.reviewQueue.length, 1, 'undo puts the case back in the queue');
  });
});

test('"importar" merges the DIBA plan into the published plan, records the rollback and cannot be undone from the page', async () => {
  await withReviewServer(async ({ request, post, db, gencatPlanId }) => {
    const [item] = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items;
    const diba = owner(db, 'new-possible');
    const merged = await post(`/api/items/${item.id}/merge`);
    assert.equal(merged.status, 200, merged.text);
    assert.equal(owner(db, 'new-possible'), gencatPlanId);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(diba).status, 'inactive');
    assert.equal(db.prepare('SELECT canonical_plan_id c FROM plan_aliases WHERE alias_plan_id=?').get(diba).c, gencatPlanId);
    const row = db.prepare("SELECT * FROM diba_review_decisions WHERE decision='MERGED'").get();
    assert.equal(row.decided_by, 'tester');
    assert.match(row.rollback_sql, /DELETE FROM plan_aliases/);
    assert.equal((await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items.length, 0);
    assert.equal((await post(`/api/items/${item.id}/undo`)).status, 409, 'a merge has no undo button');
    // The merged record stays a MERGED row, which never feeds the importer overrides.
    assert.equal(new DibaReviewDecisionRepository(db).keepSeparateOverrides().length, 0);
  });
});

test('a merge is refused while an import holds the lock, and when the plans no longer match', async () => {
  await withReviewServer(async ({ request, post, db }) => {
    const [item] = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items;
    const locked = await post(`/api/items/${item.id}/merge`);
    assert.equal(locked.status, 409);
    assert.match(locked.json().error, /importación/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0);
  }, { lock: () => ({ acquire: async () => false, release: async () => {} }) });

  await withReviewServer(async ({ request, post, db }) => {
    const [item] = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items;
    db.prepare("UPDATE plans SET original_title = 'Un altre títol' WHERE id = ?").run(owner(db, 'new-possible'));
    const refused = await post(`/api/items/${item.id}/merge`);
    assert.equal(refused.status, 409);
    assert.ok(refused.json().problems.length > 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM diba_review_decisions').get().n, 0);
  });
});

test('same-day sessions of one production with different start times can be merged into a single plan', async () => {
  const later = { data_inici: '2026-09-10 21:00:00', data_fi: '2026-09-10 23:00:00' };
  const sessions = [raw('session-a', { data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 20:10:00' }), raw('session-b', later)];
  await withReviewServer(async ({ request, post, db }) => {
    const [item] = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json().items.filter(({ kind }) => kind === 'POSSIBLE_DUPLICATE_WITHIN_FEED');
    assert.equal(item.actions.merge.available, true);
    assert.deepEqual(item.records.map((record) => record.startsAt?.slice(11, 16)).sort(), ['19:00', '21:00'], 'the start times are shown to the reviewer');
    const [first, second] = [owner(db, 'session-a'), owner(db, 'session-b')];
    assert.notEqual(first, second);
    assert.equal((await post(`/api/items/${item.id}/merge`)).status, 200);
    assert.equal(owner(db, 'session-a'), owner(db, 'session-b'), 'both records now belong to one plan');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plan_aliases').get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plans WHERE status = 'active' AND id IN (?, ?)").get(first, second).n, 1, 'one card instead of two');
    const plansBefore = db.prepare('SELECT COUNT(*) n FROM plans').get().n;
    const again = (await importer(db, sessions).run({ feeds: [FEED] })).datasets[0];
    assert.equal(again.safety.status, 'approved');
    assert.equal(again.reviewQueue.filter(({ kind }) => kind === 'POSSIBLE_DUPLICATE_WITHIN_FEED').length, 0, 'a merged pair is not queued again');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM plans').get().n, plansBefore, 'the next import creates no plan');
    assert.equal(owner(db, 'session-a'), owner(db, 'session-b'));
  }, { records: sessions });
});

test('same-feed cases offer keep-separate for every member and expired decisions in an older queue file are ignored', async () => {
  await withReviewServer(async ({ request, post, db, queuePath }) => {
    const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const within = queue.items.find(({ kind }) => kind === 'POSSIBLE_DUPLICATE_WITHIN_FEED');
    assert.ok(within, 'the two near-identical DIBA records are queued');
    assert.equal(within.records.length, 2);
    const stale = { id: 'stale0000000001', kind: 'STALE_REVIEW_DECISION', sourceKey: FEED.sourceKey, records: [{ sourceRecordId: 'x' }], staleTarget: { sourceKey: 'gencat-agenda', sourceRecordId: 'gone' } };
    fs.writeFileSync(queuePath, JSON.stringify({ ...queue, items: [...queue.items, stale] }));
    const body = (await request({ url: '/api/items', headers: { 'x-review-token': TOKEN } })).json();
    assert.equal(body.stale, undefined, 'the page has no stale section');
    assert.ok(!body.items.some(({ id }) => id === 'stale0000000001'), 'an expired decision is not listed');
    assert.equal((await post('/api/items/stale0000000001/keep-separate')).status, 404, 'stale items are not actionable');
    const item = body.items.find(({ id }) => id === within.id);
    assert.equal((await post(`/api/items/${within.id}/keep-separate`)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM diba_review_decisions WHERE item_id=?').get(within.id).n, item.records.length);
  }, { records: [raw('same-a'), raw('same-b')] });
});
