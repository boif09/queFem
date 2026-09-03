import assert from 'node:assert/strict';
import test from 'node:test';
import { DibaImporter, DIBA_FEEDS, municipalityIndex, normalizeDibaImportRecord } from '../backend/src/diba/dibaImporter.js';
import { DibaApiClient } from '../backend/src/diba/m0Discovery.js';
import { TicketmasterReconciliationRepository } from '../backend/src/db/repositories/ticketmasterReconciliation.repository.js';
import { parseArguments as parseDibaImportArguments } from '../backend/src/jobs/importDiba.js';
import { withTestDatabase } from './helpers.js';

const FEED = DIBA_FEEDS[0];
const WINDOW = { today: '2026-08-31', horizonEnd: '2027-08-31' };
const MUNICIPALITIES = new Map([['08121', {
  municipality: 'Mataró', comarca: 'Maresme', province: 'Barcelona',
  municipalityCode: '080121', comarcaCode: '21', provinceCode: '08',
}]]);

function raw(id, overrides = {}) {
  return {
    acte_id: String(id), titol: 'Concert de prova', descripcio: '<p>Text <strong>segur</strong></p>',
    data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 21:00:00',
    observacions_horari: '19 h', categoria: ['Concerts'],
    rel_municipis: { ine: '08121', municipi_nom: 'Mataró' },
    grup_adreca: { adreca_nom: 'Teatre', adreca: 'Carrer Major 1', localitzacio: '41.54,2.44' },
    acte_url: 'https://example.test/acte', imatge: 'https://diba.example/image.jpg',
    ...overrides,
  };
}
function client(recordsByDataset) { return { fetchDataset: async (dataset) => ({ records: recordsByDataset[dataset] || [] }) }; }

test('M1 normalizes selected feeds with stable, dataset-aware identity and official INE geography', () => {
  const tourism = normalizeDibaImportRecord(FEED, raw('99'), { ...WINDOW, municipalities: MUNICIPALITIES });
  const stage = normalizeDibaImportRecord(DIBA_FEEDS[1], raw('99'), { ...WINDOW, municipalities: MUNICIPALITIES });
  const museum = normalizeDibaImportRecord(DIBA_FEEDS[2], raw('99'), { ...WINDOW, municipalities: MUNICIPALITIES });
  assert.equal(tourism.candidate.plan.fingerprint, 'diba|actesturisme_ca|99');
  assert.equal(stage.candidate.plan.fingerprint, 'diba|escenari|99');
  assert.equal(museum.candidate.plan.fingerprint, 'diba|actesmuseus|99');
  assert.equal(tourism.candidate.plan.municipality, 'Mataró');
  assert.deepEqual(museum.candidate.categorySlugs, ['museus']);
  assert.deepEqual(stage.candidate.categorySlugs, ['musica']);
  assert.equal(tourism.candidate.plan.image_url, null);
  assert.equal(tourism.candidate.plan.ticket_url, null);
  assert.equal(tourism.candidate.occurrences.length, 0);
});

test('M1 rejects ended, invalid and missing-end records and leaves unresolved INE unassigned', () => {
  assert.equal(normalizeDibaImportRecord(FEED, raw('past', { data_inici: '2026-01-01', data_fi: '2026-08-30' }), { ...WINDOW, municipalities: MUNICIPALITIES }).state, 'historical');
  assert.equal(normalizeDibaImportRecord(FEED, raw('bad', { data_inici: 'bad' }), { ...WINDOW, municipalities: MUNICIPALITIES }).state, 'invalid');
  assert.equal(normalizeDibaImportRecord(FEED, raw('no-end', { data_fi: '' }), { ...WINDOW, municipalities: MUNICIPALITIES }).reason, 'missing end date semantics');
  const unresolved = normalizeDibaImportRecord(FEED, raw('unknown', { rel_municipis: { ine: '99999' } }), { ...WINDOW, municipalities: MUNICIPALITIES });
  assert.equal(unresolved.unresolvedMunicipality, true);
  assert.equal(unresolved.candidate.plan.municipality, null);
});

