import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { buildSitemapXml } from '../backend/src/api/sitemap.routes.js';
import { withTestDatabase } from './helpers.js';

function insertPlan(db, { fingerprint, kind = 'event', status = 'active', quality = 80 }) {
  const now = '2026-08-19T10:00:00.000Z';
  const planId = Number(db.prepare(`
    INSERT INTO plans (
      kind, fingerprint, original_language, original_title, title_ca,
      start_date, end_date, permanent, province, municipality,
      quality_score, status, created_at, updated_at
    ) VALUES (?, ?, 'ca', ?, ?, '2026-08-20', '2026-08-20', 0, 'Barcelona', 'Barcelona', ?, ?, ?, ?)
  `).run(
    kind, fingerprint, fingerprint, fingerprint, quality, status,
    now, now,
  ).lastInsertRowid);
  db.prepare(`INSERT INTO plan_sources
    (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
    SELECT ?,id,?,'{}',?,? FROM sources WHERE key='gencat-agenda'`
  ).run(planId, `sitemap-${planId}`, now, now);
  return planId;
}

test('dynamic sitemap exposes only canonical public URLs without invented metadata', async () => {
  await withTestDatabase(async (db) => {
    const active = insertPlan(db, { fingerprint: 'active-event' });
    const inactive = insertPlan(db, { fingerprint: 'inactive-event', status: 'inactive' });
    const place = insertPlan(db, { fingerprint: 'active-place', kind: 'place' });
    insertPlan(db, { fingerprint: 'low-quality', quality: 10 });

    const app = createApp({
      db,
      now: () => new Date('2026-08-19T12:00:00.000Z'),
      logger: { error() {} },
    });
    const response = await request(app).get('/api/sitemap.xml');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/xml/);
    assert.match(response.text, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(response.text, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(response.text, /<loc>https:\/\/tenspla\.cat\/<\/loc>/);
    assert.match(response.text, /<loc>https:\/\/tenspla\.cat\/plans<\/loc>/);
    assert.match(response.text, /<loc>https:\/\/tenspla\.cat\/fonts<\/loc>/);
    assert.match(response.text, new RegExp(`<loc>https://tenspla\\.cat/plans/${active}</loc>`));
    assert.doesNotMatch(response.text, new RegExp(`/plans/${inactive}<`));
    assert.doesNotMatch(response.text, new RegExp(`/plans/${place}<`));
    assert.doesNotMatch(response.text, /<loc>[^<]*\?/);
    assert.doesNotMatch(response.text, /quefem\.jusboif\.es|www\.tenspla\.cat|<lastmod>|<priority>|<changefreq>/);
  });
});

test('sitemap XML builder escapes reserved characters', () => {
  const xml = buildSitemapXml(['https://tenspla.cat/plans/1?a=1&b=<two>']);
  assert.match(xml, /a=1&amp;b=&lt;two&gt;/);
});
