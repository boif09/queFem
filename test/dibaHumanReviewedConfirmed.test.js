import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

const source = { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1', planId: 1, enabled: 0, identity: { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1' } };
const target = { sourceKey: 'gencat-agenda', sourceRecordId: 'public-1', planId: 10, enabled: 1, identity: { sourceKey: 'gencat-agenda', sourceRecordId: 'public-1' } };
const index = { byIdentity: new Map([['diba-escenari:acte-1', [source]], ['gencat-agenda:public-1', [target]]]), byPlan: new Map([[1, [source]], [10, [target]]]) };
const finding = { sourceKey: source.sourceKey, sourceRecordId: source.sourceRecordId, dibaPlanId: 1, candidatePublicPlanId: 10, candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: true, coordinatesNear: false } };
const auditReport = { sameFeed: { clusters: [] }, currentPublicCandidates: { confirmed: [finding], confirmedSummary: { conflictComponents: [{ componentId: 'confirmed-1', dibaPlanIds: [1], candidatePlanIds: [10] }] }, possible: [], possibleSummary: { conflictComponents: [] } }, unresolvedMunicipalities: { records: [] } };
const reviewed = { version: 1, decisions: [{ source: source.identity, decision: 'LINK_TO_EXISTING', target: target.identity, reason: 'human review', reviewedAt: '2026-09-02', reviewer: 'human-review' }] };

test('a complete human-reviewed CONFIRMED 1:1 component becomes one provenance-only planned link', () => {
  const result = planDibaPolicy({ auditReport, overrides: reviewed, identityIndex: index });
  assert.equal(result.crossSource.confirmed[0].decision, 'LINK_TO_EXISTING'); assert.equal(result.crossSource.confirmed[0].reviewedDecision, 'LINK_TO_EXISTING');
  assert.equal(result.mutationPlan.phases.finalSourceMappings.length, 1); const mapping = result.mutationPlan.phases.finalSourceMappings[0];
  assert.deepEqual(mapping.source, source.identity); assert.deepEqual(mapping.finalTargetAnchor, target.identity);
  assert.equal(mapping.fieldPlan.title, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.start_date, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.venue, 'KEEP_EXISTING'); assert.equal(mapping.fieldPlan.coordinates, 'KEEP_EXISTING');
  assert.equal(mapping.fieldPlan.categories, 'NEVER_FROM_DIBA'); assert.equal(mapping.fieldPlan.image, 'NEVER_FROM_DIBA'); assert.equal(mapping.fieldPlan['commerce/affiliate'], 'NEVER_FROM_DIBA');
  assert.equal(result.crossSource.possible.length, 0);
});

test('the approved override file contains exactly eleven stable human LINK decisions without numeric targets', async () => {
  const payload = JSON.parse(await fs.readFile('data-policy/diba-link-overrides.json', 'utf8')); const overrides = validateDibaPolicyOverrides(payload);
  assert.equal(overrides.decisions.length, 11); assert.ok(overrides.decisions.every(({ decision, source: itemSource, target: itemTarget, reviewedAt, reviewer }) => decision === 'LINK_TO_EXISTING' && itemSource.sourceKey.startsWith('diba-') && itemTarget.sourceKey === 'gencat-agenda' && reviewedAt === '2026-09-02' && reviewer === 'human-review'));
  assert.ok(overrides.decisions.every((item) => !Object.hasOwn(item, 'planId') && !Object.hasOwn(item, 'targetPlanId')));
});
