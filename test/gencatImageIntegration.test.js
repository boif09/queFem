import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { GencatAgendaImporter } from '../backend/src/importers/gencatAgenda.importer.js';
import { PlanQueryRepository } from '../backend/src/db/repositories/planQuery.repository.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-09-15T10:00:00.000Z');
const FIRST_PATH = '/content/dam/agenda/ca/activitats/2026/primera.jpg';
const SECOND_PATH = '/content/dam/agenda/ca/activitats/2026/segona.jpg';

function record(imagePath = FIRST_PATH, overrides = {}) {
  return {
    codi: '202609150001', denominaci: 'Concert amb imatge', descripcio: 'Descripció oficial',
    data_inici: '2026-09-20T00:00:00.000', data_fi: '2026-09-20T00:00:00.000',
    tags_mbits: 'agenda:ambits/musica', municipi: 'agenda:ubicacions/barcelona/barcelones/barcelona',
    comarca: 'agenda:ubicacions/barcelona/barcelones', espai: 'Auditori', imatges: imagePath,
    ...overrides,
  };
}

function importer(db, input, imageMetadataResolver, overrides = {}) {
  const rows = Array.isArray(input) ? input : [input];
  const fetchImpl = async (input) => {
    if (String(input).includes('/api/views/')) return new Response(JSON.stringify({
      id: 'rhpv-yr4f', rowsUpdatedAt: 1789466400, columns: [{ fieldName: 'codi' }],
    }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  };
  return new GencatAgendaImporter({
    db, fetchImpl, pageSize: 10, now: () => NOW, imageMetadataResolver, ...overrides,
  });
}

function imageState(db) {
  return db.prepare(`SELECT role,url,attribution,attribution_known FROM plan_source_images ORDER BY role`).all();
}

test('repeated unchanged imports do not refetch resolved Gencat metadata', async () => {
  await withTestDatabase(async (db) => {
    let resolutions = 0;
    const metadata = { resolve: async ({ imagePath }) => {
      resolutions += 1;
      return { imagePath, attribution: 'Font: Entitat', attributionKnown: true };
    } };
    await importer(db, record(), metadata).run();
    await importer(db, record(), metadata).run();
    assert.equal(resolutions, 1);
    assert.deepEqual(imageState(db), [
      { role: 'card', url: 'https://agenda.cultura.gencat.cat/content/dam/agenda/ca/activitats/2026/primera.jpg', attribution: 'Font: Entitat', attribution_known: 1 },
      { role: 'detail', url: 'https://agenda.cultura.gencat.cat/content/dam/agenda/ca/activitats/2026/primera.jpg', attribution: 'Font: Entitat', attribution_known: 1 },
    ]);
  });
});

test('an image-path change preserves source identity and triggers a new resolution', async () => {
  await withTestDatabase(async (db) => {
    const paths = [];
    const metadata = { resolve: async ({ imagePath }) => {
      paths.push(imagePath);
      return { imagePath, attribution: `Credit ${paths.length}`, attributionKnown: true };
    } };
    const first = importer(db, record(FIRST_PATH), metadata);
    const identity = first.getExternalId(record(FIRST_PATH));
    await first.run();
    const second = importer(db, record(SECOND_PATH), metadata);
    assert.equal(second.getExternalId(record(SECOND_PATH)), identity);
    await second.run();
    assert.deepEqual(paths, [FIRST_PATH, SECOND_PATH]);
    assert.ok(imageState(db).every(({ url, attribution }) => url.endsWith('/segona.jpg') && attribution === 'Credit 2'));
    assert.equal(JSON.parse(db.prepare('SELECT source_payload_json FROM plan_sources').get().source_payload_json).imatges, SECOND_PATH);
  });
});

test('unknown attribution is durable, retried on a controlled cadence, and falls back instead of being served', async () => {
  await withTestDatabase(async (db) => {
    let now = NOW;
    let resolutions = 0;
    const metadata = { resolve: async ({ imagePath }) => {
      resolutions += 1;
      return { imagePath, attribution: null, attributionKnown: false };
    } };
    const run = () => importer(db, record(), metadata, { now: () => now }).run();
    await run();
    await run();
    assert.equal(resolutions, 1);
    now = new Date(NOW.getTime() + 23 * 60 * 60 * 1000);
    await run();
    assert.equal(resolutions, 1);
    now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1);
    await run();
    assert.equal(resolutions, 2);
    assert.ok(imageState(db).every(({ attribution_known }) => attribution_known === 0));
    const fallbackImageLibrary = { resolve: (_plan, { role }) => ({
      url: `/media/fallbacks/${role}/cultura.webp`, kind: 'generic', source: 'tenspla-fallback',
    }) };
    const repository = new PlanQueryRepository(db, {
      now: () => now, gencatImagesEnabled: true, fallbackImageLibrary,
    });
    const cards = [{ id: 1 }];
    repository.attachImages(cards, 'card');
    assert.equal(cards[0].image.url, '/media/fallbacks/card/cultura.webp');
    const plan = repository.findById(1, 'ca');
    assert.equal(plan.image.url, '/media/fallbacks/detail/cultura.webp');
  });
});

test('known empty enables Gencat images for card and detail without inventing a credit', async () => {
  await withTestDatabase(async (db) => {
    const metadata = { resolve: async ({ imagePath }) => ({ imagePath, attribution: null, attributionKnown: true }) };
    await importer(db, record(), metadata).run();
    const repository = new PlanQueryRepository(db, { now: () => NOW, gencatImagesEnabled: true });
    const cards = [{ id: 1 }];
    repository.attachImages(cards, 'card');
    assert.match(cards[0].image.url, /^\/api\/media\/gencat\/\d+$/);
    assert.equal('attribution' in cards[0].image, false);
    const plan = repository.findById(1, 'ca');
    assert.match(plan.image.url, /^\/api\/media\/gencat\/\d+$/);
    assert.equal(plan.image.source, 'gencat');
    assert.equal('attribution' in plan.image, false);
  });
});

test('known non-empty enables Gencat images for card and detail with the exact detail credit', async () => {
  await withTestDatabase(async (db) => {
    const metadata = { resolve: async ({ imagePath }) => ({ imagePath, attribution: 'Fundació & autora <literal>', attributionKnown: true }) };
    await importer(db, record(), metadata).run();
    const repository = new PlanQueryRepository(db, { now: () => NOW, gencatImagesEnabled: true });
    const cards = [{ id: 1 }];
    repository.attachImages(cards, 'card');
    assert.match(cards[0].image.url, /^\/api\/media\/gencat\/\d+$/);
    assert.equal(cards[0].image.attribution, 'Fundació & autora <literal>');
    const plan = repository.findById(1, 'ca');
    assert.equal(plan.image.attribution, 'Fundació & autora <literal>');
  });
});

test('normal reimport enriches a historical row created while images were disabled', async () => {
  await withTestDatabase(async (db) => {
    let resolutions = 0;
    const metadata = { resolve: async ({ imagePath }) => {
      resolutions += 1;
      return { imagePath, attribution: null, attributionKnown: true };
    } };
    await importer(db, record(), metadata, { imagesEnabled: false }).run();
    assert.deepEqual(imageState(db), []);
    await importer(db, record(), metadata).run();
    assert.equal(resolutions, 1);
    assert.equal(imageState(db).length, 2);
  });
});

test('historical image enrichment stops at its budget and continues on the next import', async () => {
  await withTestDatabase(async (db) => {
    const rows = [
      record(FIRST_PATH, { codi: '202609150011', denominaci: 'Historic first' }),
      record(SECOND_PATH, { codi: '202609150012', denominaci: 'Historic second' }),
    ];
    const resolvedCodes = [];
    const metadata = { resolve: async ({ codi, imagePath }) => {
      resolvedCodes.push(codi);
      return { imagePath, attribution: null, attributionKnown: true };
    } };
    await importer(db, rows, metadata, { imagesEnabled: false }).run();

    const firstImporter = importer(db, rows, metadata, { historicalImageResolutionBudget: 1 });
    await firstImporter.run();
    assert.deepEqual(resolvedCodes, ['202609150011']);
    assert.deepEqual(firstImporter.imageMetadataSummary(), {
      historicalResolutionBudget: 1, historicalResolutions: 1, deferredHistoricalResolutions: 1,
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_images').get().count, 2);

    const secondImporter = importer(db, rows, metadata, { historicalImageResolutionBudget: 1 });
    await secondImporter.run();
    assert.deepEqual(resolvedCodes, ['202609150011', '202609150012']);
    assert.equal(secondImporter.imageMetadataSummary().historicalResolutions, 1);
    assert.equal(secondImporter.imageMetadataSummary().deferredHistoricalResolutions, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_images').get().count, 4);
  });
});

test('new and changed images bypass an exhausted historical enrichment budget', async () => {
  await withTestDatabase(async (db) => {
    const historical = record(FIRST_PATH, { codi: '202609150021', denominaci: 'Historic pending' });
    const fresh = record(SECOND_PATH, { codi: '202609150022', denominaci: 'New plan' });
    const resolved = [];
    const metadata = { resolve: async ({ codi, imagePath }) => {
      resolved.push({ codi, imagePath });
      return { imagePath, attribution: 'Font', attributionKnown: true };
    } };
    await importer(db, historical, metadata, { imagesEnabled: false }).run();
    const newPlanImporter = importer(db, [historical, fresh], metadata, {
      historicalImageResolutionBudget: 0,
    });
    await newPlanImporter.run();
    assert.deepEqual(resolved.map(({ codi }) => codi), ['202609150022']);
    assert.equal(newPlanImporter.imageMetadataSummary().deferredHistoricalResolutions, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 2);

    const changed = record('/content/dam/agenda/ca/activitats/2026/changed.jpg', {
      codi: fresh.codi, denominaci: fresh.denominaci,
    });
    await importer(db, [historical, changed], metadata, { historicalImageResolutionBudget: 0 }).run();
    assert.deepEqual(resolved.map(({ imagePath }) => imagePath), [SECOND_PATH, changed.imatges]);
  });
});

test('attributions longer than 160 characters keep the Gencat image eligible for card and detail', async () => {
  await withTestDatabase(async (db) => {
    const attribution = 'Credit '.repeat(30).trim();
    await importer(db, record(), {
      resolve: async ({ imagePath }) => ({ imagePath, attribution, attributionKnown: true }),
    }).run();
    assert.deepEqual(db.prepare('SELECT role FROM plan_source_images ORDER BY role').all(), [
      { role: 'card' }, { role: 'detail' },
    ]);
    const repository = new PlanQueryRepository(db, { now: () => NOW, gencatImagesEnabled: true });
    const cards = [{ id: 1 }];
    repository.attachImages(cards, 'card');
    assert.match(cards[0].image.url, /^\/api\/media\/gencat\/\d+$/);
    assert.equal(cards[0].image.attribution, attribution);
    const plan = repository.findById(1, 'ca');
    assert.match(plan.image.url, /^\/api\/media\/gencat\/\d+$/);
    assert.equal(plan.image.attribution, attribution);
  });
});

test('a very long valid Gencat attribution keeps card eligibility and full detail text', async () => {
  await withTestDatabase(async (db) => {
    const attribution = 'A'.repeat(2000);
    await importer(db, record(), {
      resolve: async ({ imagePath }) => ({ imagePath, attribution, attributionKnown: true }),
    }).run();
    assert.deepEqual(db.prepare('SELECT role,attribution FROM plan_source_images ORDER BY role').all(), [
      { role: 'card', attribution }, { role: 'detail', attribution },
    ]);
    const repository = new PlanQueryRepository(db, { now: () => NOW, gencatImagesEnabled: true });
    const cards = [{ id: 1 }];
    repository.attachImages(cards, 'card');
    assert.match(cards[0].image.url, /^\/api\/media\/gencat\/\d+$/);
    const plan = repository.findById(1, 'ca');
    assert.equal(plan.image.attribution, attribution);
  });
});

test('same-origin Gencat media route revalidates known attribution before proxying', async () => {
  await withTestDatabase(async (db) => {
    const metadata = { resolve: async ({ imagePath }) => ({ imagePath, attribution: null, attributionKnown: true }) };
    await importer(db, record(), metadata).run();
    const image = db.prepare("SELECT id,url FROM plan_source_images WHERE role='card'").get();
    const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-gencat-media-'));
    let fetches = 0;
    try {
      const app = createApp({
        db, now: () => NOW, fallbackImageLibrary: null, gencatImageCachePath: cacheDirectory,
        gencatImageFetchImpl: async (input) => {
          fetches += 1;
          assert.equal(String(input), image.url);
          return new Response(Buffer.from([0xff, 0xd8, 0xff]), {
            status: 200, headers: { 'content-type': 'image/jpeg' },
          });
        },
      });
      const served = await request(app).get(`/api/media/gencat/${image.id}`);
      assert.equal(served.status, 200);
      assert.equal(served.headers['content-type'], 'image/jpeg');
      assert.equal(fetches, 1);
      assert.equal((await request(app).get(`/api/media/gencat/${image.id}?url=https://evil.example`)).status, 404);
      db.prepare('UPDATE plan_source_images SET attribution_known=0 WHERE id=?').run(image.id);
      assert.equal((await request(app).get(`/api/media/gencat/${image.id}`)).status, 404);
      assert.equal(fetches, 1);
    } finally {
      fs.rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });
});
