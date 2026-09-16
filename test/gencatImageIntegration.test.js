import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { GencatAgendaImporter, selectFairHistoricalImageCandidates } from '../backend/src/importers/gencatAgenda.importer.js';
import { PlanOccurrenceRepository } from '../backend/src/db/repositories/planOccurrence.repository.js';
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

function fairnessCandidates(prefix, count, tier) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, priority: { tier, date: `${index}` }, originalIndex: index,
  }));
}

function fairnessCounts(candidates) {
  return candidates.reduce((counts, { id }) => {
    const prefix = id.split('-')[0];
    counts[prefix] = (counts[prefix] || 0) + 1;
    return counts;
  }, {});
}

test('fair historical selection preserves relevance while giving every tier reachable capacity', () => {
  const high = fairnessCandidates('high', 220, 1);
  const permanent = fairnessCandidates('permanent', 30, 2);
  const historical = fairnessCandidates('historical', 30, 3);
  const backlog = [...high, ...permanent, ...historical];
  const first = selectFairHistoricalImageCandidates(backlog, 100);
  assert.deepEqual(fairnessCounts(first), { high: 80, permanent: 10, historical: 10 });
  assert.deepEqual(first.slice(0, 3).map(({ id }) => id), ['high-0', 'high-1', 'high-2']);

  const afterFirst = backlog.filter((candidate) => !new Set(first).has(candidate));
  const second = selectFairHistoricalImageCandidates(afterFirst, 100);
  assert.deepEqual(fairnessCounts(second), { high: 80, permanent: 10, historical: 10 });

  const noPermanent = selectFairHistoricalImageCandidates([
    ...fairnessCandidates('high', 100, 1), ...fairnessCandidates('historical', 100, 3),
  ], 100);
  assert.deepEqual(fairnessCounts(noPermanent), { high: 89, historical: 11 });

  const noHistorical = selectFairHistoricalImageCandidates([
    ...fairnessCandidates('high', 100, 1), ...fairnessCandidates('permanent', 100, 2),
  ], 100);
  assert.deepEqual(fairnessCounts(noHistorical), { high: 89, permanent: 11 });

  const onlyHigh = selectFairHistoricalImageCandidates(fairnessCandidates('high', 101, 1), 100);
  assert.equal(onlyHigh.length, 100);
  assert.deepEqual(fairnessCounts(onlyHigh), { high: 100 });

  const shortHigh = selectFairHistoricalImageCandidates([
    ...fairnessCandidates('high', 50, 1),
    ...fairnessCandidates('permanent', 100, 2),
    ...fairnessCandidates('historical', 100, 3),
  ], 100);
  assert.deepEqual(fairnessCounts(shortHigh), { high: 50, permanent: 25, historical: 25 });

  assert.deepEqual(selectFairHistoricalImageCandidates(backlog, 0), []);
  for (let budget = 1; budget < 10; budget += 1) {
    const selected = selectFairHistoricalImageCandidates(backlog, budget);
    assert.ok(selected.length <= budget);
    assert.deepEqual(selected, selectFairHistoricalImageCandidates(backlog, budget));
  }

  const currentThenUpcoming = [
    { id: 'current-first', priority: { tier: 0, date: '2026-09-15' } },
    { id: 'current-second', priority: { tier: 0, date: '2026-09-15' } },
    { id: 'upcoming-near', priority: { tier: 1, date: '2026-09-16' } },
    { id: 'upcoming-later', priority: { tier: 1, date: '2026-09-20' } },
  ];
  assert.deepEqual(selectFairHistoricalImageCandidates(currentThenUpcoming, 4).map(({ id }) => id), [
    'current-first', 'current-second', 'upcoming-near', 'upcoming-later',
  ]);
});

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

