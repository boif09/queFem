import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { GencatAgendaImporter } from '../backend/src/importers/gencatAgenda.importer.js';
import { DEAD_IMAGE_RETRY_DAYS } from '../backend/src/db/repositories/imageAvailability.js';
import { collectSweepTargets, probeImage, sweepGencatImages } from '../scripts/sweep-gencat-images.js';
import { withTestDatabase } from './helpers.js';

const START = new Date('2026-09-15T10:00:00.000Z');
const FIRST_PATH = '/content/dam/agenda/ca/activitats/2026/primera.jpg';
const SECOND_PATH = '/content/dam/agenda/ca/activitats/2026/segona.jpg';
const ORIGIN = 'https://agenda.cultura.gencat.cat';
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const metadata = { resolve: async ({ imagePath }) => ({ imagePath, attribution: null, attributionKnown: true }) };
const GENERIC = { resolve: () => ({ url: '/media/fallbacks/card/musica/musica-01.webp', kind: 'generic', source: 'tenspla' }) };

function record(imagePath = FIRST_PATH, code = '202609150001') {
  return {
    codi: code, denominaci: `Concert ${code}`, descripcio: 'Descripció oficial',
    data_inici: '2026-12-01T00:00:00.000', data_fi: '2026-12-01T00:00:00.000',
    tags_mbits: 'agenda:ambits/musica', municipi: 'agenda:ubicacions/barcelona/barcelones/barcelona',
    comarca: 'agenda:ubicacions/barcelona/barcelones', espai: 'Auditori', imatges: imagePath,
  };
}
function importer(db, rows, now = START) {
  const fetchImpl = async (input) => {
    if (String(input).includes('/api/views/')) return new Response(JSON.stringify({ id: 'rhpv-yr4f', rowsUpdatedAt: 1789466400, columns: [{ fieldName: 'codi' }] }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  };
  return new GencatAgendaImporter({ db, fetchImpl, pageSize: 10, now: () => now, imageMetadataResolver: metadata });
}
const images = (db) => db.prepare('SELECT id, role, url, unavailable_at, unavailable_status FROM plan_source_images ORDER BY id').all();

// A plan with a card and a detail image, served by an app whose origin behaviour and clock the test controls.
async function withApp(callback, { origin = () => new Response(JSON.stringify({}), { status: 404 }), library = GENERIC } = {}) {
  await withTestDatabase(async (db) => {
    await importer(db, [record()]).run();
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-dead-images-'));
    const clock = { now: new Date(START) };
    const calls = [];
    const app = createApp({
      db, now: () => clock.now, fallbackImageLibrary: library, gencatImageCachePath: cache,
      gencatImageFetchImpl: async (input) => { calls.push(String(input)); return origin(input, calls.length); },
    });
    try { await callback({ db, app, clock, calls, planId: db.prepare('SELECT id FROM plans').get().id }); }
    finally { fs.rmSync(cache, { recursive: true, force: true }); }
  });
}
const planImage = async (app, planId) => (await request(app).get(`/api/plans/${planId}`)).body.data.image;

test('an origin 404 hides the image for every role, the plan falls back to the generic photo and the origin is not asked again', async () => {
  await withApp(async ({ db, app, calls, planId }) => {
    assert.equal((await planImage(app, planId)).kind, 'official', 'offered before the origin is tried');
    const [card, detail] = images(db);
    const first = await request(app).get(`/api/media/gencat/${card.id}`);
    assert.equal(first.status, 502);
    assert.equal(calls.length, 1);
    for (const row of images(db)) {
      assert.ok(row.unavailable_at, `${row.role} row is marked`);
      assert.equal(row.unavailable_status, 404);
    }
    const shown = await planImage(app, planId);
    assert.equal(shown.kind, 'generic', 'a generic photo replaces the dead image');
    assert.equal((await request(app).get(`/api/media/gencat/${detail.id}`)).status, 404, 'a marked image is not served');
    assert.equal(calls.length, 1, 'and the origin is not asked again');
  });
});

test('a 410 is also definitive; timeouts, 5xx and network errors are never recorded', async () => {
  await withApp(async ({ db, app, calls }) => {
    const [card] = images(db);
    assert.equal((await request(app).get(`/api/media/gencat/${card.id}`)).status, 502);
    assert.equal(images(db)[0].unavailable_status, 410);
    assert.equal(calls.length, 1);
  }, { origin: () => new Response('gone', { status: 410 }) });

  for (const origin of [
    () => new Response('boom', { status: 503 }),
    () => new Response('boom', { status: 500 }),
    () => new Response('redirect', { status: 302, headers: { location: `${ORIGIN}/elsewhere.jpg` } }),
    () => { throw new TypeError('fetch failed'); },
  ]) {
    await withApp(async ({ db, app, planId }) => {
      const [card] = images(db);
      assert.equal((await request(app).get(`/api/media/gencat/${card.id}`)).status, 502);
      assert.ok(images(db).every((row) => row.unavailable_at === null), 'a transient failure leaves the image offered');
      assert.equal((await planImage(app, planId)).kind, 'official');
    }, { origin });
  }
});

test('after the retry window the image is offered again, and a working origin clears the mark', async () => {
  let serve = false;
  await withApp(async ({ db, app, clock, calls, planId }) => {
    const [card] = images(db);
    assert.equal((await request(app).get(`/api/media/gencat/${card.id}`)).status, 502);
    assert.equal((await planImage(app, planId)).kind, 'generic');

    clock.now = new Date(START.getTime() + (DEAD_IMAGE_RETRY_DAYS - 1) * 86400000);
    assert.equal((await planImage(app, planId)).kind, 'generic', 'still hidden inside the window');

    clock.now = new Date(START.getTime() + (DEAD_IMAGE_RETRY_DAYS + 1) * 86400000);
    assert.equal((await planImage(app, planId)).kind, 'official', 'offered again once the window has passed');
    serve = true;
    assert.equal((await request(app).get(`/api/media/gencat/${card.id}`)).status, 200);
    assert.ok(images(db).every((row) => row.unavailable_at === null), 'the mark is cleared');
    assert.equal(calls.length, 2);
  }, { origin: () => (serve ? new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }) : new Response('x', { status: 404 })) });
});

