import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FeverImporter } from '../backend/src/importers/fever.importer.js';
import { PlanQueryRepository } from '../backend/src/db/repositories/planQuery.repository.js';
import { assertTemporaryDatabasePath, importFeverTemp } from '../backend/src/jobs/importFeverTemp.js';
import { withTestDatabase } from './helpers.js';

const NOW = new Date('2026-08-25T10:00:00Z');
const resolver = {
  metadata: { provider: 'ICGC', dataset: 'Divisions administratives', datasetDate: '2026-01-20', layer: 'municipis_5000' },
  resolve({ longitude }) {
    if (longitude === 9) return { status: 'ambiguous', candidates: [] };
    if (longitude > 2) return { status: 'unresolved', candidates: [] };
    return {
      status: 'match', municipality: { code: '080193', name: 'Barcelona' },
      comarca: { code: '13', name: 'Barcelonès' }, province: { code: '08', name: 'Barcelona' },
    };
  },
};

function item(id, {
  manufacturer = '2026-08-25 10:00,2026-08-26 10:00,2026-08-27 10:00',
  longitude = 1.5, name = `Fever ${id}`, description = 'Clean description',
  material = 'Venue', address = 'Address', url = `https://fever.pxf.io/product-${id}`,
  category = 'Tier 4', price = 12,
} = {}) {
  return {
    CatalogItemId: String(id), CatalogId: '15532', CampaignId: '16345', ParentName: 'Catalonia',
    Name: name, Description: description, Material: material, ShippingLabel: address,
    Pattern: `(41.5; ${longitude})`, Text1: 'Spain', Text2: 'Barcelona', Url: url,
    Manufacturer: manufacturer, Category: category, CurrentPrice: price, Currency: 'EUR',
    Labels: ['from €12'], Colors: [`https://feverup.com/m/${id}`], ImageUrl: 'https://example.test/image',
    SubCategory: 'Sailing', LaunchDate: '2026-01-01', ExpirationDate: '2027-01-01',
  };
}

function download(items) { return { pages: 1, items }; }
function importer(db, options = {}) {
  return new FeverImporter({
    db, resolver, snapshotChecksum: 'a'.repeat(64), lookaheadDays: 365, now: () => NOW, ...options,
  });
}

test('persists resolved and unresolved Fever-only plans with source geography and affiliate URL', async () => {
  await withTestDatabase(async (db) => {
    const summary = await importer(db).run(download([item('land'), item('sea', {
      longitude: 2.2, material: 'Sailing', address: 'Moll de Mestral',
      manufacturer: '2026-08-25 10:00,2026-08-26 10:00,2026-08-29 10:00',
    })]));
    assert.equal(summary.inserted, 2);
    assert.equal(summary.resolved, 1);
    assert.equal(summary.unresolved, 1);
    const sea = db.prepare("SELECT p.*,ps.id source_link_id,ps.source_url,ps.source_payload_json FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id WHERE ps.source_record_id='sea'").get();
    assert.equal(sea.status, 'active');
    assert.equal(sea.venue_name, 'Sailing');
    assert.equal(sea.address, 'Moll de Mestral');
    assert.equal(sea.latitude, 41.5);
    assert.equal(sea.longitude, 2.2);
    assert.equal(sea.municipality, null);
    assert.equal(sea.comarca, null);
    assert.equal(sea.province, null);
    assert.match(sea.source_url, /^https:\/\/fever\.pxf\.io\//);
    const payload = JSON.parse(sea.source_payload_json);
    assert.equal(payload.Manufacturer, '2026-08-25 10:00,2026-08-26 10:00,2026-08-29 10:00');
    assert.equal(payload.ManufacturerSummary.parsed, 3);
    assert.match(payload.ManufacturerSummary.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(payload.Colors, ['https://feverup.com/m/sea']);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_categories WHERE plan_id=?').get(sea.id).count, 0);
    assert.deepEqual(db.prepare('SELECT resolution_status,municipality_code,comarca_code,province_code,location_basis FROM plan_source_geography WHERE plan_source_id=?').get(sea.source_link_id), {
      resolution_status: 'unresolved', municipality_code: null, comarca_code: null,
      province_code: null, location_basis: 'event_coordinates',
    });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences WHERE plan_source_id=? AND status=\'active\'').get(sea.source_link_id).count, 3);

    const queries = new PlanQueryRepository(db, { now: () => NOW });
    assert.equal(queries.findById(sea.id, 'ca'), null);
    const base = { lang: 'ca', page: 1, limit: 20, sort: 'date', categories: [] };
    assert.equal(queries.findMany(base).plans.some(({ id }) => id === sea.id), false);
    db.prepare("UPDATE sources SET enabled=1 WHERE key='fever'").run();
    assert.ok(queries.findById(sea.id, 'ca'));
    for (const filters of [
      {}, { date: '2026-08-25' }, { date: '2026-08-26' },
      { dateFrom: '2026-08-28', dateTo: '2026-08-30' },
      { editorial: 'home-weekend', dateFrom: '2026-08-29', dateTo: '2026-08-30', permanent: 0 },
      { editorial: 'home-upcoming', dateFrom: '2026-08-25', permanent: 0 },
    ]) assert.equal(queries.findMany({ ...base, ...filters }).plans.some(({ id }) => id === sea.id), true);
    for (const filter of [{ municipality: 'Barcelona' }, { comarca: 'Barcelonès' }, { province: 'Barcelona' }]) {
      assert.equal(queries.findMany({ ...base, ...filter }).plans.some(({ id }) => id === sea.id), false);
    }
    db.prepare("UPDATE sources SET enabled=0 WHERE key='fever'").run();
    assert.equal(queries.findById(sea.id, 'ca'), null);
  });
});

