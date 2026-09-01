import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DibaApiClient, classifyDate, clusterDibaCandidates, localBaselineWarning,
  matchDibaToLocal, normalizeDibaRecord,
} from '../backend/src/diba/m0Discovery.js';

function response(payload) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => payload };
}

function dibaRecord(id, overrides = {}) {
  return {
    acte_id: String(id), titol: 'Concert de prova', data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 20:00:00',
    grup_adreca: { municipi_nom: 'Mataró', adreca_nom: 'Teatre', localitzacio: '41.54,2.44' },
    rel_municipis: { ine: '08121', municipi_nom: 'Mataró', grup_comarca: { comarca_nom: 'Maresme' } },
    ...overrides,
  };
}

test('DIBA pagination fetches records beyond the default 1000 without truncation', async () => {
  const records = Array.from({ length: 1001 }, (_, index) => dibaRecord(index + 1));
  const client = new DibaApiClient({ pageSize: 1000, delayMs: 0, fetchImpl: async (url) => {
    const start = Number(String(url).match(/pag-ini\/(\d+)/)[1]);
    return response({ entitats: 1001, elements: records.slice(start - 1, start + 999) });
  } });
  const result = await client.fetchDataset('actesturisme_ca');
  assert.equal(result.records.length, 1001);
  assert.equal(result.pageStats.length, 2);
});

test('DIBA catalog accepts the live object-with-numeric-keys response shape', async () => {
  const client = new DibaApiClient({ fetchImpl: async () => response({
    0: { machinename: 'actesturisme_ca', tipus: 'acte' }, cache: { generated: true },
  }) });
  assert.deepEqual((await client.listDatasets()).map((dataset) => dataset.machinename), ['actesturisme_ca']);
});

test('DIBA pagination rejects duplicate records rather than silently accepting incomplete pages', async () => {
  const client = new DibaApiClient({ pageSize: 1, delayMs: 0, fetchImpl: async () => response({ entitats: 2, elements: [dibaRecord(1)] }) });
  await assert.rejects(client.fetchDataset('actesturisme_ca'), /repetit/);
});

test('date horizon includes ongoing intervals, excludes historical records and reports invalid dates', () => {
  const window = { today: '2026-08-31', horizonEnd: '2027-08-31' };
  assert.equal(classifyDate(normalizeDibaRecord('a', dibaRecord(1, { data_inici: '2026-08-01', data_fi: '2026-09-02' })), window), 'candidate');
  assert.equal(classifyDate(normalizeDibaRecord('a', dibaRecord(2, { data_inici: '2026-08-01', data_fi: '2026-08-30' })), window), 'historical');
  assert.equal(classifyDate(normalizeDibaRecord('a', dibaRecord(3, { data_inici: 'bad-date' })), window), 'invalid');
  assert.equal(classifyDate(normalizeDibaRecord('a', dibaRecord(4, { data_inici: '2027-09-01' })), window), 'outside_horizon');
  assert.equal(classifyDate(normalizeDibaRecord('a', dibaRecord(5, { data_inici: '' })), window), 'undated');
});

test('a record whose end date is before today can never enter the current/future candidate set', () => {
  const record = normalizeDibaRecord('actesmuseus', dibaRecord('ended', {
    data_inici: '2026-01-12 00:00:00', data_fi: '2026-08-30 23:59:59',
  }));
  assert.equal(classifyDate(record, { today: '2026-08-31', horizonEnd: '2027-08-31' }), 'historical');
});

test('DIBA normalization is deterministic and retains official municipality identifiers', () => {
  const first = normalizeDibaRecord('actesturisme_ca', dibaRecord('stable'));
  const second = normalizeDibaRecord('actesturisme_ca', dibaRecord('stable'));
  assert.deepEqual(first, second);
  assert.equal(first.id, 'stable');
  assert.equal(first.municipalityCode, '08121');
  assert.deepEqual(first.coordinates, { latitude: 41.54, longitude: 2.44 });
});

test('internal matching classifies cross-dataset exact title, municipality and interval overlap as high confidence', () => {
  const first = normalizeDibaRecord('actesturisme_ca', dibaRecord('a'));
  const second = normalizeDibaRecord('actesmuseus', dibaRecord('b'));
  const clusters = clusterDibaCandidates([first, second]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].confidence, 'high');
});

test('local overlap matching is read-only data comparison and distinguishes high from possible matches', () => {
  const cluster = clusterDibaCandidates([normalizeDibaRecord('actesturisme_ca', dibaRecord('a'))]);
  const matches = matchDibaToLocal(cluster, [{
    id: 88, title: 'Concert de prova', municipality: 'Mataró', venue: 'Teatre', startDate: '2026-09-10', endDate: '2026-09-10', urls: [], sources: ['gencat-agenda'],
  }]);
  assert.equal(matches[0].level, 'high');
  assert.equal(matches[0].matches[0].sources[0], 'gencat-agenda');
  assert.match(localBaselineWarning(), /completitud respecto a producción es desconocida/);
});
