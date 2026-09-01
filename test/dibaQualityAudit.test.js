import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  auditDibaQuality, buildSameFeedClusters, classifyUnresolvedMunicipality, dibaEvidence,
  reconcileHistoricalAmbiguities, runDibaQualityAudit, scanCurrentPublicDuplicateCandidates,
} from '../backend/src/diba/dibaQualityAudit.js';
import { openDatabase } from '../backend/src/db/database.js';
import { migrate } from '../backend/src/db/migrate.js';

function record(id, overrides = {}) {
  return {
    sourceKey: 'diba-escenari', dataset: 'escenari', sourceRecordId: String(id), planId: Number(id),
    title: 'Concert de prova', normalizedTitle: 'concert-prova', startDate: '2026-09-10', endDate: '2026-09-10',
    municipality: 'Mataró', normalizedMunicipality: 'mataro', venue: 'Teatre', address: 'Carrer Major 1',
    sourceUrl: 'https://diba.test/event', matcherSourceUrl: 'https://diba.test/event', matcherCandidateUrls: ['https://diba.test/event'],
    coordinates: { latitude: 41.54, longitude: 2.44 }, dibaOnly: true, enabledSourceKeys: [], status: 'active',
    session: { present: false, fields: {}, fingerprint: null }, categories: ['musica'], ...overrides,
  };
}
function publicPlan(id, overrides = {}) {
  const value = record(`public-${id}`, { planId: id, dibaOnly: false, enabledSourceKeys: ['gencat-agenda'], ...overrides });
  return { ...value, id, planId: id, matcherCandidateUrls: overrides.matcherCandidateUrls ?? ['https://diba.test/event'] };
}

test('a real transitive non-clique is one component and never inherits high confidence', () => {
  const records = [
    record(1, { venue: 'A', address: 'shared', matcherSourceUrl: 'https://a', matcherCandidateUrls: ['https://a'], coordinates: null }),
    record(2, { venue: 'B', address: 'shared', matcherSourceUrl: 'https://b', matcherCandidateUrls: ['https://b'], coordinates: null }),
    record(3, { venue: 'B', address: 'other', matcherSourceUrl: 'https://c', matcherCandidateUrls: ['https://c'], coordinates: null }),
  ];
  const [cluster] = buildSameFeedClusters(records);
  assert.equal(cluster.sourceRecordCount, 3);
  assert.deepEqual(cluster.topology, { memberCount: 3, actualEdgeCount: 2, possibleEdgeCount: 3, isClique: false });
  assert.equal(cluster.classification, 'NEEDS_HUMAN_REVIEW');
});

test('same-feed session conflicts downgrade a clique and schedule absence remains explicit', () => {
  const conflicting = buildSameFeedClusters([record(1, { session: { present: true, fields: { observacionsHorari: '10:00' }, fingerprint: '10' } }), record(2, { session: { present: true, fields: { observacionsHorari: '12:00' }, fingerprint: '12' } })])[0];
  assert.equal(conflicting.sessionEvidence.comparison, 'CONFLICTING_SESSION_EVIDENCE');
  assert.equal(conflicting.classification, 'NEEDS_HUMAN_REVIEW');
  assert.equal(buildSameFeedClusters([record(3), record(4)])[0].sessionEvidence.comparison, 'UNKNOWN_ABSENT');
});

