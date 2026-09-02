import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';
import { applyDibaPolicyRehearsal, assertC2RehearsalPath, cloneDibaRehearsal, sha256File } from '../backend/src/diba/dibaPolicyExecutor.js';
import * as executorExports from '../backend/src/diba/dibaPolicyExecutor.js';

function temporaryPair() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-diba-c2-')); const real = path.join(directory, 'real.sqlite');
  const db = openDatabase(real); migrate(db); db.close(); return { directory, real, rehearsal: path.join(directory, 'rehearsal.sqlite') };
}
test('C2 rejects missing, equivalent and real database paths', () => {
  const pair = temporaryPair();
  try {
    assert.throws(() => assertC2RehearsalPath(null, pair.real), /explicit/);
    assert.throws(() => assertC2RehearsalPath(pair.real, pair.real), /refuses/);
    assert.throws(() => assertC2RehearsalPath(path.relative(process.cwd(), pair.real), pair.real), /refuses/);
    assert.equal(assertC2RehearsalPath(pair.rehearsal, pair.real), path.resolve(pair.rehearsal));
  } finally { fs.rmSync(pair.directory, { recursive: true, force: true }); }
});

test('generic C2 executor always rejects the primary path even when passed obsolete bypass-shaped options', async () => {
  const pair = temporaryPair();
  try {
    await assert.rejects(applyDibaPolicyRehearsal({ databasePath: pair.real, realDatabasePath: pair.real, overrides: { version: 1, decisions: [] }, allowPrimaryLocal: true, canonicalPrimaryPath: pair.real }), /refuses/);
  } finally { fs.rmSync(pair.directory, { recursive: true, force: true }); }
});

test('raw writable transaction and arbitrary-path factory are not exported', () => {
  assert.equal(typeof executorExports.executeDibaPolicyTransaction, 'undefined');
  assert.equal(typeof executorExports.createPrimaryLocalTransactionRunner, 'undefined');
});
test('C2 only commits to an explicit rehearsal copy and preserves disabled source configuration', async () => {
  const pair = temporaryPair();
  try {
    const copied = await cloneDibaRehearsal(pair.real, pair.rehearsal);
    assert.equal(copied.originalSha256, copied.rehearsalSha256);
    const before = sha256File(pair.real);
    const result = await applyDibaPolicyRehearsal({ databasePath: pair.rehearsal, realDatabasePath: pair.real, overrides: { version: 1, decisions: [] } });
    assert.equal(result.originalSha256Before, before); assert.equal(result.originalSha256After, before);
    assert.equal(result.finalRelinks.length, 0); assert.equal(result.invariantResults.integrity, 'ok');
    assert.ok(result.sourceStates.every(({ enabled, allows_images: images }) => enabled === 0 && images === 0));
  } finally { fs.rmSync(pair.directory, { recursive: true, force: true }); }
});

test('C2 relinks provenance directly, protects public canonical fields, applies approved geography and inactivates only the source-less staging plan', async () => {
  const pair = temporaryPair();
  try {
    await cloneDibaRehearsal(pair.real, pair.rehearsal);
    const db = openDatabase(pair.rehearsal); const now = '2026-09-01T12:00:00Z';
    const dibaSource = db.prepare("SELECT id FROM sources WHERE key='diba-escenari'").get(); const publicSource = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const publicPlan = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,original_description,start_date,end_date,venue_name,address,latitude,longitude,website_url,image_url,ticket_url,status,featured,quality_score,created_at,updated_at) VALUES ('event','public-c2','Public title','Public description','2026-09-10','2026-09-10','Public venue','Public address',41,2,'https://public.example','https://image.example','https://ticket.example','active',1,88,?,?)").run(now, now).lastInsertRowid);
    const dibaPlan = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,status,created_at,updated_at) VALUES ('event','diba-c2','DIBA title','active',?,?)").run(now, now).lastInsertRowid);
    db.prepare("INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)").run(publicPlan, publicSource.id, 'public-1', now, now);
    db.prepare("INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)").run(dibaPlan, dibaSource.id, 'diba-1', now, now); db.close();
    const mapping = { source: { sourceKey: 'diba-escenari', sourceRecordId: 'diba-1' }, finalTargetAnchor: { sourceKey: 'gencat-agenda', sourceRecordId: 'public-1' }, diagnostic: { currentSourcePlanId: dibaPlan, expectedCurrentTargetPlanId: publicPlan, policy: 'test' } };
    const policy = { mutationPlan: { phases: { finalSourceMappings: [mapping], explicitGeography: [{ type: 'RESOLVE_MUNICIPALITY', source: mapping.source, finalTargetAnchor: mapping.finalTargetAnchor, geography: { resolutionType: 'EXACT_MUNICIPALITY', municipality: 'Viladrau', ruleId: 'test', deterministic: true }, diagnostic: mapping.diagnostic }] } }, activation: { publicActivationReady: false, blockers: [] }, summary: {} };
    const result = await applyDibaPolicyRehearsal({ databasePath: pair.rehearsal, realDatabasePath: pair.real, overrides: { version: 1, decisions: [] }, preparePlan: async () => ({ policy }) });
    assert.equal(result.finalRelinks.length, 1); assert.equal(result.inactivatedOrphans.length, 1); assert.equal(result.geography[0].outcome, 'MUTATED_APPROVED_GEOGRAPHY');
    const after = openDatabase(pair.rehearsal, { readonly: true });
    assert.equal(after.prepare("SELECT plan_id FROM plan_sources WHERE source_record_id='diba-1'").get().plan_id, publicPlan);
    assert.deepEqual(after.prepare('SELECT original_title,original_description,venue_name,address,latitude,longitude,website_url,image_url,ticket_url,status,featured,quality_score,municipality FROM plans WHERE id=?').get(publicPlan), { original_title: 'Public title', original_description: 'Public description', venue_name: 'Public venue', address: 'Public address', latitude: 41, longitude: 2, website_url: 'https://public.example', image_url: 'https://image.example', ticket_url: 'https://ticket.example', status: 'active', featured: 1, quality_score: 88, municipality: 'Viladrau' });
    assert.equal(after.prepare('SELECT status FROM plans WHERE id=?').get(dibaPlan).status, 'inactive'); after.close();
    const second = await applyDibaPolicyRehearsal({ databasePath: pair.rehearsal, realDatabasePath: pair.real, overrides: { version: 1, decisions: [] }, preparePlan: async () => ({ policy: { mutationPlan: { phases: { finalSourceMappings: [], explicitGeography: [] } }, activation: { publicActivationReady: false, blockers: [] }, summary: {} } }) });
    assert.equal(second.finalRelinks.length, 0); assert.equal(second.inactivatedOrphans.length, 0);
  } finally { fs.rmSync(pair.directory, { recursive: true, force: true }); }
});

