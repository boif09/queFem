import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import {
  MediaRemoteFetchLimiter,
  TicketmasterImageProxy,
} from '../backend/src/ticketmaster/imageProxy.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-09-15T10:00:00.000Z');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function image(id, filename = `${id}.jpg`) {
  return { id, url: `https://s1.ticketm.net/${filename}` };
}

function successfulResponse(data = Buffer.from([0xff, 0xd8, 0xff])) {
  return new Response(data, { status: 200, headers: { 'content-type': 'image/jpeg' } });
}

function memoryCache({ hit, write } = {}) {
  return {
    read: async (candidate) => hit?.id === candidate.id ? hit.media : null,
    write: write || (async (_candidate, media) => ({ ...media, cacheStatus: 'MISS' })),
    cleanup: async () => {},
  };
}

function assertMediaError(code) {
  return (error) => error?.code === code;
}

test('cached media bypasses an occupied remote-fetch slot', async () => {
  const limiter = new MediaRemoteFetchLimiter(1);
  const origin = deferred();
  const started = deferred();
  const missProxy = new TicketmasterImageProxy({
    cache: memoryCache(), limiter,
    fetchImpl: async () => {
      started.resolve();
      return origin.promise;
    },
  });
  const pendingMiss = missProxy.get(image(1));
  await started.promise;

  let cachedFetches = 0;
  const cachedMedia = { data: Buffer.from([1]), contentType: 'image/jpeg', cacheStatus: 'HIT' };
  const cachedProxy = new TicketmasterImageProxy({
    cache: memoryCache({ hit: { id: 2, media: cachedMedia } }),
    limiter,
    fetchImpl: async () => { cachedFetches += 1; return successfulResponse(); },
  });
  assert.strictEqual(await cachedProxy.get(image(2)), cachedMedia);
  assert.equal(cachedFetches, 0);

  origin.resolve(successfulResponse());
  await pendingMiss;
});

test('concurrent consumers of one image share one fetch and one slot', async () => {
  const limiter = new MediaRemoteFetchLimiter(1);
  const origin = deferred();
  const started = deferred();
  let fetches = 0;
  const proxy = new TicketmasterImageProxy({
    cache: memoryCache(), limiter,
    fetchImpl: async () => {
      fetches += 1;
      started.resolve();
      return origin.promise;
    },
  });

  const first = proxy.get(image(1));
  await started.promise;
  const second = proxy.get(image(1));
  assert.equal(fetches, 1);
  origin.resolve(successfulResponse());
  const [firstMedia, secondMedia] = await Promise.all([first, second]);
  assert.deepEqual(secondMedia, firstMedia);
  assert.equal(fetches, 1);
});

test('distinct misses run to the limit, reject excess work, and release slots after success', async () => {
  const limiter = new MediaRemoteFetchLimiter(2);
  const origins = new Map([[1, deferred()], [2, deferred()], [3, deferred()]]);
  const started = [];
  const firstWaveStarted = deferred();
  const thirdStarted = deferred();
  const proxy = new TicketmasterImageProxy({
    cache: memoryCache(), limiter,
    fetchImpl: async (input) => {
      const id = Number(new URL(input).pathname.slice(1).split('.', 1)[0]);
      started.push(id);
      if (started.length === 2) firstWaveStarted.resolve();
      if (id === 3) thirdStarted.resolve();
      return origins.get(id).promise;
    },
  });

  const first = proxy.get(image(1));
  const second = proxy.get(image(2));
  await firstWaveStarted.promise;
  assert.deepEqual(started.sort(), [1, 2]);
  await assert.rejects(proxy.get(image(3)), assertMediaError('MEDIA_CAPACITY'));
  assert.deepEqual(started.sort(), [1, 2]);

  origins.get(1).resolve(successfulResponse());
  origins.get(2).resolve(successfulResponse());
  await Promise.all([first, second]);
  const third = proxy.get(image(3));
  await thirdStarted.promise;
  assert.deepEqual(started.sort(), [1, 2, 3]);
  origins.get(3).resolve(successfulResponse());
  await third;
});