test('reconciles A/B/C/D occurrence lifecycle without duplicates', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db);
    await service.run(download([item('cycle')]));
    const originalPlan = db.prepare("SELECT p.id FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id WHERE ps.source_record_id='cycle'").get().id;
    const second = await service.run(download([item('cycle', { manufacturer: '2026-08-26 10:00,2026-08-27 10:00,2026-08-28 10:00' })]));
    assert.equal(second.inserted, 0);
    assert.equal(second.occurrences.inserted, 1);
    assert.equal(second.occurrences.inactivated, 1);
    assert.deepEqual(db.prepare("SELECT local_date,status FROM plan_occurrences ORDER BY local_date").all(), [
      { local_date: '2026-08-25', status: 'inactive' }, { local_date: '2026-08-26', status: 'active' },
      { local_date: '2026-08-27', status: 'active' }, { local_date: '2026-08-28', status: 'active' },
    ]);
    const third = await service.run(download([item('cycle', { manufacturer: '2026-08-24 10:00' })]), { allowMassRemoval: true });
    assert.equal(third.sourcesRemoved, 1);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(originalPlan).status, 'inactive');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_occurrences').get().count, 0);
    const fourth = await service.run(download([item('cycle', { manufacturer: '2026-08-29 10:00' })]));
    assert.equal(fourth.reactivated, 1);
    assert.equal(db.prepare("SELECT p.id FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id WHERE ps.source_record_id='cycle'").get().id, originalPlan);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, 1);
  });
});

test('updates Fever data by CatalogItemId and skips ambiguous or invalid affiliate candidates', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db);
    await service.run(download([item('update')]));
    const before = db.prepare("SELECT p.id,ps.id source_link_id FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id WHERE ps.source_record_id='update'").get();
    const changed = item('update', { name: 'Changed', description: 'Changed description', material: 'Changed venue', address: 'Changed address', url: 'https://fever.pxf.io/changed', longitude: 1.6, category: 'Tier 1', price: 99 });
    await service.run(download([changed]));
    const after = db.prepare('SELECT p.*,ps.id source_link_id,ps.source_url,ps.source_payload_json FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id').get();
    assert.equal(after.id, before.id);
    assert.equal(after.source_link_id, before.source_link_id);
    assert.equal(after.original_title, 'Changed');
    assert.equal(after.venue_name, 'Changed venue');
    assert.equal(after.address, 'Changed address');
    assert.equal(after.longitude, 1.6);
    assert.equal(after.source_url, 'https://fever.pxf.io/changed');
    assert.equal(JSON.parse(after.source_payload_json).CurrentPrice, 99);

    const skipped = await service.run(download([item('update', { longitude: 9 }), item('bad-url', { url: 'https://example.test/no' })]), { allowMassRemoval: true });
    assert.equal(skipped.ambiguous, 1);
    assert.equal(skipped.invalidAffiliate, 1);
    assert.equal(skipped.sourcesRemoved, 1);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(before.id).status, 'inactive');
  });
});

