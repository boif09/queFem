import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DibaImporter, DIBA_FEEDS } from '../backend/src/diba/dibaImporter.js';
import { DibaImportLock } from '../backend/src/diba/importLock.js';
import { runDibaImport } from '../backend/src/jobs/dibaImportRunner.js';
import { importDibaScheduled, parseScheduledArguments } from '../backend/src/jobs/importDibaScheduled.js';
import { withTestDatabase } from './helpers.js';

const FEED = DIBA_FEEDS[0];
const NOW = '2026-08-31T10:00:00Z';
const MUNICIPALITIES = new Map([['08121', {
  municipality: 'Mataró', comarca: 'Maresme', province: 'Barcelona',
  municipalityCode: '080121', comarcaCode: '21', provinceCode: '08',
}]]);
const EMPTY_OVERRIDES = { version: 1, decisions: [] };
const EMPTY_FINAL = { version: 1, decisions: [] };

function raw(id, overrides = {}) {
  return {
    acte_id: String(id), titol: 'Concert de prova', descripcio: 'Text',
    data_inici: '2026-09-10 19:00:00', data_fi: '2026-09-10 21:00:00', observacions_horari: '19 h',
    rel_municipis: { ine: '08121', municipi_nom: 'Mataró' },
    grup_adreca: { adreca_nom: 'Teatre', adreca: 'Carrer Major 1', localitzacio: '41.54,2.44' },
    acte_url: 'https://diba.example/event', ...overrides,
  };
}
function client(records) { return { fetchDataset: async () => ({ records }) }; }
function importer(db, records, options = {}) {
  return new DibaImporter({
    db, client: client(records), municipalities: MUNICIPALITIES, now: () => new Date('2026-08-31T12:00:00Z'),
    reviewedOverrides: EMPTY_OVERRIDES, finalReviewDecisions: EMPTY_FINAL, finalDeferredKeys: new Set(), ...options,
  });
}
function enableDiba(db) { db.prepare("UPDATE sources SET enabled=1 WHERE key LIKE 'diba-%'").run(); }
function addPlan(db, { fingerprint, title = 'Concert de prova', municipality = 'Mataró', venue = null, address = null, latitude = null, longitude = null, status = 'active', sourceKey = 'gencat-agenda', sourceRecordId }) {
  const planId = Number(db.prepare(`INSERT INTO plans
    (kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,address,latitude,longitude,status,created_at,updated_at)
    VALUES ('event',? ,?,'2026-09-10','2026-09-10',?,?,?,?,?,?,?,?)`)
    .run(fingerprint, title, municipality, venue, address, latitude, longitude, status, NOW, NOW).lastInsertRowid);
  const sourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey).id;
  db.prepare(`INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
    VALUES (?,?,?,?, '{}',?,?)`).run(planId, sourceId, sourceRecordId, sourceKey.startsWith('diba-') ? 'https://diba.example/event' : null, NOW, NOW);
  return planId;
}
function sourcePlan(db, sourceKey, sourceRecordId) {
  return db.prepare(`SELECT ps.plan_id AS planId,p.status FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
    JOIN plans p ON p.id=ps.plan_id WHERE s.key=? AND ps.source_record_id=?`).get(sourceKey, sourceRecordId);
}
function attachSource(db, planId, sourceKey, sourceRecordId) {
  const sourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(sourceKey).id;
  db.prepare(`INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_url,source_payload_json,imported_at,last_seen_at)
    VALUES (?,?,?,?, '{}',?,?)`).run(planId, sourceId, sourceRecordId, 'https://diba.example/event', NOW, NOW);
}
function finalConsolidation(canonicalSourceRecordId = 'final-canonical', memberSourceRecordId = 'final-member') {
  return {
    operation: 'REVIEW_SAME_FEED_COMPONENT',
    sourceMembers: [
      { sourceKey: FEED.sourceKey, sourceRecordId: canonicalSourceRecordId },
      { sourceKey: FEED.sourceKey, sourceRecordId: memberSourceRecordId },
    ],
    disposition: 'CONSOLIDATE_TO_ONE_PLAN',
    canonicalSourceIdentity: { sourceKey: FEED.sourceKey, sourceRecordId: canonicalSourceRecordId },
  };
}
function finalDecisionOptions(decision) { return { finalReviewDecisions: { version: 1, decisions: [decision] } }; }

