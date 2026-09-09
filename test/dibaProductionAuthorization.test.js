import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { applyProductionReconciliation, prepareProductionPreview } from '../backend/src/diba/dibaProductionAuthorization.js';
import * as productionAuthorizationExports from '../backend/src/diba/dibaProductionAuthorization.js';
import { prepareFinalReviewPlanForDatabase } from '../backend/src/diba/dibaFinalReviewPolicy.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from '../backend/src/jobs/updateIcgcGeography.js';
import { sha256File } from '../backend/src/diba/dibaPolicyExecutor.js';

function fixture(overrideCount = 38) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-diba-production-')); const data = path.join(projectRoot, 'data'); const policy = path.join(projectRoot, 'data-policy');
  fs.mkdirSync(data); fs.mkdirSync(policy); const databasePath = path.join(data, 'quefem.sqlite'); const overridePath = path.join(policy, 'overrides.json'); const decisionPath = path.join(policy, 'final.json');
  const db = openDatabase(databasePath); migrate(db); const now = '2026-09-04T12:00:00Z';
  const sourceIds = Object.fromEntries(db.prepare("SELECT id,key FROM sources").all().map(({ id, key }) => [key, id]));
  const add = (sourceKey, sourceRecordId, title, payload = {}) => {
    const planId = Number(db.prepare("INSERT INTO plans(kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,address,latitude,longitude,status,created_at,updated_at) VALUES('event',?,?, '2026-09-10','2026-09-10','Barcelona','Venue Test','Carrer Test',41.4,2.1,'active',?,?)").run(`fixture-${sourceRecordId}`, title, now, now).lastInsertRowid);
    db.prepare('INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(planId, sourceIds[sourceKey], sourceRecordId, JSON.stringify({ titol: title, data_inici: '2026-09-10', data_fi: '2026-09-10', grup_adreca: { adreca_nom: 'Venue Test', adreca: 'Carrer Test', localitzacio: '41.4,2.1' }, ...payload }), now, now);
    return planId;
  };
  const overrides = Array.from({ length: overrideCount }, (_, index) => ({ source: { sourceKey: 'diba-tourisme', sourceRecordId: `override-${index}` }, decision: 'LINK_TO_EXISTING', target: { sourceKey: 'gencat-agenda', sourceRecordId: `public-${index}` }, reason: 'Hermetic production-boundary fixture.', reviewedAt: '2026-09-03', reviewer: 'test' }));
  for (let index = 0; index < overrides.length; index += 1) {
    const planId = add('diba-tourisme', `override-${index}`, `Unique override ${index}`);
    let publicPlanId = planId;
    if (index === 0) publicPlanId = Number(db.prepare("INSERT INTO plans(kind,fingerprint,original_title,start_date,end_date,municipality,venue_name,address,latitude,longitude,status,created_at,updated_at) VALUES('event','fixture-public-0','Unique override 0','2026-09-10','2026-09-10','Barcelona','Venue Test','Carrer Test',41.4,2.1,'active',?,?)").run(now, now).lastInsertRowid);
    db.prepare("INSERT INTO plan_sources(plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES(?,?,?,'{}',?,?)").run(publicPlanId, sourceIds['gencat-agenda'], `public-${index}`, now, now);
  }
  const groups = [
    { operation: 'REVIEW_SAME_FEED_COMPONENT', disposition: 'DEFER', key: 'same-a', count: 2 },
    { operation: 'REVIEW_SAME_FEED_COMPONENT', disposition: 'DEFER', key: 'same-b', count: 2 },
    { operation: 'REVIEW_SAME_FEED_COMPONENT', disposition: 'CONSOLIDATE_TO_ONE_PLAN', key: 'same-c', count: 2 },
    { operation: 'REVIEW_SESSION_COMPONENT', disposition: 'DEFER', key: 'session-a', count: 4, sessions: true },
    { operation: 'REVIEW_SESSION_COMPONENT', disposition: 'CONSOLIDATE_TO_ONE_PLAN', key: 'session-b', count: 2, sessions: true },
  ];
  const decisions = groups.map((group) => {
    const sourceMembers = Array.from({ length: group.count }, (_, index) => ({ sourceKey: 'diba-escenari', sourceRecordId: `${group.key}-${index}` }));
    sourceMembers.forEach((member, index) => add(member.sourceKey, member.sourceRecordId, `Group ${group.key}`, group.sessions ? { observacions_horari: `${10 + index}:00` } : {}));
    return { operation: group.operation, sourceMembers, disposition: group.disposition, ...(group.disposition === 'CONSOLIDATE_TO_ONE_PLAN' ? { canonicalSourceIdentity: sourceMembers[0] } : {}), rationale: 'Hermetic production-boundary fixture.', reviewedAt: '2026-09-03', reviewer: 'human-review' };
  });
  db.close(); fs.writeFileSync(overridePath, `${JSON.stringify({ version: 1, decisions: overrides }, null, 2)}\n`); fs.writeFileSync(decisionPath, `${JSON.stringify({ version: 1, decisions }, null, 2)}\n`);
  return { projectRoot, databasePath, overridePath, decisionPath, config: { projectRoot, databasePath }, backupPath: path.join(data, 'backups', 'before.sqlite'), manifestPath: DEFAULT_ICGC_MANIFEST_PATH };
}
const options = (item) => ({ config: item.config, overridePath: item.overridePath, decisionPath: item.decisionPath, manifestPath: item.manifestPath });
const absoluteModuleUrl = (relativePath) => pathToFileURL(path.resolve(relativePath)).href;
async function withProductionStageObserver(notifyDibaPolicyStage, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenspla-diba-production-module-')); const serviceKey = `tenspla.dibaProduction.${process.pid}.${Date.now()}.${Math.random()}`; const modulePath = path.join(directory, 'authorization.mjs');
  try {
    let source = fs.readFileSync('backend/src/diba/dibaProductionAuthorization.js', 'utf8');
    for (const relativePath of ['../db/database.js', './dibaQualityAudit.js', '../geography/icgcSnapshot.js', '../jobs/updateIcgcGeography.js', './dibaPolicyOverrides.js', './dibaFinalReviewDecisions.js', './dibaPolicyPlanner.js', './dibaFinalReviewPolicy.js', './dibaPolicyExecutor.js']) source = source.replace(`from '${relativePath}';`, `from ${JSON.stringify(absoluteModuleUrl(path.join('backend/src/diba', relativePath)))};`);
    source = source.replace("from './dibaPolicyStageObserver.js';", "from './stage-observer.mjs';"); fs.writeFileSync(modulePath, source);
    fs.writeFileSync(path.join(directory, 'stage-observer.mjs'), `const notify = globalThis[${JSON.stringify(serviceKey)}]; export function notifyDibaPolicyStage(stage) { notify(stage); }`);
    globalThis[serviceKey] = notifyDibaPolicyStage;
    return await run(await import(`${pathToFileURL(modulePath).href}?${Date.now()}-${Math.random()}`));
  } finally { delete globalThis[serviceKey]; fs.rmSync(directory, { recursive: true, force: true }); }
}