test('reviewed final DEFER preserves an existing DIBA source refresh while keeping its plan inactive', async () => {
  await withTestDatabase(async (db) => {
    const key = 'diba-tourisme:deferred-existing'; const now = () => new Date('2026-08-31T12:00:00Z');
    await new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('deferred-existing')] }), municipalities: MUNICIPALITIES, now, finalDeferredKeys: new Set([key]) }).run({ feeds: [FEED] });
    const source = db.prepare("SELECT ps.plan_id AS planId, ps.source_payload_json AS payload FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='diba-tourisme' AND ps.source_record_id='deferred-existing'").get();
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(source.planId).status, 'inactive');
    await new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('deferred-existing', { titol: 'Provenance refreshed' })] }), municipalities: MUNICIPALITIES, now, finalDeferredKeys: new Set([key]) }).run({ feeds: [FEED] });
    const after = db.prepare("SELECT p.status, ps.source_payload_json AS payload FROM plan_sources ps JOIN sources s ON s.id=ps.source_id JOIN plans p ON p.id=ps.plan_id WHERE s.key='diba-tourisme' AND ps.source_record_id='deferred-existing'").get();
    assert.equal(after.status, 'inactive'); assert.match(after.payload, /Provenance refreshed/);
  });
});

test('M1 client inherits pagination and duplicate-page protection', async () => {
  const response = (payload) => ({ ok: true, status: 200, headers: new Headers(), json: async () => payload });
  const records = [raw('1'), raw('2')];
  const api = new DibaApiClient({ pageSize: 1, delayMs: 0, fetchImpl: async (url) => {
    const start = Number(String(url).match(/pag-ini\/(\d+)/)[1]);
    return response({ entitats: 2, elements: [records[start - 1]] });
  } });
  assert.equal((await api.fetchDataset(FEED.dataset)).records.length, 2);
  const duplicate = new DibaApiClient({ pageSize: 1, delayMs: 0, fetchImpl: async () => response({ entitats: 2, elements: [raw('1')] }) });
  await assert.rejects(duplicate.fetchDataset(FEED.dataset), /repetit/);
});