test('current scanner reports confirmed and possible pairs separately with bipartite cardinality', () => {
  const dibaA = record(1);
  const dibaB = record(2, { sourceRecordId: 'two', planId: 2 });
  const result = scanCurrentPublicDuplicateCandidates({ dibaRecords: [dibaA, dibaB], publicPlans: [publicPlan(100), publicPlan(101)], historicalPairs: new Set(), historicalSourceRecords: new Set() });
  assert.equal(result.confirmedSummary.pairCount, 4);
  assert.equal(result.confirmedSummary.distinctDibaSourceRecordCount, 2);
  assert.equal(result.confirmedSummary.distinctDibaPlanCount, 2);
  assert.equal(result.confirmedSummary.distinctCandidatePlanCount, 2);
  assert.equal(result.confirmedSummary.distinctConflictComponentCount, 1);
  assert.deepEqual(result.confirmedSummary.conflictComponents[0].dibaPlanIds, [1, 2]);
  assert.deepEqual(result.confirmedSummary.conflictComponents[0].candidatePlanIds, [100, 101]);

  const possibleDiba = record(3, { venue: null, address: null, coordinates: null, matcherSourceUrl: 'https://diba.test/possible' });
  const possiblePublic = publicPlan(102, { venue: null, address: null, coordinates: null, matcherCandidateUrls: ['https://public.test/other'] });
  const possible = scanCurrentPublicDuplicateCandidates({ dibaRecords: [possibleDiba], publicPlans: [possiblePublic], historicalPairs: new Set(), historicalSourceRecords: new Set() });
  assert.equal(possible.confirmedSummary.pairCount, 0);
  assert.equal(possible.possibleSummary.pairCount, 1);
  assert.equal(possible.possible[0].classification, 'POSSIBLE_NEEDS_HUMAN_REVIEW');
});

test('inactive enabled-source candidates remain diagnostics and are not current two-card risks', () => {
  const result = scanCurrentPublicDuplicateCandidates({ dibaRecords: [record(1)], publicPlans: [publicPlan(100, { status: 'inactive', inactive_at: '2026-08-01T00:00:00Z' })] });
  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].candidateVisibility.state, 'ENABLED_SOURCE_INACTIVE');
  assert.equal(result.confirmedSummary.activePlanStateTwoCardRiskPairCount, 0);
});

test('historical overlap distinguishes exact pair, historic source and a new source record', () => {
  const diba = record(1, { sourceRecordId: 'historic' });
  const result = scanCurrentPublicDuplicateCandidates({
    dibaRecords: [diba], publicPlans: [publicPlan(10), publicPlan(11)],
    historicalPairs: new Set(['diba-escenari:historic:10']), historicalSourceRecords: new Set(['diba-escenari:historic']),
  });
  assert.equal(result.confirmed.find(({ candidatePublicPlanId }) => candidatePublicPlanId === 10).historicalOverlap.kind, 'EXACT_FIRST_IMPORT_PAIR');
  assert.equal(result.confirmed.find(({ candidatePublicPlanId }) => candidatePublicPlanId === 11).historicalOverlap.kind, 'HISTORICALLY_AMBIGUOUS_SOURCE_RECORD');
  assert.equal(result.confirmedSummary.historicalOverlapPairCounts.EXACT_FIRST_IMPORT_PAIR, 1);
});

test('historical reconciliation exposes selected first run and active versus inactive current state', () => {
  const dibaRecord = record(1, { sourceKey: 'diba-tourisme', planId: 10 });
  const plansById = new Map([[10, { id: 10, status: 'active' }], [20, { id: 20, status: 'active' }], [30, { id: 30, status: 'inactive', inactive_at: 'x' }]]);
  const allSourcesByPlan = new Map([[10, [{ key: 'diba-tourisme', enabled: 0 }]], [20, [{ key: 'gencat-agenda', enabled: 1 }]], [30, [{ key: 'gencat-agenda', enabled: 1 }]]]);
  const originalRuns = [{ sourceKey: 'diba-tourisme', importRunId: 7, summary_json: JSON.stringify({ ambiguousDetails: [{ diba: { acteId: '1' }, candidatePlan: { id: 20 } }, { diba: { acteId: '1' }, candidatePlan: { id: 30 } }] }) }];
  const result = reconcileHistoricalAmbiguities({ originalRuns, dibaRecordsByKey: new Map([['diba-tourisme:1', dibaRecord]]), plansById, allSourcesByPlan });
  assert.deepEqual(result.firstCompletedRuns, [{ sourceKey: 'diba-tourisme', importRunId: 7 }]);
  assert.equal(result.summary.findingCount, 2);
  assert.equal(result.findings[0].classification, 'PUBLIC_DUPLICATE_RISK');
  assert.equal(result.findings[1].classification, 'ENABLED_SOURCE_INACTIVE_DIAGNOSTIC');
});

