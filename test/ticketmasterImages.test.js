import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { parseImageSyncArguments, syncTicketmasterImages } from '../backend/src/jobs/syncTicketmasterImages.js';
import { TicketmasterImageClient } from '../backend/src/ticketmaster/imageClient.js';
import { TicketmasterImageSyncLock } from '../backend/src/ticketmaster/imageSyncLock.js';
import { selectTicketmasterImage, selectTicketmasterImages } from '../backend/src/ticketmaster/imageSelector.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const API_KEY = 'secret-key-that-must-not-leak';

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function image(overrides = {}) {
  return {
    url: 'https://s1.ticketm.net/card.jpg', ratio: '16_9', width: 640, height: 360,
    fallback: false, ...overrides,
  };
}

function insertPlan(db, fingerprint) {
  const now = NOW.toISOString();
  return Number(db.prepare(`INSERT INTO plans (
    kind, fingerprint, original_title, title_ca, start_date, end_date, permanent,
    image_reuse_allowed, featured, quality_score, status, created_at, updated_at
  ) VALUES ('event', ?, ?, ?, '2026-09-01', '2026-09-01', 0, 0, 0, 70, 'active', ?, ?)
  `).run(fingerprint, fingerprint, fingerprint, now, now).lastInsertRowid);
}

function insertSource(db, planId, sourceKey, recordId) {
  const source = db.prepare('SELECT id FROM sources WHERE key = ?').get(sourceKey);
  const now = NOW.toISOString();
  return Number(db.prepare(`INSERT INTO plan_sources (
    plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
  ) VALUES (?, ?, ?, '{}', ?, ?)`)
    .run(planId, source.id, recordId, now, now).lastInsertRowid);
}

function insertImage(db, planSourceId, role, url, width, height, attribution = null) {
  const now = NOW.toISOString();
  db.prepare(`INSERT INTO plan_source_images (
    plan_source_id, role, url, ratio, width, height, is_fallback,
    attribution, last_seen_at, created_at, updated_at
  ) VALUES (?, ?, ?, '16_9', ?, ?, 0, ?, ?, ?, ?)`)
    .run(planSourceId, role, url, width, height, attribution, now, now, now);
}

test('selects safe 16:9 non-fallback images and role-appropriate sizes', () => {
  const images = [
    image({ url: 'http://invalid.test/insecure.jpg' }),
    image({ url: 'https://s1.ticketm.net/fallback.jpg', fallback: true }),
    image({ url: 'https://s1.ticketm.net/other-ratio.jpg', ratio: '3_2', fallback: false }),
    image(),
    image({ url: 'https://s1.ticketm.net/detail.jpg', width: 1136, height: 639, attribution: 'Literal credit' }),
    image({ url: 'https://s1.ticketm.net/huge.jpg', width: 5000, height: 2813 }),
  ];
  const selected = selectTicketmasterImages(images);
  assert.equal(selected.card.url, 'https://s1.ticketm.net/card.jpg');
  assert.equal(selected.detail.url, 'https://s1.ticketm.net/detail.jpg');
  assert.equal(selected.detail.attribution, 'Literal credit');
  assert.equal(selectTicketmasterImage([image({ attribution: undefined })], 'card').attribution, null);
  assert.equal(selectTicketmasterImage([{ ...image(), url: 'not-a-url' }], 'card'), null);
  assert.equal(selectTicketmasterImage([image({ width: 5000, height: 2813 })], 'card'), null);
});

test('API exposes only controlled Ticketmaster images with card/detail roles and supports multisource', async () => {
  await withTestDatabase(async (db) => {
    const ticketmasterPlan = insertPlan(db, 'ticketmaster-image');
    const ticketmasterSource = insertSource(db, ticketmasterPlan, 'ticketmaster-discovery-feed', 'tm-image');
    insertImage(db, ticketmasterSource, 'card', 'https://s1.ticketm.net/card.jpg', 640, 360);
    insertImage(db, ticketmasterSource, 'detail', 'https://s1.ticketm.net/detail.jpg', 1136, 639, 'Exact credit');

    const gencatPlan = insertPlan(db, 'gencat-image');
    const gencatSource = insertSource(db, gencatPlan, 'gencat-agenda', 'gencat-image');
    insertImage(db, gencatSource, 'card', 'https://example.test/gencat.jpg', 640, 360);

    const noImagePlan = insertPlan(db, 'without-image');
    insertSource(db, noImagePlan, 'gencat-agenda', 'without-image');

    const sharedPlan = insertPlan(db, 'shared-image');
    insertSource(db, sharedPlan, 'gencat-agenda', 'shared-gencat');
    const sharedTicketmaster = insertSource(db, sharedPlan, 'ticketmaster-discovery-feed', 'shared-tm');
    insertImage(db, sharedTicketmaster, 'card', 'https://s1.ticketm.net/shared-card.jpg', 640, 360);
    insertImage(db, sharedTicketmaster, 'detail', 'https://s1.ticketm.net/shared-detail.jpg', 1136, 639);

    const app = createApp({ db, now: () => NOW, ticketmasterImagesEnabled: true });
    const list = await request(app).get('/api/plans?limit=100');
    assert.equal(list.status, 200);
    const byId = new Map(list.body.data.map((plan) => [plan.id, plan]));
    assert.deepEqual(byId.get(ticketmasterPlan).image, {
      url: `/api/media/ticketmaster/${db.prepare("SELECT id FROM plan_source_images WHERE plan_source_id=? AND role='card'").get(ticketmasterSource).id}`,
      width: 640, height: 360, source: 'ticketmaster',
    });
    assert.equal(byId.get(gencatPlan).image, null);
    assert.equal(byId.get(noImagePlan).image, null);
    assert.match(byId.get(sharedPlan).image.url, /^\/api\/media\/ticketmaster\/\d+$/);

    const detail = await request(app).get(`/api/plans/${ticketmasterPlan}`);
    assert.deepEqual(detail.body.data.image, {
      url: `/api/media/ticketmaster/${db.prepare("SELECT id FROM plan_source_images WHERE plan_source_id=? AND role='detail'").get(ticketmasterSource).id}`,
      width: 1136, height: 639,
      attribution: 'Exact credit', source: 'ticketmaster',
    });

    db.prepare("UPDATE sources SET enabled = 0 WHERE key = 'ticketmaster-discovery-feed'").run();
    const disabled = await request(app).get(`/api/plans/${ticketmasterPlan}`);
    assert.equal(disabled.body.data.image, null);

    db.prepare("UPDATE sources SET enabled = 1 WHERE key = 'ticketmaster-discovery-feed'").run();
    db.prepare('DELETE FROM plan_sources WHERE id = ?').run(ticketmasterSource);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_images WHERE plan_source_id = ?').get(ticketmasterSource).count, 0);
  });
});