test('C2 rejects a geography final target anchor inconsistent with its diagnostic without mutation', async () => {
  const pair = temporaryPair();
  try {
    await cloneDibaRehearsal(pair.real, pair.rehearsal);
    const db = openDatabase(pair.rehearsal); const now = '2026-09-01T12:00:00Z';
    const dibaSource = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get(); const publicSource = db.prepare("SELECT id FROM sources WHERE key='gencat-agenda'").get();
    const dibaPlan = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,status,created_at,updated_at) VALUES ('event','diba-geography-guard','DIBA title','active',?,?)").run(now, now).lastInsertRowid);
    const anchorPlan = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,status,created_at,updated_at) VALUES ('event','geography-anchor','Anchor title','active',?,?)").run(now, now).lastInsertRowid);
    const diagnosticPlan = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,status,created_at,updated_at) VALUES ('event','geography-diagnostic','Diagnostic title','active',?,?)").run(now, now).lastInsertRowid);
    db.prepare("INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)").run(dibaPlan, dibaSource.id, 'diba-geography-guard', now, now);
    db.prepare("INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,?,?,'{}',?,?)").run(anchorPlan, publicSource.id, 'geography-anchor', now, now); db.close();
    const source = { sourceKey: 'diba-tourisme', sourceRecordId: 'diba-geography-guard' }; const finalTargetAnchor = { sourceKey: 'gencat-agenda', sourceRecordId: 'geography-anchor' };
    const mapping = { source, finalTargetAnchor, diagnostic: { currentSourcePlanId: dibaPlan, expectedCurrentTargetPlanId: anchorPlan } };
    const geography = { type: 'RESOLVE_MUNICIPALITY', source, finalTargetAnchor, geography: { resolutionType: 'EXACT_MUNICIPALITY', municipality: 'Viladrau', ruleId: 'test', deterministic: true }, diagnostic: { currentSourcePlanId: dibaPlan, expectedCurrentTargetPlanId: diagnosticPlan } };
    const policy = { mutationPlan: { phases: { finalSourceMappings: [mapping], explicitGeography: [geography] } }, activation: { publicActivationReady: false, blockers: [] }, summary: {} };
    await assert.rejects(applyDibaPolicyRehearsal({ databasePath: pair.rehearsal, realDatabasePath: pair.real, overrides: { version: 1, decisions: [] }, preparePlan: async () => ({ policy }) }), /geography target topology changed/);
    const after = openDatabase(pair.rehearsal, { readonly: true });
    assert.equal(after.prepare("SELECT plan_id FROM plan_sources WHERE source_record_id='diba-geography-guard'").get().plan_id, dibaPlan);
    assert.equal(after.prepare('SELECT municipality FROM plans WHERE id=?').get(anchorPlan).municipality, null);
    assert.equal(after.prepare('SELECT municipality FROM plans WHERE id=?').get(diagnosticPlan).municipality, null); after.close();
  } finally { fs.rmSync(pair.directory, { recursive: true, force: true }); }
});
