import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { TicketmasterImageCache } from '../backend/src/ticketmaster/imageCache.js';
import {
  TicketmasterImageProxy,
  validateTicketmasterImageUrl,
} from '../backend/src/ticketmaster/imageProxy.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function seedImage(db, url = 'https://s1.ticketm.net/served.jpg', sourceKey = 'ticketmaster-discovery-feed') {
  const now = NOW.toISOString();
  const source = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey);
  const planId = Number(db.prepare(`INSERT INTO plans (
    kind, fingerprint, original_title, title_ca, start_date, end_date, permanent,
    image_reuse_allowed, featured, quality_score, status, created_at, updated_at
  ) VALUES ('event','media-plan','Media plan','Media plan','2026-09-01','2026-09-01',0,0,0,70,'active',?,?)`)
    .run(now, now).lastInsertRowid);
  const planSourceId = Number(db.prepare(`INSERT INTO plan_sources (
    plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
  ) VALUES (?,?,'media-event','{}',?,?)`).run(planId, source.id, now, now).lastInsertRowid);
  const imageId = Number(db.prepare(`INSERT INTO plan_source_images (
    plan_source_id, role, url, ratio, width, height, is_fallback,
    attribution, last_seen_at, created_at, updated_at
  ) VALUES (?,'card',?,'16_9',640,360,0,NULL,?,?,?)`)
    .run(planSourceId, url, now, now, now).lastInsertRowid);
  return { planId, planSourceId, imageId };
}