test('secondary payload URLs cannot confirm a matcher-possible pair', () => {
  const left = record(1, { venue: null, address: null, coordinates: null, matcherSourceUrl: 'https://diba.test/primary', secondaryPayloadUrls: ['https://shared.test/secondary'] });
  const right = publicPlan(10, { venue: null, address: null, coordinates: null, matcherCandidateUrls: ['https://shared.test/secondary'] });
  const evidence = dibaEvidence(left, right);
  assert.equal(evidence.urlMatch, false);
  assert.equal(evidence.matcherDisposition, 'POSSIBLE_NEEDS_HUMAN_REVIEW');
});

test('municipality candidates need positive evidence and never auto-resolve', () => {
  const references = [
    { municipality: 'Viladrau', ine: '17220', comarca: 'Osona' }, { municipality: 'els Pallaresos', ine: '43100', comarca: 'Tarragonès' },
    { municipality: 'Fogars de Montclús', ine: '08081', comarca: 'Vallès Oriental' }, { municipality: 'la Pobla de Lillet', ine: '08166', comarca: 'Berguedà' },
    { municipality: 'el Pont de Vilomara i Rocafort', ine: '08182', comarca: 'Bages' }, { municipality: 'Subirats', ine: '08273', comarca: 'Alt Penedès' },
  ];
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: 'Viladrau' }, references).candidateIne, '17220');
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: 'els Pallaresos' }, references).candidateIne, '43100');
  for (const name of ['Fogars de Monclús', 'La Poble de Lillet', 'El Pont de Vilomara']) assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: name }, references).bucket, 'POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION');
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: "Sant Pau d'Ordal" }, references).bucket, 'LOCALITY_OR_SUBMUNICIPAL');
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: 'Osona' }, references).bucket, 'COMARCA_OR_REGION');
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: 'Xarxa de Parcs Naturals' }, references).bucket, 'MULTI_AREA_OR_SUPRAMUNICIPAL');
  assert.equal(classifyUnresolvedMunicipality({ rawMunicipalityName: null }, references).bucket, 'MISSING_NAME');
});

test('actual readonly driver audit leaves a temporary SQLite file byte-identical and rejects writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quefem-quality-audit-')); const databasePath = path.join(directory, 'test.sqlite');
  try {
    const db = openDatabase(databasePath); migrate(db);
    const source = db.prepare("SELECT id FROM sources WHERE key='diba-tourisme'").get(); const now = '2026-09-01T10:00:00Z';
    const planId = Number(db.prepare("INSERT INTO plans (kind,fingerprint,original_title,start_date,end_date,municipality,status,created_at,updated_at) VALUES ('event','audit|1','Concert de prova','2026-09-10','2026-09-10','Mataró','active',?,?)").run(now, now).lastInsertRowid);
    const payload = JSON.stringify({ acte_id: '1', titol: 'Concert de prova', data_inici: '2026-09-10', data_fi: '2026-09-10', rel_municipis: {}, grup_adreca: {} });
    db.prepare('INSERT INTO plan_sources (plan_id,source_id,source_record_id,source_payload_json,imported_at,last_seen_at) VALUES (?,? ,?, ?,?,?)').run(planId, source.id, '1', payload, now, now); db.close();
    const before = createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
    const report = await runDibaQualityAudit({ databasePath });
    const after = createHash('sha256').update(fs.readFileSync(databasePath)).digest('hex');
    assert.equal(report.readOnly, true); assert.equal(after, before);
    const readonly = openDatabase(databasePath, { readonly: true }); assert.throws(() => readonly.prepare("INSERT INTO plans (kind,fingerprint,original_title,created_at,updated_at) VALUES ('event','write','no','x','x')").run()); readonly.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('audit report cardinalities are internally recomputable', () => {
  const result = scanCurrentPublicDuplicateCandidates({ dibaRecords: [record(1)], publicPlans: [publicPlan(10), publicPlan(11)] });
  assert.equal(result.confirmedSummary.pairCount, result.confirmed.length);
  assert.equal(result.confirmedSummary.conflictComponents.reduce((total, component) => total + component.pairCount, 0), result.confirmed.length);
  assert.equal(result.possibleSummary.pairCount, 0);
});
