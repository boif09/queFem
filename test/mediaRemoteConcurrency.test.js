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
  // A cache hit must not have taken the one slot, nor queued behind it.
  assert.equal(limiter.active, 1);
  assert.equal(limiter.queue.length, 0);

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

test('the concurrency cap is enforced and every operation eventually resolves once slots free up', async () => {
  const maximum = 4;
  const limiter = new MediaRemoteFetchLimiter(maximum, { maxQueueDepth: 8, maxQueueWaitMs: 5000 });
  let observedMaxActive = 0;
  const origins = [];
  const operations = Array.from({ length: 8 }, (_, i) => () => {
    observedMaxActive = Math.max(observedMaxActive, limiter.active);
    const origin = deferred();
    origins.push(origin);
    return origin.promise.then(() => `done-${i}`);
  });

  const runs = operations.map((operation) => limiter.run(operation));
  // Let the microtask queue settle so every immediately-runnable operation starts.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(limiter.active, maximum, 'exactly the concurrency cap should be active at once');
  assert.equal(limiter.queue.length, 4, 'the remaining 4 operations should be queued, not rejected');
  assert.equal(observedMaxActive, maximum, 'active count must never exceed the configured maximum');

  // Resolve origins one at a time. `origins` grows lazily — a queued
  // operation only pushes its own deferred once it actually starts running,
  // which happens as a side effect of resolving an earlier one — so this
  // must poll rather than snapshot the array up front.
  let resolvedCount = 0;
  while (resolvedCount < operations.length) {
    if (resolvedCount < origins.length) {
      origins[resolvedCount].resolve();
      resolvedCount += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(limiter.active <= maximum, `active (${limiter.active}) must never exceed maximum (${maximum})`);
  }

  const results = await Promise.all(runs);
  assert.deepEqual(results.sort(), Array.from({ length: 8 }, (_, i) => `done-${i}`).sort());
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queue.length, 0);
});