test('historical Gencat image enrichment prioritizes current relevance before upcoming, durable, and expired records', async () => {
  await withTestDatabase(async (db) => {
    const rows = [
      record(FIRST_PATH, { codi: '202609150031', denominaci: 'Expired historical', data_inici: '2026-09-15T00:00:00.000', data_fi: '2026-09-15T00:00:00.000' }),
      record(FIRST_PATH, { codi: '202609150032', denominaci: 'Distant upcoming', data_inici: '2026-10-20T00:00:00.000', data_fi: '2026-10-20T00:00:00.000' }),
      record(FIRST_PATH, { codi: '202609150033', denominaci: 'Permanent activity', permanent: 'Si' }),
      record(FIRST_PATH, { codi: '202609150034', denominaci: 'Near upcoming', data_inici: '2026-09-16T00:00:00.000', data_fi: '2026-09-16T00:00:00.000' }),
      record(FIRST_PATH, { codi: '202609150035', denominaci: 'Current activity', data_inici: '2026-09-15T00:00:00.000', data_fi: '2026-09-15T00:00:00.000' }),
      record(FIRST_PATH, { codi: '202609150036', denominaci: 'Active long-running', data_inici: '2026-08-01T00:00:00.000', data_fi: '2026-10-01T00:00:00.000' }),
    ];
    const resolvedCodes = [];
    const metadata = { resolve: async ({ codi, imagePath }) => {
      resolvedCodes.push(codi);
      return { imagePath, attribution: null, attributionKnown: true };
    } };
    await importer(db, rows, metadata, { imagesEnabled: false }).run();
    db.prepare("UPDATE plans SET end_date = '2026-09-14' WHERE original_title = 'Expired historical'").run();

    await importer(db, rows, metadata, { historicalImageResolutionBudget: 6 }).run();
    assert.deepEqual(resolvedCodes, [
      '202609150035', '202609150036', '202609150034', '202609150032', '202609150033', '202609150031',
    ]);
  });
});

test('historical Gencat image priority follows enabled occurrence semantics used by public upcoming plans', async () => {
  await withTestDatabase(async (db) => {
    const current = record(FIRST_PATH, { codi: '202609150041', denominaci: 'Legacy current', data_inici: '2026-09-15T00:00:00.000', data_fi: '2026-09-15T00:00:00.000' });
    const occurrenceAware = record(FIRST_PATH, { codi: '202609150042', denominaci: 'Occurrence next', data_inici: '2026-09-15T00:00:00.000', data_fi: '2026-09-15T00:00:00.000' });
    const later = record(FIRST_PATH, { codi: '202609150043', denominaci: 'Legacy later', data_inici: '2026-09-17T00:00:00.000', data_fi: '2026-09-17T00:00:00.000' });
    const rows = [later, occurrenceAware, current];
    const resolvedCodes = [];
    const metadata = { resolve: async ({ codi, imagePath }) => {
      resolvedCodes.push(codi);
      return { imagePath, attribution: null, attributionKnown: true };
    } };
    await importer(db, rows, metadata, { imagesEnabled: false }).run();
    const sourceRecordId = importer(db, occurrenceAware, metadata).getExternalId(occurrenceAware);
    const sourceId = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get().id;
    const planSource = db.prepare('SELECT id FROM plan_sources WHERE source_id=? AND source_record_id=?').get(sourceId, sourceRecordId);
    new PlanOccurrenceRepository(db).upsert(planSource.id, {
      occurrenceKey: 'next-active-session', startsAt: '2026-09-16T18:00:00+02:00', endsAt: null,
      localDate: '2026-09-16', localTime: '18:00', timezone: 'Europe/Madrid', status: 'active',
    });
    new PlanOccurrenceRepository(db).upsert(planSource.id, {
      occurrenceKey: 'past-active-session', startsAt: '2026-09-14T18:00:00+02:00', endsAt: null,
      localDate: '2026-09-14', localTime: '18:00', timezone: 'Europe/Madrid', status: 'active',
    });

    await importer(db, rows, metadata, { historicalImageResolutionBudget: 3 }).run();
    assert.deepEqual(resolvedCodes, ['202609150041', '202609150042', '202609150043']);
  });
});

test('a budget of 100 resolves exactly 100 prioritized historical Gencat images and defers the remainder', async () => {
  await withTestDatabase(async (db) => {
    const rows = Array.from({ length: 101 }, (_, index) => record(FIRST_PATH, {
      codi: `20260916${String(index).padStart(4, '0')}`,
      denominaci: `Historical ${index}`,
      data_inici: '2026-09-20T00:00:00.000', data_fi: '2026-09-20T00:00:00.000',
    }));
    let resolutions = 0;
    const metadata = { resolve: async ({ imagePath }) => {
      resolutions += 1;
      return { imagePath, attribution: null, attributionKnown: true };
    } };
    await importer(db, rows, metadata, { imagesEnabled: false, pageSize: 200 }).run();
    const run = importer(db, rows, metadata, { pageSize: 200 });
    await run.run();
    assert.equal(resolutions, 100);
    assert.deepEqual(run.imageMetadataSummary(), {
      historicalResolutionBudget: 100, historicalResolutions: 100, deferredHistoricalResolutions: 1,
    });
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
