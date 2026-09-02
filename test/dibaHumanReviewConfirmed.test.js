import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfirmedHumanReviewPack, renderConfirmedHumanReviewMarkdown } from '../backend/src/diba/dibaHumanReviewConfirmed.js';

function fixture({ identicalInterval = true, venueMatch = true } = {}) {
  const finding = {
    sourceKey: 'diba-escenari', sourceRecordId: 'acte-1', dibaPlanId: 1, candidatePublicPlanId: 10,
    diba: { planId: 1, dataset: 'escenari', title: 'Obra singular', normalizedTitle: 'obra singular', startDate: '2026-09-10', endDate: '2026-09-10', municipality: 'Mataró', rawMunicipalityName: 'Mataró', rawIne: '08121', venue: 'Teatre', address: null, coordinates: null, sourceUrl: 'https://escenari.diba.cat/fitxa?id=1', secondaryPayloadUrls: [], session: null },
    evidence: { titleExact: true, municipalityMatch: true, intervalRelation: identicalInterval ? 'identical' : 'overlapping', venueMatch, addressMatch: false, coordinatesNear: false, urlMatch: false, reason: 'same title, municipality and overlapping interval; matching venue' },
  };
  const component = { componentId: 'conflict-1', dibaPlanIds: [1], candidatePlanIds: [10], pairCount: 1 };
  return {
    auditReport: { currentPublicCandidates: { confirmed: [finding], confirmedSummary: { conflictComponents: [component] } } },
    policy: { crossSource: { confirmed: [{ componentId: 'conflict-1', decision: 'POSSIBLE_DUPLICATE_HUMAN_REVIEW', reasons: ['cross-source evidence is not venue+coordinates or equivalent event-specific identity'] }], possible: [] }, sameFeed: [] },
    state: {
      plansById: new Map([
        [1, { id: 1, original_title: 'Obra singular', start_date: '2026-09-10', end_date: '2026-09-10', municipality: 'Mataró', status: 'active' }],
        [10, { id: 10, original_title: 'Obra singular', start_date: '2026-09-10', end_date: identicalInterval ? '2026-09-10' : '2026-10-01', municipality: 'Mataró', venue_name: 'Teatre', status: 'active', website_url: 'https://example.test/event' }],
      ]),
      sourcesByPlan: new Map([
        [1, [{ key: 'diba-escenari', source_record_id: 'acte-1', source_url: 'https://escenari.diba.cat/fitxa?id=1', source_payload_json: '{}', enabled: 0, dataset_id: 'escenari' }]],
        [10, [{ key: 'gencat-agenda', source_record_id: 'g-1', source_url: 'https://gencat.example/event', source_payload_json: '{}', enabled: 1, dataset_id: 'agenda' }]],
      ]),
      occurrencesByPlan: new Map(),
    },
  };
}

test('confirmed review pack keeps review at component level with stable identities and no numeric target recommendation', () => {
  const pack = buildConfirmedHumanReviewPack(fixture()); const component = pack.components[0];
  assert.equal(pack.summary.unresolvedConfirmedComponents, 1); assert.equal(component.reviewComponentId, 'confirmed-review-001');
  assert.equal(component.topology, '1 DIBA -> 1 public'); assert.deepEqual(component.diba[0].stableIdentity, { sourceKey: 'diba-escenari', sourceRecordId: 'acte-1' });
  assert.deepEqual(component.advisoryRecommendation.target, { sourceKey: 'gencat-agenda', sourceRecordId: 'g-1' });
  assert.equal(component.advisoryRecommendation.recommendedDisposition, 'LINK_TO_EXISTING'); assert.equal(component.advisoryRecommendation.confidence, 'MEDIUM');
  assert.match(component.automaticLinkBlocker[0], /coordinates/); assert.match(renderConfirmedHumanReviewMarkdown(pack), /confirmed-review-001/);
});

test('interval disagreement remains a human defer and never becomes an automatic decision', () => {
  const pack = buildConfirmedHumanReviewPack(fixture({ identicalInterval: false })); const advice = pack.components[0].advisoryRecommendation;
  assert.equal(advice.recommendedDisposition, 'DEFER'); assert.equal(advice.confidence, 'MEDIUM'); assert.equal(advice.target, null);
  assert.equal(pack.summary.recommendationCounts.DEFER, 1);
});