test('production authorization exposes no arbitrary database, callback or policy writer', () => {
  assert.deepEqual(Object.keys(productionAuthorizationExports).sort(), ['applyProductionReconciliation', 'prepareProductionPreview']);
});

test('production authorization rejects missing/wrong tokens and stale database or decision state', async () => {
  const item = fixture();
  try {
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot }); const before = sha256File(item.databasePath);
    await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath }), /authorization/);
    await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: 'wrong' }), /authorization/);
    assert.equal(sha256File(item.databasePath), before); assert.equal(fs.existsSync(item.backupPath), false);
    const db = openDatabase(item.databasePath); db.prepare("UPDATE plans SET status='inactive' WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='override-1')").run(); db.close();
    await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }), /authorization/);
    const changedStateHash = sha256File(item.databasePath); const refreshed = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot });
    const decisions = JSON.parse(fs.readFileSync(item.decisionPath, 'utf8')); decisions.decisions[0].rationale += ' changed'; fs.writeFileSync(item.decisionPath, JSON.stringify(decisions));
    await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: refreshed.authorization }), /authorization/);
    assert.equal(sha256File(item.databasePath), changedStateHash);
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

test('production preview and authorized reconciliation accept exactly 38 reviewed overrides and keep DIBA disabled', async () => {
  const item = fixture();
  try {
    assert.equal(JSON.parse(fs.readFileSync(item.overridePath, 'utf8')).decisions.length, 38);
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot }); const before = sha256File(item.databasePath);
    const report = await applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization });
    assert.equal(report.authorizationConsumed, preview.authorization); assert.equal(report.publicActivationReady, false); assert.ok(fs.existsSync(item.backupPath)); assert.notEqual(sha256File(item.databasePath), before);
    const db = openDatabase(item.databasePath, { readonly: true });
    try { assert.ok(db.prepare("SELECT enabled,allows_images FROM sources WHERE key LIKE 'diba-%'").all().every(({ enabled, allows_images: images }) => enabled === 0 && images === 0)); }
    finally { db.close(); }
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