test('if the origin is still gone after the window the image is hidden for another window', async () => {
  await withApp(async ({ db, app, clock, calls, planId }) => {
    const [card] = images(db);
    await request(app).get(`/api/media/gencat/${card.id}`);
    clock.now = new Date(START.getTime() + (DEAD_IMAGE_RETRY_DAYS + 1) * 86400000);
    assert.equal((await request(app).get(`/api/media/gencat/${card.id}`)).status, 502);
    assert.equal(calls.length, 2);
    assert.equal(images(db)[0].unavailable_at, clock.now.toISOString(), 'marked again from the new attempt');
    assert.equal((await planImage(app, planId)).kind, 'generic');
  });
});

test('a new image address from Gencat clears the mark, an unchanged one keeps it', async () => {
  await withTestDatabase(async (db) => {
    await importer(db, [record(FIRST_PATH)]).run();
    db.prepare("UPDATE plan_source_images SET unavailable_at = '2026-09-15T00:00:00.000Z', unavailable_status = 404").run();
    await importer(db, [record(FIRST_PATH)], new Date(START.getTime() + 3600_000)).run();
    assert.ok(images(db).every((row) => row.unavailable_at), 'same address: still marked');
    await importer(db, [record(SECOND_PATH)], new Date(START.getTime() + 7200_000)).run();
    const rows = images(db);
    assert.ok(rows.every((row) => row.url.endsWith('segona.jpg') && row.unavailable_at === null && row.unavailable_status === null), 'new address: offered again');
  });
});

test('probeImage tells a definitive 404/410 from everything it cannot judge', async () => {
  const url = `${ORIGIN}/content/dam/agenda/ca/x.jpg`;
  const probe = (response) => probeImage(url, { fetchImpl: async () => response });
  assert.deepEqual(await probe(new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })), { state: 'ok', status: 200 });
  assert.equal((await probe(new Response('', { status: 404 }))).state, 'dead');
  assert.equal((await probe(new Response('', { status: 410 }))).status, 410);
  for (const response of [
    new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('', { status: 403 }), new Response('', { status: 500 }), new Response('', { status: 301 }),
  ]) assert.equal((await probe(response)).state, 'unknown');
  assert.equal((await probeImage(url, { fetchImpl: async () => { throw new TypeError('fetch failed'); } })).state, 'unknown');
  assert.equal((await probeImage('https://evil.example/content/dam/agenda/x.jpg', { fetchImpl: async () => { throw new Error('must not be called'); } })).state, 'unknown');
});