test('dry-run is zero-write, while a confirmed Gencat match preserves image and commerce', async () => {
  await withTestDatabase(async (db) => {
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const now = '2026-08-31T10:00:00Z';
    const planId = Number(db.prepare(`INSERT INTO plans
      (kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,image_url,image_reuse_allowed,ticket_url,created_at,updated_at)
      VALUES ('event','gencat|same','Concert de prova','2026-09-10','2026-09-10','Mataró','Teatre','https://official.example/image.jpg',1,'https://affiliate.example',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
      VALUES (?,?, 'g-1','{}',?,?)`).run(planId, gencat.id, now, now);
    const importer = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('d-1')] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const before = db.prepare('SELECT COUNT(*) count FROM import_runs').get().count;
    const dry = await importer.run({ dryRun: true, feeds: [FEED] });
    assert.equal(dry.datasets[0].matchedExisting, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM import_runs').get().count, before);
    const actual = await importer.run({ feeds: [FEED] });
    assert.equal(actual.datasets[0].matchedExisting, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?').get(planId).count, 2);
    assert.deepEqual(db.prepare('SELECT image_url,image_reuse_allowed,ticket_url FROM plans WHERE id=?').get(planId), {
      image_url: 'https://official.example/image.jpg', image_reuse_allowed: 1, ticket_url: 'https://affiliate.example',
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_images').get().count, 0);
  });
});

test('ambiguous same-title match is not force-merged, cross-feed high match is attached, and guards isolate feeds', async () => {
  await withTestDatabase(async (db) => {
    const now = '2026-08-31T10:00:00Z';
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,created_at,updated_at)
      VALUES ('event','gencat|ambiguous','Concert de prova','2026-09-10','2026-09-10','Mataró',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?, 'amb','{}',?,?)`).run(planId, gencat.id, now, now);
    const importer = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('a', { grup_adreca: {} })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const first = await new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('a', { acte_url: 'https://shared.example', grup_adreca: {} })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') }).run({ feeds: [FEED] });
    assert.equal(first.datasets[0].ambiguous, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 2);

    const museums = DIBA_FEEDS[2];
    const second = new DibaImporter({ db, client: client({ [museums.dataset]: [raw('b', { acte_url: 'https://shared.example', grup_adreca: { adreca_nom: 'Teatre', adreca: 'Carrer Major 1' } })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const m = await second.run({ feeds: [museums] });
    assert.equal(m.datasets[0].internalDibaMatches, 1);

    const tourismSource = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?, 'old','{}',?,?)`).run(planId, tourismSource.id, now, now);
    const guarded = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('new')] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    await assert.rejects(guarded.run({ feeds: [FEED] }), /desired-set guard/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources WHERE source_id=? AND source_record_id='old'").get(tourismSource.id).count, 1);
  });
});

test('all DIBA source rows are registered disabled and one feed failure cannot reconcile another', async () => {
  await withTestDatabase(async (db) => {
    assert.deepEqual(db.prepare("SELECT key,enabled FROM sources WHERE key LIKE 'diba-%' ORDER BY key").all(), [
      { key: 'diba-escenari', enabled: 0 }, { key: 'diba-museus', enabled: 0 }, { key: 'diba-tourisme', enabled: 0 },
    ]);
    const importer = new DibaImporter({ db, client: { fetchDataset: async (dataset) => {
      if (dataset === 'escenari') throw new Error('HTTP 503');
      return { records: [raw(dataset)] };
    } }, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    await assert.rejects(importer.run({ feeds: [DIBA_FEEDS[0], DIBA_FEEDS[1]] }), /escenari \(HTTP 503\)/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='diba-tourisme'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='diba-escenari'").get().count, 0);
  });
});

test('dry-run simulates a Tourism-to-Museums link without mutating SQLite, exactly like a real sequential run', async () => {
  await withTestDatabase(async (db) => {
    const museums = DIBA_FEEDS[2];
    const records = {
      [FEED.dataset]: [raw('tourism-a', { acte_url: 'https://shared.example/event' })],
      [museums.dataset]: [raw('museum-b', { acte_url: 'https://shared.example/event' })],
    };
    const importer = new DibaImporter({ db, client: client(records), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const before = db.prepare('SELECT COUNT(*) count FROM plans').get().count;
    const dry = await importer.run({ dryRun: true, feeds: [FEED, museums] });
    assert.equal(dry.datasets[0].uniqueNewPublicPlans, 1);
    assert.equal(dry.datasets[1].linksToEarlierDibaPlans, 1);
    assert.equal(dry.datasets[1].uniqueNewPublicPlans, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, before);
    await importer.run({ feeds: [FEED, museums] });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key LIKE 'diba-%'").get().count, 2);
  });
});

test('repeat dry-run stages each existing DIBA plan exactly as the equivalent real repeat import', async () => {
  const museums = DIBA_FEEDS[2];
  const scenario = async (dryRun) => withTestDatabase(async (db) => {
    const now = '2026-08-31T10:00:00Z';
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const publicPlanId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,title_ca,description_ca,start_date,end_date,municipality,venue_name,image_url,image_reuse_allowed,ticket_url,status,created_at,updated_at)
      VALUES ('event','gencat|public','Acte public','Acte public','Text Gencat','2026-09-10','2026-09-10','Mataró','Teatre','https://official.example/image.jpg',1,'https://affiliate.example','inactive',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
      VALUES (?,?, 'public-1','https://public.example/event','{}',?,?)`).run(publicPlanId, gencat.id, now, now);
    const initial = {
      [FEED.dataset]: [raw('tourism-only', { titol: 'Concert inicial', acte_url: 'https://shared.example/event' }), raw('public-diba', { titol: 'Acte public', acte_url: 'https://public.example/event' })],
      [museums.dataset]: [raw('museum-existing', { titol: 'Concert inicial', acte_url: 'https://shared.example/event' })],
    };
    const repeat = {
      [FEED.dataset]: [raw('tourism-only', { titol: 'Concert actualitzat', acte_url: 'https://shared.example/event' }), raw('public-diba', { titol: 'Acte public', descripcio: '<p>Canvi DIBA inert</p>', acte_url: 'https://public.example/event' })],
      [museums.dataset]: [raw('museum-existing', { titol: 'Concert actualitzat', acte_url: 'https://shared.example/event' })],
    };
    const base = { db, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') };
    await new DibaImporter({ ...base, client: client(initial) }).run({ feeds: [FEED, museums] });
    const dibaOnlyBefore = db.prepare(`SELECT p.id,p.original_title FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id
      JOIN sources s ON s.id=ps.source_id WHERE s.key='diba-tourisme' AND ps.source_record_id='tourism-only'`).get();
    const publicBefore = db.prepare('SELECT original_title,title_ca,description_ca,image_url,ticket_url,status FROM plans WHERE id=?').get(publicPlanId);
    const sourceTargets = () => db.prepare(`SELECT s.key,ps.source_record_id,ps.plan_id FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
      WHERE (s.key='diba-tourisme' AND ps.source_record_id IN ('tourism-only','public-diba'))
        OR (s.key='diba-museus' AND ps.source_record_id='museum-existing') ORDER BY s.key,ps.source_record_id`).all();
    const publicSources = () => db.prepare(`SELECT s.key,ps.source_record_id FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
      WHERE ps.plan_id=? ORDER BY s.key,ps.source_record_id`).all(publicPlanId);
    const sourceTargetsBefore = sourceTargets();
    const publicSourcesBefore = publicSources();
    const planCountBeforeRepeat = db.prepare('SELECT COUNT(*) count FROM plans').get().count;
    const result = await new DibaImporter({ ...base, client: client(repeat) }).run({ dryRun, feeds: [FEED, museums] });
    const dibaOnlyAfter = db.prepare('SELECT id,original_title FROM plans WHERE id=?').get(dibaOnlyBefore.id);
    const publicAfter = db.prepare('SELECT original_title,title_ca,description_ca,image_url,ticket_url,status FROM plans WHERE id=?').get(publicPlanId);
    return {
      disposition: result.datasets.map(({ dataset, updatesOfExistingSameSourceRecord, linksToPreExistingPlans, linksToEarlierDibaPlans, uniqueNewPublicPlans, matchedExisting, primaryDisposition }) =>
        ({ dataset, updatesOfExistingSameSourceRecord, linksToPreExistingPlans, linksToEarlierDibaPlans, uniqueNewPublicPlans, matchedExisting, primaryDisposition })),
      planCountBeforeRepeat, planCountAfterRepeat: db.prepare('SELECT COUNT(*) count FROM plans').get().count,
      dibaOnlyBefore, dibaOnlyAfter, publicBefore, publicAfter,
      sourceTargetsBefore, sourceTargetsAfter: sourceTargets(), publicSourcesBefore, publicSourcesAfter: publicSources(), publicPlanId,
    };
  });

  const dry = await scenario(true);
  const actual = await scenario(false);
  assert.deepEqual(dry.disposition, actual.disposition);
  assert.equal(dry.disposition[0].uniqueNewPublicPlans, 0);
  assert.equal(dry.disposition[1].uniqueNewPublicPlans, 0);
  assert.equal(dry.disposition[0].updatesOfExistingSameSourceRecord, 2);
  assert.equal(dry.disposition[1].updatesOfExistingSameSourceRecord, 1);
  assert.ok(dry.disposition.every(({ primaryDisposition }) => primaryDisposition.invariantHolds));
  assert.equal(dry.planCountAfterRepeat, dry.planCountBeforeRepeat);
  assert.equal(actual.planCountAfterRepeat, actual.planCountBeforeRepeat);
  assert.equal(actual.dibaOnlyAfter.id, actual.dibaOnlyBefore.id);
  assert.equal(actual.dibaOnlyAfter.original_title, 'Concert actualitzat');
  assert.deepEqual(actual.sourceTargetsAfter, actual.sourceTargetsBefore);
  assert.equal(actual.sourceTargetsBefore.find(({ source_record_id: id }) => id === 'museum-existing').plan_id, actual.dibaOnlyBefore.id);
  assert.equal(actual.sourceTargetsBefore.find(({ source_record_id: id }) => id === 'tourism-only').plan_id, actual.dibaOnlyBefore.id);
  assert.equal(actual.sourceTargetsBefore.find(({ source_record_id: id }) => id === 'public-diba').plan_id, actual.publicPlanId);
  assert.deepEqual(actual.publicSourcesBefore, [
    { key: 'diba-tourisme', source_record_id: 'public-diba' },
    { key: 'gencat-agenda', source_record_id: 'public-1' },
  ]);
  assert.deepEqual(actual.publicSourcesAfter, actual.publicSourcesBefore);
  assert.deepEqual(actual.publicAfter, actual.publicBefore);
});

test('dry-run exposes only the latest effective state of a plan to a third feed', async () => {
  await withTestDatabase(async (db) => {
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    const now = '2026-08-31T10:00:00Z';
    const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,created_at,updated_at)
      VALUES ('event','diba|actesturisme_ca|successive','Estat inicial','2026-09-10','2026-09-10','Mataró','Teatre',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
      VALUES (?,?,?,'https://shared.example/successive','{}',?,?)`).run(planId, source.id, 'successive', now, now);
    const tourismSnapshots = [
      [raw('successive', { titol: 'Estat antic', acte_url: 'https://shared.example/successive' })],
      [raw('successive', { titol: 'Estat efectiu', acte_url: 'https://shared.example/successive' })],
    ];
    const importer = new DibaImporter({
      db,
      client: { fetchDataset: async (dataset) => ({ records: dataset === FEED.dataset
        ? tourismSnapshots.shift()
        : [raw('third', { titol: 'Estat antic', acte_url: 'https://shared.example/successive' })] }) },
      municipalities: MUNICIPALITIES,
      now: () => new Date('2026-08-31T12:00:00Z'),
    });
    const result = await importer.run({ dryRun: true, feeds: [FEED, FEED, DIBA_FEEDS[2]] });
    assert.equal(result.datasets[0].updatesOfExistingSameSourceRecord, 1);
    assert.equal(result.datasets[1].updatesOfExistingSameSourceRecord, 1);
    assert.equal(result.datasets[2].matchedExisting, 0);
    assert.equal(result.datasets[2].linksToPreExistingPlans, 0);
    assert.equal(result.datasets[2].uniqueNewPublicPlans, 1);
    assert.equal(db.prepare('SELECT original_title FROM plans WHERE id=?').get(planId).original_title, 'Estat inicial');
  });
});

test('disabled DIBA staging is provenance-only for a public plan, then enriches only after activation', async () => {
  await withTestDatabase(async (db) => {
    const now = '2026-08-31T10:00:00Z';
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,description_ca,ticket_url,status,created_at,updated_at)
      VALUES ('event','gencat|staged','Concert de prova','2026-09-10','2026-09-10','Mataró','Teatre',NULL,'https://affiliate.example','inactive',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?, 'g-stage','{}',?,?)`).run(planId, gencat.id, now, now);
    const importer = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('stage', { descripcio: '<p>Enriquiment DIBA</p>' })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    await importer.run({ feeds: [FEED] });
    assert.deepEqual(db.prepare('SELECT description_ca,ticket_url,status,updated_at FROM plans WHERE id=?').get(planId), {
      description_ca: null, ticket_url: 'https://affiliate.example', status: 'inactive', updated_at: now,
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_categories WHERE plan_id=?').get(planId).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.key='diba-tourisme'").get(planId).count, 1);
    db.prepare("UPDATE sources SET enabled=1 WHERE key='diba-tourisme'").run();
    await importer.run({ feeds: [FEED] });
    assert.equal(db.prepare('SELECT description_ca FROM plans WHERE id=?').get(planId).description_ca, 'Enriquiment DIBA');
    assert.equal(db.prepare('SELECT ticket_url FROM plans WHERE id=?').get(planId).ticket_url, 'https://affiliate.example');
  });
});

test('import runs distinguish acquisition, precommit and postcommit failures', async () => {
  await withTestDatabase(async (db) => {
    const base = { db, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') };
    await assert.rejects(new DibaImporter({ ...base, client: { fetchDataset: async () => { throw new Error('HTTP 503'); } } }).run({ feeds: [FEED] }), /HTTP 503/);
    let run = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT 1").get();
    assert.equal(run.status, 'failed'); assert.equal(JSON.parse(run.summary_json).catalogCommitted, false);
    await assert.rejects(new DibaImporter({ ...base, client: { fetchDataset: async () => { throw new Error('duplicate pagination page'); } } }).run({ feeds: [FEED] }), /duplicate pagination page/);
    run = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT 1").get();
    assert.equal(run.status, 'failed'); assert.equal(JSON.parse(run.summary_json).catalogCommitted, false);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('pre')] }), beforePersist: () => { throw new Error('before commit'); } }).run({ feeds: [FEED] }), /before commit/);
    run = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT 1").get();
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, false); assert.equal(run.inserted, 0);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('post')] }), postCommitCheck: () => 'corrupt' }).run({ feeds: [FEED] }), /integrity_check/);
    run = db.prepare("SELECT * FROM import_runs ORDER BY id DESC LIMIT 1").get();
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, true); assert.ok(run.inserted > 0);
  });
});

test('reconciliation guard uses only reconciliable rows, permits exactly half and requires an explicit mass-removal override', async () => {
  await withTestDatabase(async (db) => {
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    const now = '2026-08-31T10:00:00Z';
    const add = (id, start, end) => {
      const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,created_at,updated_at) VALUES ('event',?,?,?,?,?,?,?)`)
        .run(`old|${id}`, `Old ${id}`, start, end, 'Mataró', now, now).lastInsertRowid);
      db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)`).run(planId, source.id, id, now, now);
    };
    add('historic', '2026-01-01', '2026-08-01'); add('keep', '2026-09-10', '2026-09-10'); add('remove', '2026-09-11', '2026-09-11');
    const importer = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('keep')] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const half = await importer.run({ dryRun: true, feeds: [FEED] });
    assert.equal(half.datasets[0].reconciliableExistingSourceRecords, 2);
    assert.equal(half.datasets[0].plannedRemovals, 1);
    add('remove-2', '2026-09-12', '2026-09-12');
    await assert.rejects(importer.run({ feeds: [FEED] }), /desired-set guard/);
    const rejectedRun = db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 1').get();
    assert.equal(rejectedRun.status, 'failed');
    assert.equal(JSON.parse(rejectedRun.summary_json).catalogCommitted, false);
    const reviewed = await importer.run({ feeds: [FEED], allowMassRemoval: true });
    assert.equal(reviewed.datasets[0].allowMassRemovalUsed, true);
    assert.equal(reviewed.datasets[0].removed, 2);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE source_id=?').get(source.id).count, 2);
  });
});

test('rich dry-run diagnostics retain unresolved INE details and guided visits are not classified as museums', async () => {
  await withTestDatabase(async (db) => {
    const normalized = normalizeDibaImportRecord(FEED, raw('visit', { titol: 'Visita guiada urbana', categoria: ['Visita guiada'] }), { ...WINDOW, municipalities: MUNICIPALITIES });
    assert.deepEqual(normalized.candidate.categorySlugs, ['cultura']);
    const importer = new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('unresolved', { rel_municipis: {}, grup_adreca: {} })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') });
    const result = await importer.run({ dryRun: true, feeds: [FEED] });
    assert.deepEqual(result.datasets[0].unresolvedMunicipalityDetails[0], {
      dataset: FEED.dataset, acteId: 'unresolved', title: 'Concert de prova', rawMunicipalityName: null,
      rawMunicipalityIne: null, coordinates: null, reason: 'rel_municipis.ine is absent or empty',
    });
  });
});

test('feed-level dry-run staging never merges same-feed records, but reports them for review and exposes them to the next feed', async () => {
  await withTestDatabase(async (db) => {
    const museums = DIBA_FEEDS[2];
    const records = {
      [FEED.dataset]: [raw('same-a', { acte_url: 'https://same.example' }), raw('same-b', { acte_url: 'https://same.example' })],
      [museums.dataset]: [raw('later', { acte_url: 'https://same.example' })],
    };
    const result = await new DibaImporter({ db, client: client(records), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') })
      .run({ dryRun: true, feeds: [FEED, museums] });
    assert.equal(result.datasets[0].uniqueNewPublicPlans, 2);
    assert.equal(result.datasets[0].sameFeedPotentialDuplicateRecords, 2);
    assert.equal(result.datasets[0].sameFeedPotentialDuplicateClusters.length, 1);
    assert.equal(result.datasets[0].sameFeedPotentialDuplicateClusters[0].classification, 'NEEDS REVIEW');
    assert.match(result.datasets[0].sameFeedPotentialDuplicateClusters[0].evidence.reason, /matching URL/);
    assert.doesNotMatch(result.datasets[0].sameFeedPotentialDuplicateClusters[0].evidence.reason, /but no matching/);
    assert.equal(result.datasets[1].linksToEarlierDibaPlans, 1);
    assert.equal(result.datasets[0].primaryDisposition.invariantHolds, true);
  });
});

test('disabled-source reconciliation inactivates only a source-less DIBA plan and preserves a shared plan status', () => {
  withTestDatabase((db) => {
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const now = '2026-08-31T10:00:00Z';
    const makePlan = (fingerprint, status) => Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,status,created_at,updated_at)
      VALUES ('event',?,'x','2026-09-10','2026-09-10',?,?,?)`).run(fingerprint, status, now, now).lastInsertRowid);
    const onlyDiba = makePlan('only-diba', 'active'); const shared = makePlan('shared-diba', 'inactive');
    for (const [planId, sourceId, recordId] of [[onlyDiba, source.id, 'only'], [shared, source.id, 'shared'], [shared, gencat.id, 'g']]) {
      db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)`).run(planId, sourceId, recordId, now, now);
    }
    new TicketmasterReconciliationRepository(db).reconcile(source.id, new Set(), '2026-08-31', '2027-08-31', { preservePlanStatus: true, removedAt: now });
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(onlyDiba).status, 'inactive');
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(shared).status, 'inactive');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE plan_id=?').get(onlyDiba).count, 0);
  });
});

test('current-snapshot parser health rejects identity/date failures but does not reject a healthy seasonal lower volume', async () => {
  await withTestDatabase(async (db) => {
    const base = { db, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') };
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    const now = '2026-08-31T10:00:00Z';
    db.prepare(`INSERT INTO import_runs (source_id,started_at,finished_at,status,summary_json) VALUES (?,? ,?,'completed',?)`)
      .run(source.id, now, now, JSON.stringify({ eligibleSourceRecords: 10_000 }));
    const healthy = await new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('seasonal-low')] }) }).run({ dryRun: true, feeds: [FEED] });
    assert.equal(healthy.datasets[0].eligibleSourceRecords, 1);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('missing-id', { acte_id: '' })] }) }).run({ dryRun: true, feeds: [FEED], allowMassRemoval: true }), /parser health guard/);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('bad-date', { data_inici: 'broken', data_fi: 'broken' })] }) }).run({ dryRun: true, feeds: [FEED] }), /parser health guard/);
  });
});

test('actionable parser health rejects a title collapse hidden behind valid historical rows, even with removal override', async () => {
  await withTestDatabase(async (db) => {
    const base = { db, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') };
    const historical = Array.from({ length: 40 }, (_, index) => raw(`historical-${index}`, { data_inici: '2026-01-01', data_fi: '2026-01-02' }));
    const damagedCurrent = Array.from({ length: 10 }, (_, index) => raw(`damaged-${index}`, { titol: '', data_inici: '2026-09-10', data_fi: '2026-09-10' }));
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [...historical, ...damagedCurrent] }) })
      .run({ dryRun: true, feeds: [FEED], allowMassRemoval: true }), /actionable-semantic ratios/);
    const healthyCurrent = Array.from({ length: 10 }, (_, index) => raw(`healthy-${index}`, { data_inici: '2026-09-10', data_fi: '2026-09-10' }));
    const healthy = await new DibaImporter({ ...base, client: client({ [FEED.dataset]: [...historical, ...healthyCurrent] }) })
      .run({ dryRun: true, feeds: [FEED] });
    assert.equal(healthy.datasets[0].normalization.actionableNormalizationRatio, 1);
    assert.equal(healthy.datasets[0].eligibleSourceRecords, healthyCurrent.length);
  });
});

test('actionable parser health counts damaged dates for currently reconciliable IDs despite historical volume', async () => {
  await withTestDatabase(async (db) => {
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get();
    const now = '2026-08-31T10:00:00Z';
    const damaged = Array.from({ length: 5 }, (_, index) => `damaged-date-${index}`);
    for (const id of damaged) {
      const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,created_at,updated_at)
        VALUES ('event',?,?,?,?,?,?,?)`).run(`old|${id}`, `Old ${id}`, '2026-09-10', '2026-09-10', 'Mataró', now, now).lastInsertRowid);
      db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
        VALUES (?,?,?,'{}',?,?)`).run(planId, source.id, id, now, now);
    }
    const historical = Array.from({ length: 40 }, (_, index) => raw(`historical-date-${index}`, { data_inici: '2026-01-01', data_fi: '2026-01-02' }));
    const healthyCurrent = Array.from({ length: 4 }, (_, index) => raw(`healthy-date-${index}`));
    const damagedCurrent = damaged.map((id) => raw(id, { data_inici: 'broken', data_fi: 'broken' }));
    const records = [...historical, ...healthyCurrent, ...damagedCurrent];
    const makeImporter = () => new DibaImporter({
      db, client: client({ [FEED.dataset]: records }), municipalities: MUNICIPALITIES,
      now: () => new Date('2026-08-31T12:00:00Z'),
    });
    for (const allowMassRemoval of [false, true]) {
      await assert.rejects(makeImporter().run({ feeds: [FEED], allowMassRemoval }), /parser health guard/);
      const failedRun = db.prepare('SELECT status,summary_json FROM import_runs ORDER BY id DESC LIMIT 1').get();
      const normalization = JSON.parse(failedRun.summary_json).normalization;
      assert.equal(failedRun.status, 'failed');
      assert.ok(normalization.dateSemanticsRatio > 0.5);
      assert.equal(normalization.reconciliableDateFailures, damaged.length);
      assert.equal(normalization.actionableNormalizationRatio, healthyCurrent.length / (healthyCurrent.length + damaged.length));
    }
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_sources WHERE source_id=?').get(source.id).count, damaged.length);
  });
});

test('DIBA mass-removal override is explicit CLI input only', () => {
  assert.deepEqual(parseDibaImportArguments([]), { dryRun: false, allowMassRemoval: false });
  assert.deepEqual(parseDibaImportArguments(['--allow-mass-removal']), { dryRun: false, allowMassRemoval: true });
  assert.throws(() => parseDibaImportArguments(['DIBA_ALLOW_MASS_REMOVAL=true']), /Unknown argument/);
});

test('import run records empty, guard, transaction and successful outcomes accurately', async () => {
  await withTestDatabase(async (db) => {
    const base = { db, municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') };
    const latest = () => db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 1').get();
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [] }) }).run({ feeds: [FEED] }), /empty snapshot/);
    assert.equal(JSON.parse(latest().summary_json).catalogCommitted, false);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('invalid-normalized', { data_inici: 'broken', data_fi: 'broken' })] }) }).run({ feeds: [FEED] }), /parser health guard/);
    assert.equal(JSON.parse(latest().summary_json).catalogCommitted, false);
    await assert.rejects(new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('transaction')] }), insideTransaction: () => { throw new Error('transaction boom'); } }).run({ feeds: [FEED] }), /transaction boom/);
    assert.equal(JSON.parse(latest().summary_json).catalogCommitted, false); assert.equal(latest().inserted, 0);
    const success = await new DibaImporter({ ...base, client: client({ [FEED.dataset]: [raw('success')] }) }).run({ feeds: [FEED] });
    assert.equal(success.datasets[0].catalogCommitted, true);
    assert.equal(latest().status, 'completed'); assert.ok(latest().inserted > 0);
  });
});

test('rich ambiguity fields and museum/patrimony category evidence are explicit', async () => {
  await withTestDatabase(async (db) => {
    const now = '2026-08-31T10:00:00Z'; const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const planId = Number(db.prepare(`INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,created_at,updated_at)
      VALUES ('event','amb-rich','Concert de prova','2026-09-10','2026-09-10','Mataró',?,?)`).run(now, now).lastInsertRowid);
    db.prepare(`INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?, 'rich','{}',?,?)`).run(planId, gencat.id, now, now);
    const result = await new DibaImporter({ db, client: client({ [FEED.dataset]: [raw('amb-rich', { grup_adreca: {} })] }), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z') }).run({ dryRun: true, feeds: [FEED] });
    const detail = result.datasets[0].ambiguousDetails[0];
    assert.equal(detail.diba.dataset, FEED.dataset); assert.equal(detail.diba.acteId, 'amb-rich'); assert.equal(detail.candidatePlan.id, planId);
    assert.equal(detail.evidence.titleExact, true); assert.equal(detail.evidence.municipalityMatch, true); assert.equal(detail.evidence.dateOverlap, true); assert.match(detail.evidence.reason, /no matching/);
    assert.deepEqual(detail.candidatePlan.enabledSources, ['gencat-agenda']);
    assert.deepEqual(normalizeDibaImportRecord(FEED, raw('museum', { titol: 'Visita al museu', categoria: ['Visita'] }), { ...WINDOW, municipalities: MUNICIPALITIES }).candidate.categorySlugs, ['museus']);
    assert.deepEqual(normalizeDibaImportRecord(FEED, raw('heritage', { titol: 'Visita guiada al monument', categoria: ['Visita'] }), { ...WINDOW, municipalities: MUNICIPALITIES }).candidate.categorySlugs, ['patrimoni']);
  });
});