test('enabled DIBA rejects a complete topology containing a confirmed target and another POSSIBLE target', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    addPlan(db, { fingerprint: 'gencat-confirmed', venue: 'Teatre', address: 'Carrer Major 1', latitude: 41.54, longitude: 2.44, sourceRecordId: 'g-confirmed' });
    addPlan(db, { fingerprint: 'gencat-possible', sourceRecordId: 'g-possible' });
    const before = db.prepare('SELECT COUNT(*) count FROM plans').get().count;
    await assert.rejects(importer(db, [raw('new-possible')]).run({ feeds: [FEED] }), /recurring safety guard/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM plans').get().count, before);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'new-possible'), undefined);
    const run = db.prepare('SELECT status,summary_json FROM import_runs ORDER BY id DESC LIMIT 1').get();
    assert.equal(run.status, 'failed');
    const summary = JSON.parse(run.summary_json);
    assert.equal(summary.catalogCommitted, false);
    assert.equal(summary.safety.code, 'UNRESOLVED_DIBA_AMBIGUITY');
    assert.ok(summary.safety.blockers.some(({ code }) => code === 'UNRESOLVED_CROSS_SOURCE_POSSIBLE'));
  });
});

test('enabled DIBA rejects a new same-feed ambiguity without committing either plan', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    await assert.rejects(importer(db, [raw('same-a'), raw('same-b')]).run({ feeds: [FEED] }), /recurring safety guard/);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'same-a'), undefined);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'same-b'), undefined);
    const summary = JSON.parse(db.prepare('SELECT summary_json FROM import_runs ORDER BY id DESC LIMIT 1').get().summary_json);
    assert.ok(summary.safety.blockers.some(({ code }) => code === 'UNRESOLVED_SAME_FEED_COMPONENT'));
  });
});

test('a reviewed LINK_TO_EXISTING permits a weak match and links the exact stable target', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const targetPlanId = addPlan(db, { fingerprint: 'gencat-reviewed', sourceRecordId: 'g-reviewed' });
    const decision = {
      source: { sourceKey: FEED.sourceKey, sourceRecordId: 'reviewed-link' }, decision: 'LINK_TO_EXISTING',
      target: { sourceKey: 'gencat-agenda', sourceRecordId: 'g-reviewed' }, reason: 'reviewed', reviewedAt: '2026-09-07', reviewer: 'human-review',
    };
    const result = await importer(db, [raw('reviewed-link', { grup_adreca: {} })], { reviewedOverrides: { version: 1, decisions: [decision] } }).run({ feeds: [FEED] });
    assert.equal(result.datasets[0].safety.status, 'approved');
    assert.equal(sourcePlan(db, FEED.sourceKey, 'reviewed-link').planId, targetPlanId);
  });
});

test('known DEFER refresh stays inactive when DIBA is enabled', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db); const key = `${FEED.sourceKey}:known-defer`;
    const make = (title) => importer(db, [raw('known-defer', { titol: title })], { finalDeferredKeys: new Set([key]) });
    await make('Initial').run({ feeds: [FEED] });
    assert.equal(sourcePlan(db, FEED.sourceKey, 'known-defer').status, 'inactive');
    await make('Refreshed').run({ feeds: [FEED] });
    assert.equal(sourcePlan(db, FEED.sourceKey, 'known-defer').status, 'inactive');
  });
});

test('unknown identity strongly matching a DEFER target is rejected without reactivation', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const planId = addPlan(db, { fingerprint: 'known-defer', venue: 'Teatre', address: 'Carrer Major 1', latitude: 41.54, longitude: 2.44, status: 'inactive', sourceKey: FEED.sourceKey, sourceRecordId: 'known-defer' });
    const key = `${FEED.sourceKey}:known-defer`;
    addPlan(db, { fingerprint: 'retained-one', municipality: 'Barcelona', sourceKey: FEED.sourceKey, sourceRecordId: 'retained-one' });
    addPlan(db, { fingerprint: 'retained-two', municipality: 'Barcelona', sourceKey: FEED.sourceKey, sourceRecordId: 'retained-two' });
    let failure;
    await assert.rejects(importer(db, [
      raw('unknown-near-defer'), raw('retained-one', { titol: 'Retained one' }), raw('retained-two', { titol: 'Retained two' }),
    ], { finalDeferredKeys: new Set([key]) }).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(planId).status, 'inactive');
    assert.equal(sourcePlan(db, FEED.sourceKey, 'unknown-near-defer'), undefined);
    assert.ok(failure.results[0].safety.blockers.some(({ code }) => code === 'UNKNOWN_IDENTITY_MATCHES_REVIEWED_DEFER'));
  });
});