test('Ticketmaster image client errors never expose the API key', async () => {
  const client = new TicketmasterImageClient({
    apiKey: API_KEY,
    fetchImpl: async () => new Response('{}', { status: 500 }),
  });
  await assert.rejects(client.getEventImages('event-id'), (error) => {
    assert.doesNotMatch(error.message, new RegExp(API_KEY));
    return true;
  });
});

test('separate image sync continues after an event error and persists only selected roles', async () => {
  await withTestDatabase(async (db) => {
    const goodPlan = insertPlan(db, 'sync-good');
    insertSource(db, goodPlan, 'ticketmaster-discovery-feed', 'sync-good');
    const missingPlan = insertPlan(db, 'sync-missing');
    insertSource(db, missingPlan, 'ticketmaster-discovery-feed', 'sync-missing');
    const warnings = [];
    const summary = await syncTicketmasterImages({
      databasePath: db.name,
      ticketmasterApiKey: API_KEY,
      ticketmasterImagesEnabled: true,
    }, {
      requestIntervalMs: 0,
      logger: { warn(message) { warnings.push(message); } },
      fetchImpl: async (input) => {
        const eventId = new URL(input).pathname.split('/').at(-2);
        if (eventId === 'sync-missing') return new Response('{}', { status: 404 });
        return new Response(JSON.stringify({ images: [
          image(),
          image({ url: 'https://s1.ticketm.net/detail.jpg', width: 1136, height: 639 }),
        ] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.deepEqual(summary, {
      sourcesFound: 2, eligible: 2, consulted: 2, withImage: 1, withoutImage: 0,
      errors: 1, created: 2, updated: 0, unchanged: 0, removed: 0,
      cacheOrphaned: 0, cacheExpired: 0, cacheEvicted: 0, cacheBytes: 0,
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_images').get().count, 2);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], new RegExp(API_KEY));
  });
});

test('image sync lock rejects a concurrent owner and recovers a dead owner', async () => {
  const directory = temporaryDirectory('tenspla-sync-lock-');
  const first = new TicketmasterImageSyncLock(directory);
  const second = new TicketmasterImageSyncLock(directory);
  try {
    assert.equal(await first.acquire(), true);
    assert.equal(await second.acquire(), false);
    await first.release();
    assert.equal(await second.acquire(), true);
    await second.release();

    const stale = new TicketmasterImageSyncLock(directory);
    fs.mkdirSync(stale.directory, { recursive: true });
    fs.writeFileSync(stale.ownerFile, JSON.stringify({ pid: 2147483647, token: 'stale' }));
    assert.equal(await stale.acquire(), true);
    await stale.release();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('image sync is incremental within 24 hours and supports explicit force', async () => {
  await withTestDatabase(async (db) => {
    const planId = insertPlan(db, 'sync-incremental');
    insertSource(db, planId, 'ticketmaster-discovery-feed', 'sync-incremental');
    let calls = 0;
    const config = {
      databasePath: db.name,
      ticketmasterApiKey: API_KEY,
      ticketmasterImagesEnabled: true,
      ticketmasterImageMetadataRefreshHours: 24,
    };
    const options = {
      requestIntervalMs: 0,
      now: () => NOW,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ images: [image(), image({ width: 1136, height: 639 })] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
    };
    const first = await syncTicketmasterImages(config, options);
    assert.equal(first.consulted, 1);
    const second = await syncTicketmasterImages(config, options);
    assert.equal(second.sourcesFound, 1);
    assert.equal(second.eligible, 0);
    assert.equal(second.consulted, 0);
    const forced = await syncTicketmasterImages(config, { ...options, force: true });
    assert.equal(forced.consulted, 1);
    assert.equal(forced.unchanged, 2);
    assert.equal(calls, 2);
    assert.deepEqual(parseImageSyncArguments(['--force']), { force: true });
    assert.throws(() => parseImageSyncArguments(['--unknown']), /Ús:/);
  });
});