test('count guard supports first run, small changes, massive drops and explicit override', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db, { minimumBaselineRatio: 0.75 });
    await service.run(download([item('one'), item('two')]));
    await service.run(download([item('one'), item('two'), item('three')]));
    await assert.rejects(service.run(download([item('one')])), /count guard/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever'").get().count, 3);
    await service.run(download([item('one')]), { allowMassRemoval: true });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever'").get().count, 1);
  });
});

test('desired-set guard blocks mass invalid-affiliate, ambiguous and session removals before writes', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db);
    const initial = Array.from({ length: 10 }, (_, index) => item(`guard-${index}`));
    await service.run(download(initial));
    const before = db.prepare("SELECT COUNT(*) count FROM plan_sources WHERE source_record_id LIKE 'guard-%'").get().count;
    for (const dangerous of [
      initial.map((value, index) => index < 2 ? value : item(`guard-${index}`, { url: 'https://invalid.test' })),
      initial.map((value, index) => index < 2 ? value : item(`guard-${index}`, { longitude: 9 })),
      initial.map((value, index) => index < 2 ? value : item(`guard-${index}`, { manufacturer: '2026-08-24 10:00' })),
    ]) {
      await assert.rejects(service.run(download(dangerous)), /desired-set guard/);
      assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources WHERE source_record_id LIKE 'guard-%'").get().count, before);
    }
    const allowed = await service.run(download(initial.slice(0, 2)), { allowMassRemoval: true });
    assert.equal(allowed.allowMassRemovalUsed, true);
    assert.equal(allowed.sourcesRemoved, 8);
  });
});

test('reattaches returning Fever to the exact shared fingerprint without canonical overwrite', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db);
    await service.run(download([item('shared', { name: 'Original Fever title' })]));
    const plan = db.prepare("SELECT p.id FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id WHERE ps.source_record_id='shared'").get();
    const gencat = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    db.prepare(`INSERT INTO plan_sources
      (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at)
      VALUES (?,?,?,'{}',?,?)`).run(plan.id, gencat.id, 'gencat-shared', NOW.toISOString(), NOW.toISOString());
    await service.run(download([]), { allowMassRemoval: true });
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(plan.id).status, 'active');
    const returned = await service.run(download([item('shared', { name: 'Changed while absent' })]));
    assert.equal(returned.reactivated, 1);
    assert.equal(returned.sharedPreserved, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plans WHERE fingerprint='fever|shared'").get().count, 1);
    assert.equal(db.prepare('SELECT original_title FROM plans WHERE id=?').get(plan.id).original_title, 'Original Fever title');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM plan_sources WHERE plan_id=? AND source_record_id='shared'").get(plan.id).count, 1);
  });
});

test('identical imports avoid plan, geography and occurrence writes; geography-only change is updated', async () => {
  await withTestDatabase(async (db) => {
    const firstService = importer(db, { now: () => new Date('2026-08-25T10:00:00Z') });
    await firstService.run(download([item('physical')]));
    const before = db.prepare(`SELECT p.updated_at plan_updated,g.updated_at geography_updated,
      o.updated_at occurrence_updated,ps.imported_at,ps.last_seen_at
      FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id
      JOIN plan_source_geography g ON g.plan_source_id=ps.id
      JOIN plan_occurrences o ON o.plan_source_id=ps.id WHERE ps.source_record_id='physical' LIMIT 1`).get();
    const secondService = importer(db, { now: () => new Date('2026-08-25T11:00:00Z') });
    const second = await secondService.run(download([item('physical')]));
    assert.equal(second.unchanged, 1);
    assert.deepEqual(second.writes, { plans: 0, sources: 1, geography: 0, occurrences: 0 });
    const afterHeartbeat = db.prepare(`SELECT p.updated_at plan_updated,g.updated_at geography_updated,
      o.updated_at occurrence_updated,ps.imported_at,ps.last_seen_at
      FROM plans p JOIN plan_sources ps ON ps.plan_id=p.id
      JOIN plan_source_geography g ON g.plan_source_id=ps.id
      JOIN plan_occurrences o ON o.plan_source_id=ps.id WHERE ps.source_record_id='physical' LIMIT 1`).get();
    assert.deepEqual({ ...afterHeartbeat, last_seen_at: before.last_seen_at }, before);
    assert.equal(afterHeartbeat.imported_at, '2026-08-25T10:00:00.000Z');
    assert.equal(afterHeartbeat.last_seen_at, '2026-08-25T11:00:00.000Z');
    const changedGeography = importer(db, { snapshotChecksum: 'b'.repeat(64) });
    const third = await changedGeography.run(download([item('physical')]));
    assert.equal(third.updated, 1);
    assert.equal(third.writes.geography, 1);
  });
});

