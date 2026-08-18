import assert from 'node:assert/strict';
import test from 'node:test';
import { GencatAgendaImporter } from '../backend/src/importers/gencatAgenda.importer.js';
import { withTestDatabase } from './helpers.js';

const record = {
  codi: '20260817001',
  denominaci: 'Concert de prova',
  descripcio: 'Descripció original',
  data_inici: '2026-08-17T00:00:00.000',
  data_fi: '2026-08-17T00:00:00.000',
  tags_mbits: 'agenda:ambits/musica',
  municipi: 'agenda:ubicacions/barcelona/barcelones/barcelona',
  comarca: 'agenda:ubicacions/barcelona/barcelones',
  espai: 'Auditori',
  imatges: '/content/dam/agenda/not-reusable.jpg',
  data_creacio: '2026-08-01T10:00:00.000',
};

function officialFetch(input) {
  const url = String(input);
  if (url.includes('/api/views/')) {
    return Promise.resolve(new Response(JSON.stringify({
      id: 'rhpv-yr4f',
      rowsUpdatedAt: 1786924800,
      columns: [{ fieldName: 'codi' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return Promise.resolve(new Response(JSON.stringify([record]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
}

test('imports a real-shaped row and skips it when the payload is unchanged', async () => {
  await withTestDatabase(async (db) => {
    const options = {
      db,
      fetchImpl: officialFetch,
      pageSize: 10,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    };
    const first = new GencatAgendaImporter(options);
    assert.deepEqual(await first.run(), {
      fetched: 1, inserted: 1, updated: 0, skipped: 0, invalid: 0, errors: 0,
    });

    const second = new GencatAgendaImporter(options);
    assert.deepEqual(await second.run(), {
      fetched: 1, inserted: 0, updated: 0, skipped: 1, invalid: 0, errors: 0,
    });

    const plan = db.prepare('SELECT * FROM plans').get();
    const provenance = db.prepare('SELECT * FROM plan_sources').get();
    assert.equal(plan.image_url, null);
    assert.equal(plan.original_description, record.descripcio);
    assert.equal(JSON.parse(provenance.source_payload_json).imatges, undefined);
    assert.equal(provenance.source_created_at, record.data_creacio);
    assert.match(provenance.source_record_id, /^20260817001@[a-f0-9]{16}$/);
  });
});

test('uses distinct provenance identities for different payloads at the same location', () => {
  withTestDatabase((db) => {
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl: officialFetch,
      pageSize: 10,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const variant = { ...record, tags_mbits: 'agenda:ambits/musica,agenda:ambits/divulgacio' };
    assert.notEqual(importer.getExternalId(record), importer.getExternalId(variant));
    assert.equal(importer.getExternalId(record), importer.getExternalId({ ...record }));
    assert.equal(importer.getExternalId(record), importer.getExternalId({ ...record, imatges: '/other.jpg' }));
  });
});

test('requests only retained official records and defensively skips an expired row', async () => {
  await withTestDatabase(async (db) => {
    const requestedUrls = [];
    const expired = {
      ...record,
      codi: '20200101001',
      denominaci: 'Activitat antiga',
      data_inici: '2020-01-01T00:00:00.000',
      data_fi: '2020-01-02T00:00:00.000',
    };
    const permanent = {
      ...expired,
      codi: '20200101002',
      denominaci: 'Activitat permanent',
      permanent: 'Sí',
    };
    const fetchImpl = (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/api/views/')) return officialFetch(input);
      return Promise.resolve(new Response(JSON.stringify([expired, permanent]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    };
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl,
      pageSize: 10,
      retentionDays: 0,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });

    assert.deepEqual(await importer.run(), {
      fetched: 2, inserted: 1, updated: 0, skipped: 1, invalid: 0, errors: 0,
    });
    const dataUrl = new URL(requestedUrls.find((url) => url.includes('/resource/')));
    assert.equal(dataUrl.searchParams.get('$where'), [
      "data_fi >= '2026-08-17T00:00:00.000'",
      "(data_fi IS NULL AND data_inici >= '2026-08-17T00:00:00.000')",
      "permanent = 'Sí'",
    ].join(' OR '));
    assert.deepEqual(
      db.prepare('SELECT original_title, permanent FROM plans').all(),
      [{ original_title: 'Activitat permanent', permanent: 1 }],
    );
  });
});

test('excludes explicit outside locations and keeps a Catalonia plan without coordinates', async () => {
  await withTestDatabase(async (db) => {
    const outsideCatalonia = {
      ...record,
      codi: '20260817002',
      denominaci: 'Activitat fora de Catalunya',
      municipi: 'agenda:ubicacions/fora-catalunya/fora-espanya',
      comarca: 'agenda:ubicacions/fora-catalunya/fora-espanya',
    };
    const outsideSpain = {
      ...record,
      codi: '20260817003',
      denominaci: 'Activitat fora d’Espanya',
      municipi: 'agenda:ubicacions/barcelona/fora-espanya',
      comarca: 'agenda:ubicacions/barcelona/fora-espanya',
    };
    const cataloniaWithoutCoordinates = {
      ...record,
      codi: '20260817004',
      denominaci: 'Activitat catalana sense coordenades',
      latitud: undefined,
      longitud: undefined,
    };
    const fetchImpl = (input) => {
      const url = String(input);
      if (url.includes('/api/views/')) return officialFetch(input);
      return Promise.resolve(new Response(JSON.stringify([
        outsideCatalonia,
        outsideSpain,
        cataloniaWithoutCoordinates,
      ]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    };
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl,
      pageSize: 10,
      retentionDays: 0,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });

    assert.deepEqual(await importer.run(), {
      fetched: 3, inserted: 1, updated: 0, skipped: 2, invalid: 0, errors: 0,
    });
    const imported = db.prepare(`
      SELECT original_title, province, comarca, latitude, longitude FROM plans
    `).all();
    assert.deepEqual(imported, [{
      original_title: 'Activitat catalana sense coordenades',
      province: 'Barcelona',
      comarca: 'Barcelones',
      latitude: null,
      longitude: null,
    }]);
  });
});

test('counts incoherent dates as invalid and stores auditable details', async () => {
  await withTestDatabase(async (db) => {
    const espaiVapor = {
      ...record,
      codi: 'TEMPORAL-2924',
      denominaci: 'Espai Vapor',
      data_inici: '2024-06-28T00:00:00.000',
      data_fi: '2924-06-30T00:00:00.000',
    };
    const reversed = {
      ...record,
      codi: 'TEMPORAL-REVERSED',
      denominaci: 'Dates invertides',
      data_inici: '2026-10-02T00:00:00.000',
      data_fi: '2026-10-01T00:00:00.000',
    };
    const valid = {
      ...record,
      codi: 'TEMPORAL-VALID',
      denominaci: 'Exposició de dos anys',
      data_inici: '2026-08-17T00:00:00.000',
      data_fi: '2028-08-17T00:00:00.000',
    };
    const warnings = [];
    const fetchImpl = (input) => {
      if (String(input).includes('/api/views/')) return officialFetch(input);
      return Promise.resolve(new Response(JSON.stringify([espaiVapor, reversed, valid]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    };
    const importer = new GencatAgendaImporter({
      db,
      fetchImpl,
      pageSize: 10,
      retentionDays: 0,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
      logger: { warn(message) { warnings.push(message); } },
    });

    assert.deepEqual(await importer.run(), {
      fetched: 3, inserted: 1, updated: 0, skipped: 2, invalid: 2, errors: 0,
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 1);
    assert.ok(warnings.some((message) => (
      message.includes('TEMPORAL-2924') && message.includes('EXTREME_FUTURE_DATE')
    )));
    assert.ok(warnings.some((message) => (
      message.includes('TEMPORAL-REVERSED') && message.includes('END_BEFORE_START')
    )));

    const run = db.prepare(`
      SELECT skipped, invalid, invalid_details FROM import_runs ORDER BY id DESC LIMIT 1
    `).get();
    assert.equal(run.skipped, 2);
    assert.equal(run.invalid, 2);
    const details = JSON.parse(run.invalid_details);
    assert.deepEqual(details.map(({ source_record_id, reason }) => ({ source_record_id, reason })), [
      { source_record_id: 'TEMPORAL-2924', reason: 'EXTREME_FUTURE_DATE' },
      { source_record_id: 'TEMPORAL-REVERSED', reason: 'END_BEFORE_START' },
    ]);
  });
});