test('reviewed final consolidation accepts existing members already linked to the canonical plan', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const decision = finalConsolidation();
    const canonicalPlanId = addPlan(db, { fingerprint: 'final-canonical', sourceKey: FEED.sourceKey, sourceRecordId: 'final-canonical' });
    attachSource(db, canonicalPlanId, FEED.sourceKey, 'final-member');
    const result = await importer(db, [raw('final-canonical'), raw('final-member')], finalDecisionOptions(decision)).run({ feeds: [FEED] });
    assert.equal(result.datasets[0].safety.status, 'approved');
    assert.equal(sourcePlan(db, FEED.sourceKey, 'final-canonical').planId, canonicalPlanId);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'final-member').planId, canonicalPlanId);
  });
});

test('reviewed final consolidation rejects a member that drifted to a different plan', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const decision = finalConsolidation();
    const canonicalPlanId = addPlan(db, { fingerprint: 'final-canonical', sourceKey: FEED.sourceKey, sourceRecordId: 'final-canonical' });
    const wrongPlanId = addPlan(db, {
      fingerprint: 'wrong-final-target', title: 'Wrong plan', status: 'inactive', sourceKey: FEED.sourceKey, sourceRecordId: 'final-member',
    });
    const before = db.prepare('SELECT original_title,status FROM plans WHERE id=?').get(wrongPlanId);
    let failure;
    await assert.rejects(importer(db, [raw('final-member')], finalDecisionOptions(decision)).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    assert.equal(sourcePlan(db, FEED.sourceKey, 'final-member').planId, wrongPlanId);
    assert.deepEqual(db.prepare('SELECT original_title,status FROM plans WHERE id=?').get(wrongPlanId), before);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'final-canonical').planId, canonicalPlanId);
    assert.ok(failure.results[0].safety.blockers.some(({ code }) => code === 'REVIEWED_FINAL_SOURCE_LINK_CHANGED'));
  });
});

test('transactional revalidation rejects final-consolidation source drift after preflight', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const decision = finalConsolidation();
    const canonicalPlanId = addPlan(db, { fingerprint: 'final-canonical', sourceKey: FEED.sourceKey, sourceRecordId: 'final-canonical' });
    attachSource(db, canonicalPlanId, FEED.sourceKey, 'final-member');
    const wrongPlanId = addPlan(db, { fingerprint: 'late-wrong-final-target', title: 'Wrong plan', municipality: 'Barcelona', status: 'inactive', sourceRecordId: 'unrelated' });
    const dibaSourceId = db.prepare('SELECT id FROM sources WHERE key=?').get(FEED.sourceKey).id;
    const guarded = importer(db, [raw('final-member')], {
      ...finalDecisionOptions(decision),
      beforePersist: () => db.prepare('UPDATE plan_sources SET plan_id=? WHERE source_id=? AND source_record_id=?').run(wrongPlanId, dibaSourceId, 'final-member'),
    });
    let failure;
    await assert.rejects(guarded.run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /safety authorization changed/.test(error.message);
    });
    assert.equal(sourcePlan(db, FEED.sourceKey, 'final-member').planId, wrongPlanId);
    assert.equal(db.prepare('SELECT status FROM plans WHERE id=?').get(wrongPlanId).status, 'inactive');
    assert.equal(failure.results[0].safety.code, 'DIBA_STALE_DATASET_AUTHORIZATION');
    assert.ok(failure.results[0].safety.blockers.some(({ code }) => code === 'REVIEWED_FINAL_SOURCE_LINK_CHANGED'));
  });
});

test('a transitive same-feed A-B-C component is rejected as one unresolved component', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    let failure;
    await assert.rejects(importer(db, [
      raw('transitive-a', { data_fi: '2026-09-10 21:00:00' }),
      raw('transitive-b', { data_fi: '2026-09-11 21:00:00' }),
      raw('transitive-c', { data_inici: '2026-09-11 19:00:00', data_fi: '2026-09-11 21:00:00' }),
    ]).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    const blocker = failure.results[0].safety.blockers.find(({ code }) => code === 'UNRESOLVED_SAME_FEED_COMPONENT');
    assert.deepEqual(blocker.sourceRecordIds, ['transitive-a', 'transitive-b', 'transitive-c']);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'transitive-a'), undefined);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'transitive-b'), undefined);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'transitive-c'), undefined);
  });
});

