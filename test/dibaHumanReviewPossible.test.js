import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoPossibleOverrides, buildPossibleHumanReviewPack, renderPossibleHumanReviewMarkdown } from '../backend/src/diba/dibaHumanReviewPossible.js';

function fixture({ topology = 'one-to-one' } = {}) {
  const second = topology === 'many-to-one';
  const finding = (planId, recordId) => ({ sourceKey: 'diba-escenari', sourceRecordId: recordId, dibaPlanId: planId, candidatePublicPlanId: 10,
    diba: { planId, dataset: 'escenari', title: 'Obra singular', normalizedTitle: 'obra singular', startDate: '2026-09-10', endDate: '2026-09-10', municipality: 'Mataró', rawMunicipalityName: 'Mataró', rawIne: '08121', venue: null, address: null, coordinates: null, sourceUrl: `https://diba.example/${recordId}`, secondaryPayloadUrls: [], session: null },
    candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: false, addressMatch: false, coordinatesNear: false, urlMatch: false, supportingSignalCount: 0, matcherDisposition: 'POSSIBLE_NEEDS_HUMAN_REVIEW', reason: 'same title, municipality and overlapping interval, but no matching venue, address, URL or nearby coordinates' } });
  const findings = [finding(1, 'acte-1'), ...(second ? [finding(2, 'acte-2')] : [])]; const component = { componentId: 'conflict-1', dibaPlanIds: findings.map(({ dibaPlanId }) => dibaPlanId), candidatePlanIds: [10], pairCount: findings.length };
  const plans = new Map([[1, { id: 1, original_title: 'Obra singular', start_date: '2026-09-10', end_date: '2026-09-10', municipality: 'Mataró', status: 'active' }], [10, { id: 10, original_title: 'Obra singular', start_date: '2026-09-10', end_date: '2026-09-10', municipality: 'Mataró', status: 'active' }]]); if (second) plans.set(2, { id: 2, original_title: 'Obra singular', start_date: '2026-09-10', end_date: '2026-09-10', municipality: 'Mataró', status: 'active' });
  const sourcesByPlan = new Map([[1, [{ key: 'diba-escenari', source_record_id: 'acte-1', source_url: 'https://diba.example/acte-1', source_payload_json: '{}', enabled: 0, dataset_id: 'escenari' }]], [10, [{ key: 'gencat-agenda', source_record_id: 'g-1', source_url: 'https://gencat.example/g-1', source_payload_json: '{}', enabled: 1, dataset_id: 'agenda' }]]]); if (second) sourcesByPlan.set(2, [{ key: 'diba-escenari', source_record_id: 'acte-2', source_url: 'https://diba.example/acte-2', source_payload_json: '{}', enabled: 0, dataset_id: 'escenari' }]);
  const policy = { crossSource: { confirmed: [], possible: [{ component, findings, activationBlocker: true, decision: 'POSSIBLE_DUPLICATE_HUMAN_REVIEW' }] }, sameFeed: [], activation: { publicActivationReady: false } };
  return { auditReport: { currentPublicCandidates: { possible: findings } }, policy, state: { plansById: plans, sourcesByPlan, occurrencesByPlan: new Map() }, overrides: { decisions: [] } };
}

test('possible pack preserves 1:1 component identities and requires external review', () => {
  const input = fixture(); input.policy.crossSource.possible = Array.from({ length: 22 }, (_, index) => ({ ...input.policy.crossSource.possible[0], component: { ...input.policy.crossSource.possible[0].component, componentId: `conflict-${index + 1}` } }));
  const pack = buildPossibleHumanReviewPack(input); const component = pack.components[0];
  assert.equal(pack.summary.unresolvedPossibleComponents, 22); assert.equal(component.topology, '1 DIBA -> 1 public'); assert.equal(component.advisoryRecommendation.recommendedDisposition, 'UNCERTAIN'); assert.equal(component.externalReview.priority, 'REQUIRED');
  assert.deepEqual(component.publicCandidates[0].enabledPublicAnchor, { sourceKey: 'gencat-agenda', sourceRecordId: 'g-1' }); assert.match(renderPossibleHumanReviewMarkdown(pack), /possible-review-001/);
});

test('possible pack does not flatten N:1 topology and rejects an override on a possible source', () => {
  const input = fixture({ topology: 'many-to-one' }); input.policy.crossSource.possible = Array.from({ length: 22 }, (_, index) => ({ ...input.policy.crossSource.possible[0], component: { ...input.policy.crossSource.possible[0].component, componentId: `conflict-${index + 1}` } }));
  const pack = buildPossibleHumanReviewPack(input); assert.equal(pack.components[0].topology, 'N DIBA -> 1 public'); assert.equal(pack.components[0].advisoryRecommendation.recommendedDisposition, 'DEFER'); assert.match(pack.components[0].topologySafety, /do not decide any edge pair-by-pair/);
  assert.throws(() => assertNoPossibleOverrides(input.policy, { decisions: [{ source: { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1' } }] }), /already has reviewed override/);
});