test('queued operations start in FIFO order as slots free up', async () => {
  const limiter = new MediaRemoteFetchLimiter(1, { maxQueueDepth: 4, maxQueueWaitMs: 5000 });
  const startOrder = [];
  const origin = deferred();

  // Occupy the only slot.
  const holder = limiter.run(() => origin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const started = { a: deferred(), b: deferred(), c: deferred() };
  const a = limiter.run(() => { startOrder.push('a'); started.a.resolve(); return Promise.resolve('a'); });
  const b = limiter.run(() => { startOrder.push('b'); started.b.resolve(); return Promise.resolve('b'); });
  const c = limiter.run(() => { startOrder.push('c'); started.c.resolve(); return Promise.resolve('c'); });
  assert.equal(limiter.queue.length, 3, 'a, b, c should all be queued behind the held slot');

  origin.resolve();
  await holder;
  await Promise.all([a, b, c]);

  assert.deepEqual(startOrder, ['a', 'b', 'c'], 'queued operations must start in the order they were queued');
});

test('queue overflow rejects with MEDIA_CAPACITY only once both concurrency and queue depth are exhausted', async () => {
  const limiter = new MediaRemoteFetchLimiter(1, { maxQueueDepth: 1, maxQueueWaitMs: 5000 });
  const origin = deferred();

  const holder = limiter.run(() => origin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(limiter.active, 1);

  const queuedOrigin = deferred();
  const queued = limiter.run(() => queuedOrigin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(limiter.queue.length, 1, 'one free queue slot should be taken');

  // Concurrency full AND queue full: this one must reject immediately, without
  // ever calling the operation.
  let overflowOperationCalled = false;
  await assert.rejects(
    limiter.run(() => { overflowOperationCalled = true; return Promise.resolve(); }),
    assertMediaError('MEDIA_CAPACITY'),
  );
  assert.equal(overflowOperationCalled, false);
  assert.equal(limiter.queue.length, 1, 'the overflow rejection must not have touched the existing queue entry');

  origin.resolve();
  queuedOrigin.resolve();
  await Promise.all([holder, queued]);
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queue.length, 0);
});

test('a queued operation that waits past the configured timeout is rejected and removed cleanly, without blocking later queue entries', async () => {
  const limiter = new MediaRemoteFetchLimiter(1, { maxQueueDepth: 4, maxQueueWaitMs: 20 });
  const origin = deferred();
  const holder = limiter.run(() => origin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const timedOut = limiter.run(() => Promise.resolve('should never run'));
  await assert.rejects(timedOut, assertMediaError('MEDIA_CAPACITY'));
  assert.equal(limiter.queue.length, 0, 'the timed-out entry must be removed from the queue, not left stuck');

  // A later arrival must be able to queue normally — the timed-out entry did
  // not leave the queue permanently occupied.
  const laterOrigin = deferred();
  const later = limiter.run(() => laterOrigin.promise.then(() => 'later-ran'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(limiter.queue.length, 1);

  origin.resolve();
  await holder;
  laterOrigin.resolve();
  assert.equal(await later, 'later-ran');
  assert.equal(limiter.active, 0);
  assert.equal(limiter.queue.length, 0);
});

test('a remote operation that throws releases its slot for the next queued request', async () => {
  const limiter = new MediaRemoteFetchLimiter(1, { maxQueueDepth: 4, maxQueueWaitMs: 5000 });
  const failing = limiter.run(() => Promise.reject(new Error('remote failure')));
  await assert.rejects(failing, /remote failure/);
  assert.equal(limiter.active, 0, 'the slot must be released even though the operation rejected');

  let secondRan = false;
  await limiter.run(() => { secondRan = true; return Promise.resolve(); });
  assert.equal(secondRan, true);
});

test('an operation that throws synchronously still releases its slot and rejects the caller', async () => {
  const limiter = new MediaRemoteFetchLimiter(1, { maxQueueDepth: 4, maxQueueWaitMs: 5000 });
  await assert.rejects(
    limiter.run(() => { throw new Error('synchronous failure'); }),
    /synchronous failure/,
  );
  assert.equal(limiter.active, 0);

  let secondRan = false;
  await limiter.run(() => { secondRan = true; return Promise.resolve(); });
  assert.equal(secondRan, true);
});

test('no active or queued state leaks across a mix of successes, failures, overflow and timeouts', async () => {
  const limiter = new MediaRemoteFetchLimiter(2, { maxQueueDepth: 1, maxQueueWaitMs: 15 });

  const succeedOrigin = deferred();
  const failOrigin = deferred();
  const succeed = limiter.run(() => succeedOrigin.promise);
  const fail = limiter.run(() => failOrigin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(limiter.active, 2);

  // Fills the one queue slot, then overflows, then times out — all three
  // outcomes for a single queue entry's lifecycle.
  const queuedOrigin = deferred();
  const queued = limiter.run(() => queuedOrigin.promise);
  await assert.rejects(limiter.run(() => Promise.resolve()), assertMediaError('MEDIA_CAPACITY'));

  succeedOrigin.resolve(successfulResponse());
  failOrigin.reject(new Error('boom'));
  await succeed;
  await assert.rejects(fail, /boom/);
  queuedOrigin.resolve(successfulResponse());
  await queued;

  // A queue timeout as the final scenario in the same limiter instance.
  const holdOrigin = deferred();
  const hold1 = limiter.run(() => holdOrigin.promise);
  const hold2 = limiter.run(() => holdOrigin.promise);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(limiter.run(() => Promise.resolve()), assertMediaError('MEDIA_CAPACITY'));
  holdOrigin.resolve(successfulResponse());
  await Promise.all([hold1, hold2]);

  assert.equal(limiter.active, 0);
  assert.equal(limiter.queue.length, 0);
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
      assert.equal(limiter.active, 0);

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
    attribution, attribution_known, last_seen_at, created_at, updated_at
  ) VALUES (?,'card',?,'16_9',640,360,0,NULL,1,?,?,?)`)
    .run(planSourceId, url, timestamp, timestamp, timestamp).lastInsertRowid);
}

test('Ticketmaster and Fever public misses share the same application capacity, now via queueing rather than immediate rejection', async () => {
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
        mediaRemoteFetchQueueDepth: 4,
        mediaRemoteFetchQueueWaitMs: 5000,
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

      // With the concurrency slot held by Ticketmaster, a Fever miss now
      // queues (sharing the SAME limiter) instead of failing immediately.
      const feverResponsePromise = request(app).get(`/api/media/fever/${feverId}`).then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(feverFetches, 0, 'the queued Fever request must not have started yet');

      ticketmasterOrigin.resolve(successfulResponse());
      assert.equal((await ticketmasterResponse).status, 200);
      assert.equal((await feverResponsePromise).status, 200);
      assert.equal(feverFetches, 1);
    } finally {
      fs.rmSync(ticketmasterCache, { recursive: true, force: true });
      fs.rmSync(feverCache, { recursive: true, force: true });
    }
  });
});

test('a genuine queue overflow at the route level returns 503 MEDIA_CAPACITY with a Retry-After header', async () => {
  await withTestDatabase(async (db) => {
    const ticketmasterCache = temporaryDirectory('tenspla-ticketmaster-overflow-');
    try {
      const heldId = seedImage(db, {
        sourceKey: 'ticketmaster-discovery-feed', sourceRecordId: 'overflow-held',
        url: 'https://s1.ticketm.net/overflow-held.jpg',
      });
      const overflowId = seedImage(db, {
        sourceKey: 'ticketmaster-discovery-feed', sourceRecordId: 'overflow-excess',
        url: 'https://s1.ticketm.net/overflow-excess.jpg',
      });
      const origin = deferred();
      const started = deferred();
      const app = createApp({
        db,
        now: () => NOW,
        ticketmasterImagesEnabled: true,
        ticketmasterImageCachePath: ticketmasterCache,
        mediaRemoteFetchConcurrency: 1,
        mediaRemoteFetchQueueDepth: 0,
        ticketmasterImageFetchImpl: async () => {
          started.resolve();
          return origin.promise;
        },
      });

      const held = request(app).get(`/api/media/ticketmaster/${heldId}`).then((response) => response);
      await started.promise;

      const overflow = await request(app).get(`/api/media/ticketmaster/${overflowId}`);
      assert.equal(overflow.status, 503);
      assert.equal(overflow.body.error.code, 'MEDIA_CAPACITY');
      assert.ok(overflow.headers['retry-after'], 'a genuine overflow response should advertise Retry-After');
      assert.ok(Number(overflow.headers['retry-after']) > 0);

      origin.resolve(successfulResponse());
      const heldResponse = await held;
      assert.equal(heldResponse.status, 200);
      // Normal successful responses are unaffected by the Retry-After change.
      assert.equal(heldResponse.headers['retry-after'], undefined);
    } finally {
      fs.rmSync(ticketmasterCache, { recursive: true, force: true });
    }
  });
});