test('same-feed safety disposition is independent of incoming record order', async () => {
  const records = [raw('order-a'), raw('order-b')];
  const rejectedSafety = async (incoming) => withTestDatabase(async (db) => {
    enableDiba(db);
    let failure;
    await assert.rejects(importer(db, incoming).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    return failure.results[0].safety;
  });
  assert.deepEqual(await rejectedSafety(records), await rejectedSafety([...records].reverse()));
});

test('an unreviewed member joining a reviewed final component is rejected', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const decision = finalConsolidation();
    const canonicalPlanId = addPlan(db, { fingerprint: 'final-canonical', sourceKey: FEED.sourceKey, sourceRecordId: 'final-canonical' });
    attachSource(db, canonicalPlanId, FEED.sourceKey, 'final-member');
    let failure;
    await assert.rejects(importer(db, [raw('final-canonical'), raw('final-member'), raw('unreviewed-joiner')], finalDecisionOptions(decision)).run({ feeds: [FEED] }), (error) => {
      failure = error;
      return /recurring safety guard/.test(error.message);
    });
    const blocker = failure.results[0].safety.blockers.find(({ code }) => code === 'UNRESOLVED_SAME_FEED_COMPONENT');
    assert.deepEqual(blocker.sourceRecordIds, ['final-canonical', 'final-member', 'unreviewed-joiner']);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'unreviewed-joiner'), undefined);
  });
});

test('transactional revalidation rolls back when database topology changes after preflight', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const guarded = importer(db, [raw('stale', { grup_adreca: {} })], {
      beforePersist: () => addPlan(db, { fingerprint: 'gencat-late', sourceRecordId: 'g-late' }),
    });
    await assert.rejects(guarded.run({ feeds: [FEED] }), /safety authorization changed/);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'stale'), undefined);
    const run = db.prepare('SELECT status,error_message,summary_json FROM import_runs ORDER BY id DESC LIMIT 1').get();
    assert.equal(run.status, 'failed'); assert.match(run.error_message, /authorization changed/);
    assert.equal(JSON.parse(run.summary_json).catalogCommitted, false);
  });
});

test('transactional revalidation rejects a changed removal set before catalog writes', async () => {
  await withTestDatabase(async (db) => {
    enableDiba(db);
    const guarded = importer(db, [raw('stale-removal', { titol: 'Unique incoming title' })], {
      beforePersist: () => addPlan(db, {
        fingerprint: 'late-removal', title: 'Unrelated existing title', municipality: 'Barcelona',
        sourceKey: FEED.sourceKey, sourceRecordId: 'late-removal',
      }),
    });
    await assert.rejects(guarded.run({ feeds: [FEED] }), /safety authorization changed/);
    assert.equal(sourcePlan(db, FEED.sourceKey, 'stale-removal'), undefined);
    assert.ok(sourcePlan(db, FEED.sourceKey, 'late-removal'));
    const summary = JSON.parse(db.prepare('SELECT summary_json FROM import_runs ORDER BY id DESC LIMIT 1').get().summary_json);
    assert.equal(summary.safety.code, 'DIBA_STALE_DATASET_AUTHORIZATION');
    assert.deepEqual(summary.safety.blockers, []);
    assert.equal(summary.catalogCommitted, false);
  });
});

test('a shared DIBA lock rejects a second real invocation before import and releases safely', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-diba-lock-'));
  const databasePath = path.join(directory, 'quefem.sqlite'); const first = new DibaImportLock(databasePath);
  try {
    assert.equal(await first.acquire(), true);
    await assert.rejects(runDibaImport({ databasePath }, {}), (error) => error.code === 'DIBA_IMPORT_LOCKED');
    assert.equal(fs.existsSync(`${databasePath}.diba-import.lock`), true);
  } finally { await first.release(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scheduled DIBA entrypoint accepts no flags and cannot expose a mass-removal bypass', async () => {
  assert.deepEqual(parseScheduledArguments([]), {});
  assert.throws(() => parseScheduledArguments(['--allow-mass-removal']), /Usage/);
  await assert.rejects(importDibaScheduled({ databasePath: 'unused' }, { allowMassRemoval: true }), /unsupported scheduled DIBA import option/);
  await assert.rejects(importDibaScheduled({ databasePath: 'unused' }, { lockFactory() {} }), /unsupported scheduled DIBA import option/);
  let received;
  const lines = [];
  const report = await importDibaScheduled({ databasePath: 'scheduled.sqlite' }, {
    logger: { log: (line) => lines.push(line) },
    runImport: async (config, options) => {
      received = { config, options };
      return { datasets: [{ dataset: FEED.dataset, failed: false }] };
    },
  });
  assert.equal(received.config.databasePath, 'scheduled.sqlite');
  assert.equal(received.options.dryRun, false);
  assert.equal(received.options.allowMassRemoval, false);
  assert.equal(typeof received.options.logger.log, 'function');
  assert.equal(report.status, 'completed');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, 'diba-import-scheduled');
});