function seedSweep(db) {
  const fresh = [record('/content/dam/agenda/ca/viu.jpg', '1'), record('/content/dam/agenda/ca/mort.jpg', '2'), record('/content/dam/agenda/ca/dubtos.jpg', '3'), record('/content/dam/agenda/ca/tornat.jpg', '4')];
  return importer(db, fresh).run().then(() => {
    db.prepare("UPDATE plan_source_images SET unavailable_at = '2026-09-10T00:00:00.000Z', unavailable_status = 404 WHERE url LIKE '%tornat.jpg'").run();
  });
}
const sweepFetch = (counts = {}, inflight = { now: 0, max: 0 }) => async (input) => {
  const name = String(input).split('/').pop();
  counts[name] = (counts[name] ?? 0) + 1;
  inflight.now += 1; inflight.max = Math.max(inflight.max, inflight.now);
  await new Promise((resolve) => setTimeout(resolve, 5));
  inflight.now -= 1;
  if (name === 'mort.jpg') return new Response('', { status: 404 });
  if (name === 'dubtos.jpg') return new Response('', { status: 503 });
  return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
};

test('the sweep checks each distinct address once and a dry-run writes nothing', async () => {
  await withTestDatabase(async (db) => {
    await seedSweep(db);
    assert.equal(collectSweepTargets(db).length, 4, 'a card and a detail row share one address');
    const before = images(db);
    const counts = {};
    const summary = await sweepGencatImages(db, { fetchImpl: sweepFetch(counts), delayMs: 0 });
    assert.deepEqual(Object.values(counts), [1, 1, 1, 1]);
    assert.equal(summary.checked, 4);
    assert.deepEqual(summary.newlyDead.map((r) => r.url.split('/').pop()), ['mort.jpg']);
    assert.deepEqual(summary.recovered.map((r) => r.url.split('/').pop()), ['tornat.jpg']);
    assert.deepEqual(summary.unknown.map((r) => r.url.split('/').pop()), ['dubtos.jpg']);
    assert.deepEqual(images(db), before, 'nothing was written');
  });
});

test('--apply marks the dead addresses (all rows), clears the recovered ones and leaves the unjudged ones alone', async () => {
  await withTestDatabase(async (db) => {
    await seedSweep(db);
    await sweepGencatImages(db, { fetchImpl: sweepFetch(), delayMs: 0, apply: true, now: () => new Date('2026-09-16T08:00:00.000Z') });
    const byName = (name) => images(db).filter((row) => row.url.endsWith(name));
    assert.ok(byName('mort.jpg').length >= 2 && byName('mort.jpg').every((row) => row.unavailable_at === '2026-09-16T08:00:00.000Z' && row.unavailable_status === 404));
    assert.ok(byName('tornat.jpg').every((row) => row.unavailable_at === null), 'recovered address is offered again');
    assert.ok(byName('dubtos.jpg').every((row) => row.unavailable_at === null), 'an unjudged address is not marked');
    assert.ok(byName('viu.jpg').every((row) => row.unavailable_at === null));
    const again = await sweepGencatImages(db, { fetchImpl: sweepFetch(), delayMs: 0, apply: true });
    assert.equal(again.newlyDead.length, 0, 'a second sweep finds nothing new');
    assert.equal(again.dead.length, 1);
  });
});

test('--apply is atomic: a failure on a later update leaves every earlier mark and clear undone', async () => {
  await withTestDatabase(async (db) => {
    await seedSweep(db);
    const before = images(db);
    // The recovered address is cleared after the dead one is marked: make that second step fail.
    db.exec("CREATE TRIGGER fail_clear BEFORE UPDATE ON plan_source_images WHEN NEW.unavailable_at IS NULL AND OLD.unavailable_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    await assert.rejects(sweepGencatImages(db, { fetchImpl: sweepFetch(), delayMs: 0, apply: true }), /boom/);
    assert.deepEqual(images(db), before, 'the dead address was not left marked on its own');
  });
});

test('the sweep never runs more requests at once than its concurrency', async () => {
  await withTestDatabase(async (db) => {
    await importer(db, Array.from({ length: 9 }, (_, i) => record(`/content/dam/agenda/ca/img-${i}.jpg`, String(100 + i)))).run();
    const inflight = { now: 0, max: 0 };
    const summary = await sweepGencatImages(db, { fetchImpl: sweepFetch({}, inflight), delayMs: 0, concurrency: 3 });
    assert.equal(summary.checked, 9);
    assert.ok(inflight.max <= 3 && inflight.max >= 2, `max in flight ${inflight.max}`);
  });
});