test('Fever media remains off independently, then serves a controlled miss, hit and no-image fallback', async () => {
  await withTestDatabase(async (db) => {
    const cacheDirectory = temporaryDirectory('tenspla-fever-media-');
    try {
      db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
      const { imageId } = seedImage(db, 'https://applications-media.feverup.com/served.jpg', 'fever');
      let fetches = 0;
      const disabled = createApp({ db, now: () => NOW, feverImagesEnabled: false, feverImageCachePath: cacheDirectory });
      assert.equal((await request(disabled).get(`/api/media/fever/${imageId}`)).status, 404);
      const enabled = createApp({
        db, now: () => NOW, feverImagesEnabled: true, feverImageCachePath: cacheDirectory,
        feverImageFetchImpl: async (input) => {
          fetches += 1;
          assert.equal(String(input), 'https://applications-media.feverup.com/served.jpg');
          return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        },
      });
      assert.equal((await request(enabled).get(`/api/media/fever/${imageId}`)).headers['x-tenspla-cache'], 'MISS');
      assert.equal((await request(enabled).get(`/api/media/fever/${imageId}`)).headers['x-tenspla-cache'], 'HIT');
      assert.equal(fetches, 1);
      assert.equal((await request(enabled).get('/api/media/fever/999999')).status, 404);
    } finally {
      fs.rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('same-origin endpoint fetches persisted URL once, serves cache and never accepts a client URL', async () => {
  await withTestDatabase(async (db) => {
    const cacheDirectory = temporaryDirectory('tenspla-media-');
    try {
      const { planId, imageId } = seedImage(db);
      let fetches = 0;
      const app = createApp({
        db,
        now: () => NOW,
        ticketmasterImagesEnabled: true,
        ticketmasterImageCachePath: cacheDirectory,
        ticketmasterImageFetchImpl: async (input) => {
          fetches += 1;
          assert.equal(String(input), 'https://s1.ticketm.net/served.jpg');
          return new Response(Buffer.from([0xff, 0xd8, 0xff]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          });
        },
      });
      const plans = await request(app).get('/api/plans?limit=100');
      const plan = plans.body.data.find(({ id }) => id === planId);
      assert.equal(plan.image.url, `/api/media/ticketmaster/${imageId}`);
      assert.doesNotMatch(JSON.stringify(plans.body), /s1\.ticketm\.net/);

      const first = await request(app).get(`/api/media/ticketmaster/${imageId}`);
      assert.equal(first.status, 200);
      assert.equal(first.headers['content-type'], 'image/jpeg');
      assert.equal(first.headers['cache-control'], 'public, max-age=3600');
      assert.equal(first.headers['x-content-type-options'], 'nosniff');
      assert.equal(first.headers['x-tenspla-cache'], 'MISS');
      const second = await request(app).get(`/api/media/ticketmaster/${imageId}`);
      assert.equal(second.status, 200);
      assert.equal(second.headers['x-tenspla-cache'], 'HIT');
      assert.equal(fetches, 1);

      const injected = await request(app)
        .get(`/api/media/ticketmaster/${imageId}?url=https://attacker.test/image.jpg`);
      assert.equal(injected.status, 400);
      assert.equal(fetches, 1);

      db.prepare("UPDATE sources SET enabled=0 WHERE key='ticketmaster-discovery-feed'").run();
      const inactive = await request(app).get(`/api/media/ticketmaster/${imageId}`);
      assert.equal(inactive.status, 404);
      assert.equal(fetches, 1);
    } finally {
      fs.rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});

test('expired cache refreshes from origin', async () => {
  await withTestDatabase(async (db) => {
    const cacheDirectory = temporaryDirectory('tenspla-expired-');
    let current = new Date(NOW);
    let fetches = 0;
    try {
      const { imageId } = seedImage(db);
      const app = createApp({
        db,
        now: () => current,
        ticketmasterImagesEnabled: true,
        ticketmasterImageCachePath: cacheDirectory,
        ticketmasterImageCacheTtlHours: 1,
        ticketmasterImageFetchImpl: async () => {
          fetches += 1;
          return new Response(Buffer.from([fetches]), {
            status: 200, headers: { 'content-type': 'image/jpeg' },
          });
        },
      });
      assert.equal((await request(app).get(`/api/media/ticketmaster/${imageId}`)).headers['x-tenspla-cache'], 'MISS');
      current = new Date('2026-08-20T14:00:00.000Z');
      assert.equal((await request(app).get(`/api/media/ticketmaster/${imageId}`)).headers['x-tenspla-cache'], 'MISS');
      assert.equal(fetches, 2);
    } finally {
      fs.rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});

test('proxy rejects insecure/unallowlisted URLs, invalid content, oversized data and timeout', async () => {
  assert.throws(() => validateTicketmasterImageUrl('http://s1.ticketm.net/image.jpg'), /no està disponible/);
  assert.throws(() => validateTicketmasterImageUrl('https://attacker.test/image.jpg'), /no està disponible/);
  const image = { id: 1, url: 'https://s1.ticketm.net/image.jpg' };

  async function proxyWith(fetchImpl, options = {}) {
    const directory = temporaryDirectory('tenspla-proxy-');
    const cache = new TicketmasterImageCache({ directory, ttlHours: 6, now: () => NOW });
    try {
      return await new TicketmasterImageProxy({ cache, fetchImpl, ...options }).get(image);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  await assert.rejects(proxyWith(async () => new Response('html', {
    status: 200, headers: { 'content-type': 'text/html' },
  })), (error) => error.code === 'MEDIA_INVALID_TYPE');
  await assert.rejects(proxyWith(async () => new Response(Buffer.alloc(11), {
    status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '11' },
  }), { maximumBytes: 10 }), (error) => error.code === 'MEDIA_TOO_LARGE');
  await assert.rejects(proxyWith(async (input, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }), { timeoutMs: 5 }), (error) => error.code === 'MEDIA_TIMEOUT');
});

test('cache cleanup removes only numeric cache entries inside its configured directory', async () => {
  const parent = temporaryDirectory('tenspla-cleanup-');
  const directory = path.join(parent, 'cache');
  const outside = path.join(parent, 'keep.txt');
  fs.mkdirSync(directory);
  fs.writeFileSync(outside, 'keep');
  fs.writeFileSync(path.join(directory, 'unknown.txt'), 'keep');
  fs.writeFileSync(path.join(directory, '999.bin'), 'orphan');
  fs.writeFileSync(path.join(directory, '999.json'), '{}');
  try {
    const cache = new TicketmasterImageCache({ directory, ttlHours: 6, now: () => NOW });
    assert.deepEqual(await cache.cleanup([]), { orphaned: 1, expired: 0, evicted: 0, bytes: 0 });
    assert.equal(fs.existsSync(outside), true);
    assert.equal(fs.existsSync(path.join(directory, 'unknown.txt')), true);
    assert.equal(fs.existsSync(path.join(directory, '999.bin')), false);
    assert.throws(() => cache.paths('../outside'), /invàlid/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('cache cleanup evicts oldest valid entries when the disk limit is exceeded', async () => {
  const directory = temporaryDirectory('tenspla-cache-limit-');
  let current = new Date('2026-08-20T10:00:00.000Z');
  const cache = new TicketmasterImageCache({
    directory, ttlHours: 6, maximumMb: 0.000015, now: () => current,
  });
  try {
    await cache.write({ id: 1, url: 'https://s1.ticketm.net/old.jpg' }, {
      data: Buffer.alloc(10), contentType: 'image/jpeg',
    });
    current = new Date('2026-08-20T10:01:00.000Z');
    await cache.write({ id: 2, url: 'https://s1.ticketm.net/new.jpg' }, {
      data: Buffer.alloc(10), contentType: 'image/jpeg',
    });
    const result = await cache.cleanup([1, 2]);
    assert.deepEqual(result, { orphaned: 0, expired: 0, evicted: 1, bytes: 10 });
    assert.equal(fs.existsSync(cache.paths(1).binary), false);
    assert.equal(fs.existsSync(cache.paths(2).binary), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
