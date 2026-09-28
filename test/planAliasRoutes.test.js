import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { withTestDatabase } from './helpers.js';
import { PlanAliasRepository } from '../backend/src/db/repositories/planAlias.repository.js';

const template = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const NOW = '2026-08-19T10:00:00.000Z';

function insertPlan(db, { title = 'Gran Gala Flamenc', status = 'active' } = {}) {
  const planId = Number(db.prepare(`INSERT INTO plans (
    kind,fingerprint,original_language,original_title,title_ca,description_ca,start_date,end_date,permanent,
    province,municipality,address,venue_name,latitude,longitude,quality_score,status,created_at,updated_at
  ) VALUES ('event',?,'ca',?,?,?,'2026-08-20','2026-08-20',0,'Barcelona','Barcelona','Carrer Major, 1','Sala de prova',41.38,2.17,80,?,?,?)`).run(
    `alias-route-plan-${title}-${status}-${Math.random()}`, title, title, 'Descripció útil.', status, NOW, NOW,
  ).lastInsertRowid);
  db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
    SELECT ?,id,?,'{}',?,? FROM sources WHERE key='gencat-agenda'`).run(planId, `alias-route-${planId}-${Math.random()}`, NOW, NOW);
  return planId;
}

function createTestApp(db) {
  return createApp({ db, seoTemplate: template, fallbackImageLibrary: null, now: () => new Date('2026-08-19T12:00:00.000Z'), logger: { error() {} } });
}

test('HTML: an alias plan id redirects with a real HTTP 301 to the canonical id (never renders the old plan)', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const alias = insertPlan(db, { title: 'Gran Gala Flamenc — old fragment' });
    new PlanAliasRepository(db).create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'test' }, { now: NOW });

    const response = await request(createTestApp(db)).get(`/plans/${alias}`).redirects(0);
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, `/plans/${canonical}`);
    assert.doesNotMatch(response.text || '', /old fragment/);
  });
});

test('HTML: the canonical plan id still renders a normal 200', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const response = await request(createTestApp(db)).get(`/plans/${canonical}`);
    assert.equal(response.status, 200);
    assert.match(response.text, /Gran Gala Flamenc/);
    assert.match(response.text, new RegExp(`<link rel="canonical" href="https://tenspla\\.cat/plans/${canonical}"`));
  });
});

test('HTML: redirect preserves query string (e.g. utm tracking params) on the canonical URL', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db);
    const alias = insertPlan(db);
    new PlanAliasRepository(db).create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'test' }, { now: NOW });
    const response = await request(createTestApp(db)).get(`/plans/${alias}?utm_source=test`).redirects(0);
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, `/plans/${canonical}?utm_source=test`);
  });
});

test('HTML: a LEGACY alias id (no corresponding plans row at all) redirects with a real HTTP 301, same as a normal alias (Phase 4C.3A legacy-URL hardening)', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const legacyId = canonical + 500_000;
    assert.equal(db.prepare('SELECT 1 FROM plans WHERE id = ?').get(legacyId), undefined, 'the legacy id must genuinely have no plans row');
    new PlanAliasRepository(db).create({ aliasPlanId: legacyId, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'legacy test', isLegacy: true }, { now: NOW });

    const response = await request(createTestApp(db)).get(`/plans/${legacyId}`).redirects(0);
    assert.equal(response.status, 301);
    assert.equal(response.headers.location, `/plans/${canonical}`);
  });
});

test('API: a LEGACY alias id (no plans row) resolves transparently to the canonical plan\'s data with a 200 (Phase 4C.3A legacy-URL hardening)', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const legacyId = canonical + 500_000;
    new PlanAliasRepository(db).create({ aliasPlanId: legacyId, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'legacy test', isLegacy: true }, { now: NOW });

    const response = await request(createTestApp(db)).get(`/api/plans/${legacyId}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, canonical);
  });
});

test('API: an alias plan id transparently resolves to the canonical plan\'s data with a 200 (no redirect)', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const alias = insertPlan(db, { title: 'Gran Gala Flamenc — old fragment' });
    new PlanAliasRepository(db).create({ aliasPlanId: alias, canonicalPlanId: canonical, groupKey: 'gencat-agenda|x|y', reason: 'test' }, { now: NOW });

    const response = await request(createTestApp(db)).get(`/api/plans/${alias}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, canonical);
    assert.match(response.body.data.title, /Gran Gala Flamenc$/);
  });
});

test('API: the canonical plan id still returns its own data directly (no alias table involvement)', async () => {
  await withTestDatabase(async (db) => {
    const canonical = insertPlan(db, { title: 'Gran Gala Flamenc' });
    const response = await request(createTestApp(db)).get(`/api/plans/${canonical}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.id, canonical);
  });
});

test('a plan id that is neither canonical nor an alias behaves exactly as before (404 if missing/invisible, 200 if visible)', async () => {
  await withTestDatabase(async (db) => {
    const app = createTestApp(db);
    const missing = await request(app).get('/plans/999999');
    assert.equal(missing.status, 404);
    const visible = insertPlan(db);
    const ok = await request(app).get(`/plans/${visible}`);
    assert.equal(ok.status, 200);
  });
});