test('corrupt completed baseline aborts explicitly and finish timestamps use actual completion time', async () => {
  await withTestDatabase(async (db) => {
    const source = db.prepare("SELECT id FROM sources WHERE key='fever'").get();
    db.prepare(`INSERT INTO import_runs (source_id,started_at,finished_at,status,summary_json)
      VALUES (?,?,?,'completed','{"catalonia":"bad"}')`).run(source.id, '2026-08-24T00:00:00Z', '2026-08-24T00:01:00Z');
    const before = db.prepare(`SELECT
      (SELECT COUNT(*) FROM plans) plans,
      (SELECT COUNT(*) FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever') fever_sources,
      (SELECT COUNT(*) FROM plan_source_geography) geography,
      (SELECT COUNT(*) FROM plan_occurrences) occurrences`).get();
    await assert.rejects(importer(db).run(download([item('baseline')])), /invalid catalonia count/);
    const failed = db.prepare("SELECT * FROM import_runs WHERE status='failed' ORDER BY id DESC LIMIT 1").get();
    assert.ok(failed);
    assert.ok(failed.finished_at);
    assert.equal(failed.inserted, 0);
    assert.equal(failed.updated, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM import_runs WHERE status='running'").get().count, 0);
    assert.deepEqual(db.prepare(`SELECT
      (SELECT COUNT(*) FROM plans) plans,
      (SELECT COUNT(*) FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE s.key='fever') fever_sources,
      (SELECT COUNT(*) FROM plan_source_geography) geography,
      (SELECT COUNT(*) FROM plan_occurrences) occurrences`).get(), before);
    db.prepare("DELETE FROM import_runs WHERE status='completed'").run();
    const moments = [
      new Date('2026-08-25T10:00:00Z'),
      new Date('2026-08-25T10:00:00Z'),
      new Date('2026-08-25T10:00:05Z'),
    ];
    const timed = importer(db, { now: () => moments.shift() || new Date('2026-08-25T10:00:05Z') });
    await timed.run(download([item('timed')]));
    const run = db.prepare("SELECT started_at,finished_at FROM import_runs WHERE status='completed' ORDER BY id DESC LIMIT 1").get();
    assert.equal(run.started_at, '2026-08-25T10:00:00.000Z');
    assert.equal(run.finished_at, '2026-08-25T10:00:05.000Z');
  });
});

test('fatal preparation and transaction errors never leave partial Fever changes', async () => {
  await withTestDatabase(async (db) => {
    const service = importer(db);
    await service.run(download([item('stable')]));
    const before = db.prepare('SELECT COUNT(*) plans,(SELECT COUNT(*) FROM plan_sources) sources FROM plans').get();
    await assert.rejects(service.run(download([item('duplicate'), item('duplicate')])), /Duplicate/);
    assert.deepEqual(db.prepare('SELECT COUNT(*) plans,(SELECT COUNT(*) FROM plan_sources) sources FROM plans').get(), before);
    await assert.rejects(service.run(download([item('new-one'), item('new-two')]), {
      failAfterProduct: 0,
      allowMassRemoval: true,
    }), /Simulated/);
    assert.deepEqual(db.prepare('SELECT COUNT(*) plans,(SELECT COUNT(*) FROM plan_sources) sources FROM plans').get(), before);
    const fatalParser = importer(db, { analyzeImpl: () => { throw new Error('parser fatal'); } });
    await assert.rejects(fatalParser.run(download([item('parser')])), /parser fatal/);
    const fatalResolver = importer(db, { resolver: { ...resolver, resolve: () => { throw new Error('resolver fatal'); } } });
    await assert.rejects(fatalResolver.run(download([item('resolver')])), /resolver fatal/);
    assert.deepEqual(db.prepare('SELECT COUNT(*) plans,(SELECT COUNT(*) FROM plan_sources) sources FROM plans').get(), before);
  });
});

test('source geography enforces 1:1, status coherence and cascade', async () => {
  await withTestDatabase(async (db) => {
    await importer(db).run(download([item('geo')]));
    const source = db.prepare("SELECT ps.id FROM plan_sources ps WHERE ps.source_record_id='geo'").get();
    assert.throws(() => db.prepare("UPDATE plan_source_geography SET resolution_status='invalid' WHERE plan_source_id=?").run(source.id), /CHECK/);
    assert.throws(() => db.prepare('INSERT INTO plan_source_geography SELECT * FROM plan_source_geography WHERE plan_source_id=?').run(source.id), /UNIQUE/);
    for (const value of [null, '', '   ']) {
      assert.throws(() => db.prepare('UPDATE plan_source_geography SET municipality_code=? WHERE plan_source_id=?').run(value, source.id), /CHECK/);
    }
    assert.doesNotThrow(() => db.prepare("UPDATE plan_source_geography SET municipality_code='080193' WHERE plan_source_id=?").run(source.id));
    assert.throws(() => db.prepare("UPDATE plan_source_geography SET resolution_status='unresolved' WHERE plan_source_id=?").run(source.id), /CHECK/);
    db.prepare('DELETE FROM plan_sources WHERE id=?').run(source.id);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plan_source_geography').get().count, 0);
  });
});

test('temporary database barrier rejects the configured database path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fever-temp-barrier-'));
  try {
    const real = path.join(directory, 'real.sqlite');
    const distinct = path.join(directory, 'distinct.sqlite');
    fs.writeFileSync(real, 'real');
    fs.writeFileSync(distinct, 'different');
    assert.throws(() => assertTemporaryDatabasePath(real, real), /refuses/);
    assert.throws(() => assertTemporaryDatabasePath(path.relative(process.cwd(), real), real), /refuses/);
    if (process.platform === 'win32') {
      assert.throws(() => assertTemporaryDatabasePath(real.toUpperCase(), real), /refuses/);
    }
    const hardLink = path.join(directory, 'hard-link.sqlite');
    fs.linkSync(real, hardLink);
    assert.throws(() => assertTemporaryDatabasePath(hardLink, real), /refuses/);
    const junction = path.join(directory, 'junction');
    fs.symlinkSync(directory, junction, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => assertTemporaryDatabasePath(path.join(junction, 'real.sqlite'), real), /refuses/);
    assert.doesNotThrow(() => assertTemporaryDatabasePath(path.join(directory, 'new.sqlite'), real));
    assert.doesNotThrow(() => assertTemporaryDatabasePath(distinct, real));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Impact intermediate failures and pagination cycles happen before any SQLite target is opened', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fever-impact-before-db-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = {
    databasePath: path.join(directory, 'configured-real.sqlite'),
    impactAccountSid: 'test-account', impactAuthToken: 'test-token', feverLookaheadDays: 365,
  };
  const response = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { 'content-type': 'application/json' },
  });

  const cycleTarget = path.join(directory, 'cycle.sqlite');
  await assert.rejects(importFeverTemp(config, {
    databasePath: cycleTarget, logger: { log() {} },
    fetchImpl: async (url) => response({ Items: [], '@nextpageuri': url.toString() }),
  }), /cicle/);
  assert.equal(fs.existsSync(cycleTarget), false);

  const failedTarget = path.join(directory, 'intermediate.sqlite');
  let page = 0;
  await assert.rejects(importFeverTemp(config, {
    databasePath: failedTarget, logger: { log() {} },
    fetchImpl: async () => {
      page += 1;
      return page === 1
        ? response({ Items: [], '@nextpageuri': 'https://api.impact.com/page-2' })
        : response({}, 401);
    },
  }), /autenticació/);
  assert.equal(fs.existsSync(failedTarget), false);
});
