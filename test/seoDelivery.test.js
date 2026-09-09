import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { withTestDatabase } from './helpers.js';

const template = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');

function insertPlan(db, {
  kind = 'event', status = 'active', sourceEnabled = true,
  startDate = '2026-08-20', endDate = '2026-08-20', title = 'Concert de prova', description = 'Descripció útil del concert de prova.',
} = {}) {
  const now = '2026-08-19T10:00:00.000Z';
  const planId = Number(db.prepare(`INSERT INTO plans (
    kind,fingerprint,original_language,original_title,title_ca,description_ca,start_date,end_date,permanent,
    province,municipality,address,venue_name,latitude,longitude,quality_score,status,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?, ?,0,'Barcelona','Barcelona','Carrer Major, 1','Sala de prova',41.38,2.17,80,?,?,?)`).run(
    kind, `seo-plan-${kind}-${status}-${sourceEnabled}-${title}`, 'ca', title, title, description, startDate, endDate, status, now, now,
  ).lastInsertRowid);
  db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
    SELECT ?,id,?,'{}',?,? FROM sources WHERE key='gencat-agenda'`).run(planId, `seo-${planId}`, now, now);
  if (!sourceEnabled) db.prepare("UPDATE sources SET enabled=0 WHERE key='gencat-agenda'").run();
  return planId;
}

function createSeoApp(db) {
  return createApp({
    db, seoTemplate: template, fallbackImageLibrary: null,
    now: () => new Date('2026-08-19T12:00:00.000Z'), logger: { error() {} },
  });
}

test('SEO shell delivers an indexable public plan before JavaScript executes', async () => {
  await withTestDatabase(async (db) => {
    const id = insertPlan(db);
    const response = await request(createSeoApp(db)).get(`/plans/${id}?utm_source=test`);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.text, /<title>Concert de prova a Barcelona \| Tens pla\?<\/title>/);
    assert.match(response.text, /name="description" content="Descripció útil del concert de prova\."/);
    assert.match(response.text, /name="robots" content="index,follow"/);
    assert.match(response.text, new RegExp(`<link rel="canonical" href="https://tenspla\\.cat/plans/${id}"`));
    assert.doesNotMatch(response.text, /plans\/\d+\?utm_source/);
    assert.match(response.text, /property="og:title" content="Concert de prova a Barcelona \| Tens pla\?"/);
    const jsonLd = JSON.parse(response.text.match(/<script type="application\/ld\+json" data-tenspla-jsonld>(.*?)<\/script>/)[1]);
    assert.equal(jsonLd['@type'], 'Event');
    assert.equal(jsonLd.url, `https://tenspla.cat/plans/${id}`);
    assert.equal(jsonLd.location.name, 'Sala de prova');
    assert.match(response.text, /<div id="root"><\/div>/);
  });
});

test('SEO shell returns deterministic noindex 404 for invisible or missing plans', async () => {
  await withTestDatabase(async (db) => {
    const inactive = insertPlan(db, { status: 'inactive' });
    const expired = insertPlan(db, { startDate: '2026-08-18', endDate: '2026-08-18' });
    const app = createSeoApp(db);
    for (const path of [`/plans/${inactive}`, `/plans/${expired}`, '/plans/999999', '/plans/not-an-id']) {
      const response = await request(app).get(path);
      assert.equal(response.status, 404);
      assert.match(response.text, /name="robots" content="noindex,follow"/);
      assert.doesNotMatch(response.text, /Concert de prova/);
    }
    const disabledSource = insertPlan(db, { sourceEnabled: false });
    const disabledResponse = await request(app).get(`/plans/${disabledSource}`);
    const disabledApiResponse = await request(app).get(`/api/plans/${disabledSource}`);
    assert.equal(disabledResponse.status, 404);
    assert.match(disabledResponse.text, /name="robots" content="noindex,follow"/);
    assert.equal(disabledApiResponse.status, 404);
  });
});