test('remote failures, timeout, invalid MIME, oversized data and cache writes all release slots', async (context) => {
  const cases = [
    ['remote HTTP error', async () => new Response('', { status: 502 }), {}, 'MEDIA_ORIGIN_ERROR'],
    ['network exception', async () => {
      await Promise.resolve();
      throw new Error('network failure');
    }, {}, 'MEDIA_ORIGIN_ERROR'],
    ['synchronous fetch exception', () => {
      throw new Error('network failure');
    }, {}, 'MEDIA_ORIGIN_ERROR'],
    ['timeout', async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }), { timeoutMs: 5 }, 'MEDIA_TIMEOUT'],
    ['invalid MIME', async () => new Response('html', { status: 200, headers: { 'content-type': 'text/html' } }), {}, 'MEDIA_INVALID_TYPE'],
    ['oversized stream', async () => new Response(Buffer.alloc(11), { status: 200, headers: { 'content-type': 'image/jpeg' } }), { maximumBytes: 10 }, 'MEDIA_TOO_LARGE'],
    ['cache write failure', async () => successfulResponse(), { cache: memoryCache({ write: async () => { throw new Error('disk failure'); } }) }, 'MEDIA_ORIGIN_ERROR'],
  ];

  for (const [name, failingFetch, options, errorCode] of cases) {
    await context.test(name, async () => {
      const limiter = new MediaRemoteFetchLimiter(1);
      const failingProxy = new TicketmasterImageProxy({
        cache: options.cache || memoryCache(),
        limiter,
        fetchImpl: failingFetch,
        ...options,
      });
      await assert.rejects(failingProxy.get(image(1)), assertMediaError(errorCode));

      let legitimateFetches = 0;
      const legitimateProxy = new TicketmasterImageProxy({
        cache: memoryCache(), limiter,
        fetchImpl: async () => { legitimateFetches += 1; return successfulResponse(); },
      });
      assert.equal((await legitimateProxy.get(image(2))).cacheStatus, 'MISS');
      assert.equal(legitimateFetches, 1);
    });
  }
});

function temporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function seedImage(db, { sourceKey, sourceRecordId, url }) {
  const timestamp = NOW.toISOString();
  const source = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey);
  const planId = Number(db.prepare(`INSERT INTO plans (
    kind, fingerprint, original_title, title_ca, start_date, end_date, permanent,
    image_reuse_allowed, featured, quality_score, status, created_at, updated_at
  ) VALUES ('event',?,?,'Media plan','2026-10-01','2026-10-01',0,0,0,70,'active',?,?)`)
    .run(`media-${sourceRecordId}`, `Media ${sourceRecordId}`, timestamp, timestamp).lastInsertRowid);
  const planSourceId = Number(db.prepare(`INSERT INTO plan_sources (
    plan_id, source_id, source_record_id, source_payload_json, imported_at, last_seen_at
  ) VALUES (?,?,?,'{}',?,?)`).run(planId, source.id, sourceRecordId, timestamp, timestamp).lastInsertRowid);
  return Number(db.prepare(`INSERT INTO plan_source_images (
    plan_source_id, role, url, ratio, width, height, is_fallback,
    attribution, last_seen_at, created_at, updated_at
  ) VALUES (?,'card',?,'16_9',640,360,0,NULL,?,?,?)`)
    .run(planSourceId, url, timestamp, timestamp, timestamp).lastInsertRowid);
}

test('Ticketmaster and Fever public misses share the same application capacity', async () => {
  await withTestDatabase(async (db) => {
    const ticketmasterCache = temporaryDirectory('tenspla-ticketmaster-capacity-');
    const feverCache = temporaryDirectory('tenspla-fever-capacity-');
    try {
      db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
      const ticketmasterId = seedImage(db, {
        sourceKey: 'ticketmaster-discovery-feed', sourceRecordId: 'ticketmaster-capacity',
        url: 'https://s1.ticketm.net/capacity.jpg',
      });
      const feverId = seedImage(db, {
        sourceKey: 'fever', sourceRecordId: 'fever-capacity',
        url: 'https://applications-media.feverup.com/capacity.jpg',
      });
      const ticketmasterOrigin = deferred();
      const ticketmasterStarted = deferred();
      let feverFetches = 0;
      const app = createApp({
        db,
        now: () => NOW,
        ticketmasterImagesEnabled: true,
        feverImagesEnabled: true,
        ticketmasterImageCachePath: ticketmasterCache,
        feverImageCachePath: feverCache,
        mediaRemoteFetchConcurrency: 1,
        ticketmasterImageFetchImpl: async () => {
          ticketmasterStarted.resolve();
          return ticketmasterOrigin.promise;
        },
        feverImageFetchImpl: async () => {
          feverFetches += 1;
          return successfulResponse();
        },
      });

      const ticketmasterResponse = request(app).get(`/api/media/ticketmaster/${ticketmasterId}`).then((response) => response);
      await ticketmasterStarted.promise;
      const rejectedFever = await request(app).get(`/api/media/fever/${feverId}`);
      assert.equal(rejectedFever.status, 503);
      assert.equal(rejectedFever.body.error.code, 'MEDIA_CAPACITY');
      assert.equal(rejectedFever.body.error.message, 'La imatge no està disponible temporalment.');
      assert.equal(feverFetches, 0);

      ticketmasterOrigin.resolve(successfulResponse());
      assert.equal((await ticketmasterResponse).status, 200);
      assert.equal((await request(app).get(`/api/media/fever/${feverId}`)).status, 200);
      assert.equal(feverFetches, 1);
    } finally {
      fs.rmSync(ticketmasterCache, { recursive: true, force: true });
      fs.rmSync(feverCache, { recursive: true, force: true });
    }
  });
});