for (const count of [34, 36, 37, 39]) {
  test(`production preview, apply and final review reject ${count} reviewed overrides without database changes`, async () => {
    const item = fixture(count);
    try {
      const before = sha256File(item.databasePath);
      await assert.rejects(prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot }), /DIBA production review decision inventory is not exact/);
      await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: 'unexpected-inventory' }), /DIBA production review decision inventory is not exact/);
      const overrides = JSON.parse(fs.readFileSync(item.overridePath, 'utf8'));
      assert.throws(() => prepareFinalReviewPlanForDatabase({ overrides }), new RegExp(`Final DIBA review requires exactly 38 existing cross-source overrides; found ${count}\\.`));
      assert.equal(sha256File(item.databasePath), before);
      assert.equal(fs.existsSync(item.backupPath), false);
    } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
  });
}

test('authorized production apply rolls C2 back completely when final review fails', async () => {
  const item = fixture();
  try {
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot });
    const db = openDatabase(item.databasePath); const originalPlanId = db.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId;
    db.exec("CREATE TRIGGER fail_final_defer BEFORE UPDATE OF status ON plans WHEN OLD.original_title='Group same-a' BEGIN SELECT RAISE(ABORT, 'forced final failure'); END"); db.close();
    await assert.rejects(applyProductionReconciliation({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }), /forced final failure/);
    const after = openDatabase(item.databasePath, { readonly: true });
    try { assert.equal(after.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId, originalPlanId); assert.equal(after.prepare("SELECT status FROM plans WHERE original_title='Group same-a' LIMIT 1").get().status, 'active'); }
    finally { after.close(); }
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

test('apply rejects a relevant write after backup without applying C2 or final review', async () => {
  const item = fixture();
  try {
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot }); const before = openDatabase(item.databasePath, { readonly: true }); const originalMapping = before.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId; before.close();
    await withProductionStageObserver((stage) => {
      if (stage !== 'production-after-backup') return;
      const concurrent = openDatabase(item.databasePath); concurrent.prepare("UPDATE plans SET status='inactive' WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='override-1')").run(); concurrent.close();
    }, async ({ applyProductionReconciliation: apply }) => {
      await assert.rejects(apply({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }), /changed after its recovery backup snapshot/);
    });
    const after = openDatabase(item.databasePath, { readonly: true });
    try { assert.equal(after.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId, originalMapping); assert.equal(after.prepare("SELECT status FROM plans WHERE original_title='Group same-a' LIMIT 1").get().status, 'active'); }
    finally { after.close(); }
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

test('apply also rejects a non-DIBA write after backup without applying reconciliation', async () => {
  const item = fixture();
  try {
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot }); const before = openDatabase(item.databasePath, { readonly: true }); const originalMapping = before.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId; before.close();
    await withProductionStageObserver((stage) => {
      if (stage !== 'production-after-backup') return;
      const concurrent = openDatabase(item.databasePath); concurrent.prepare("UPDATE plans SET featured=1 WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='public-0')").run(); concurrent.close();
    }, async ({ applyProductionReconciliation: apply }) => {
      await assert.rejects(apply({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }), /changed after its recovery backup snapshot/);
    });
    const after = openDatabase(item.databasePath, { readonly: true });
    try { assert.equal(after.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId, originalMapping); assert.equal(after.prepare("SELECT status FROM plans WHERE original_title='Group same-a' LIMIT 1").get().status, 'active'); }
    finally { after.close(); }
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

test('apply proceeds when a concurrent write is already included in the backup snapshot', async () => {
  const item = fixture();
  try {
    const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot });
    await withProductionStageObserver((stage) => {
      if (stage !== 'production-before-backup') return;
      const concurrent = openDatabase(item.databasePath); concurrent.prepare("UPDATE plans SET featured=1 WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='public-0')").run(); concurrent.close();
    }, async ({ applyProductionReconciliation: apply }) => {
      const report = await apply({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }); assert.equal(report.publicActivationReady, false);
    });
    const backup = openDatabase(item.backupPath, { readonly: true }); const primary = openDatabase(item.databasePath, { readonly: true });
    try { assert.equal(backup.prepare("SELECT featured FROM plans WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='public-0')").get().featured, 1); assert.equal(primary.prepare("SELECT featured FROM plans WHERE id=(SELECT plan_id FROM plan_sources WHERE source_record_id='public-0')").get().featured, 1); }
    finally { backup.close(); primary.close(); }
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});

test('primary disappearance or replacement immediately before open fails without creating or reconciling another database', async () => {
  for (const scenario of ['missing', 'replaced']) {
    const item = fixture(); const authorizedCopy = path.join(item.projectRoot, 'authorized-primary.sqlite'); let replacementHash = null;
    try {
      const preview = await prepareProductionPreview({ ...options(item), temporaryDirectory: item.projectRoot });
      await withProductionStageObserver((stage) => {
        if (stage !== 'production-before-primary-open') return;
        if (scenario === 'missing') fs.rmSync(item.databasePath);
        else {
          fs.renameSync(item.databasePath, authorizedCopy); const replacement = openDatabase(item.databasePath); migrate(replacement); replacement.close(); replacementHash = sha256File(item.databasePath);
        }
      }, async ({ applyProductionReconciliation: apply }) => {
        await assert.rejects(apply({ ...options(item), backupPath: item.backupPath, authorization: preview.authorization }), scenario === 'missing' ? /exist|open|SQLITE_CANTOPEN/i : /identity changed/);
      });
      if (scenario === 'missing') assert.equal(fs.existsSync(item.databasePath), false);
      else {
        assert.equal(sha256File(item.databasePath), replacementHash);
        const authorized = openDatabase(authorizedCopy, { readonly: true });
        try { assert.notEqual(authorized.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='override-0'").get().planId, authorized.prepare("SELECT plan_id AS planId FROM plan_sources WHERE source_record_id='public-0'").get().planId); }
        finally { authorized.close(); }
      }
    } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
  }
});

test('production boundary rejects configured aliases and canonical symlinks when supported', async (context) => {
  const item = fixture();
  try {
    await assert.rejects(prepareProductionPreview({ ...options(item), config: { ...item.config, databasePath: path.join(item.projectRoot, 'alternative.sqlite') } }), /redirected/);
    const alternative = path.join(item.projectRoot, 'alternative.sqlite'); fs.renameSync(item.databasePath, alternative);
    try { fs.symlinkSync(alternative, item.databasePath, 'file'); }
    catch (error) { fs.renameSync(alternative, item.databasePath); context.skip(`symlink unavailable: ${error.code || error.message}`); return; }
    await assert.rejects(prepareProductionPreview(options(item)), /symlink|alias/);
  } finally { fs.rmSync(item.projectRoot, { recursive: true, force: true }); }
});