test('SEO shell preserves public non-events while keeping them out of the event index', async () => {
  await withTestDatabase(async (db) => {
    const id = insertPlan(db, { kind: 'place', title: 'Espai de prova' });
    const app = createSeoApp(db);
    const seo = await request(app).get(`/plans/${id}`);
    const api = await request(app).get(`/api/plans/${id}`);
    assert.equal(seo.status, 200);
    assert.equal(api.status, 200);
    assert.match(seo.text, /<title>Espai de prova a Barcelona \| Tens pla\?<\/title>/);
    assert.match(seo.text, /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(seo.text, /rel="canonical"/);
    assert.doesNotMatch(seo.text, /data-tenspla-jsonld/);
    assert.match(seo.text, /<div id="root"><\/div>/);
  });
});

test('SEO shell gives the unfiltered plans listing deterministic indexable metadata', async () => {
  await withTestDatabase(async (db) => {
    const response = await request(createSeoApp(db)).get('/plans');
    assert.equal(response.status, 200);
    assert.match(response.text, /<title>Explora plans a Catalunya \| Tens pla\?<\/title>/);
    assert.match(response.text, /name="description" content="Explora concerts, festes, cultura, mercats i activitats disponibles arreu de Catalunya amb Tens pla\?\."/);
    assert.match(response.text, /name="robots" content="index,follow"/);
    assert.match(response.text, /<link rel="canonical" href="https:\/\/tenspla\.cat\/plans" \/>/);
    assert.equal((response.text.match(/name="robots"/g) ?? []).length, 1);
    assert.equal((response.text.match(/rel="canonical"/g) ?? []).length, 1);
  });
});

test('SEO shell makes home query variants deterministically non-indexable', async () => {
  await withTestDatabase(async (db) => {
    const response = await request(createSeoApp(db)).get('/?some=query');
    assert.equal(response.status, 200);
    assert.match(response.text, /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(response.text, /rel="canonical"/);
    assert.doesNotMatch(response.text, /https:\/\/tenspla\.cat\/\?some=query/);
    assert.doesNotMatch(response.text, /name="robots" content="index,follow"/);
  });
});

test('SEO shell escapes hostile metadata and JSON-LD values without executable markup', async () => {
  await withTestDatabase(async (db) => {
    const title = '</script><script>window.pwned=1</script> " & < >';
    const description = '</script><script>window.pwned=2</script> " & < > useful';
    const id = insertPlan(db, { title, description });
    const response = await request(createSeoApp(db)).get(`/plans/${id}`);
    assert.equal(response.status, 200);
    assert.match(response.text, /&lt;\/script&gt;&lt;script&gt;window\.pwned=1&lt;\/script&gt; &quot; &amp; &lt; &gt;/);
    assert.doesNotMatch(response.text, /<script>window\.pwned=/);
    const jsonText = response.text.match(/<script type="application\/ld\+json" data-tenspla-jsonld>(.*?)<\/script>/)[1];
    assert.doesNotMatch(jsonText, /<\/script>/i);
    assert.match(jsonText, /\\u003c\/script\\u003e/);
    assert.equal(JSON.parse(jsonText).name, title);
  });
});

test('SEO shell marks arbitrary plan queries noindex and keeps home metadata deterministic', async () => {
  await withTestDatabase(async (db) => {
    const app = createSeoApp(db);
    const filtered = await request(app).get('/plans?date=2026-08-20&page=2');
    assert.equal(filtered.status, 200);
    assert.match(filtered.text, /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(filtered.text, /rel="canonical"/);
    const home = await request(app).get('/');
    assert.equal(home.status, 200);
    assert.match(home.text, /<title>Tens pla\? \| Plans i activitats a Catalunya<\/title>/);
    assert.match(home.text, /name="robots" content="index,follow"/);
    assert.match(home.text, /rel="canonical" href="https:\/\/tenspla\.cat\/"/);
    const api = await request(app).get('/api/plans');
    assert.equal(api.status, 200);
  });
});
