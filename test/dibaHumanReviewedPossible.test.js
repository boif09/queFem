import assert from 'node:assert/strict';
import test from 'node:test';
import { APPROVED_POSSIBLE_LINKS, appendApprovedPossibleOverrides, summarizeReviewedPossiblePolicy, validateE2Prewrite } from '../backend/src/diba/dibaHumanReviewedPossible.js';
import { planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';

function fixture({ omitBubbleSecond = false } = {}) {
  const links = APPROVED_POSSIBLE_LINKS.filter(({ source }) => !omitBubbleSecond || source.sourceRecordId !== 'escenari112430068591411746191364562'); const byTarget = new Map(); const entries = []; const findings = []; let plan = 1;
  for (const link of links) { let targetPlan = byTarget.get(link.target.sourceRecordId); if (!targetPlan) { targetPlan = 100 + byTarget.size; byTarget.set(link.target.sourceRecordId, targetPlan); entries.push({ sourceKey: link.target.sourceKey, sourceRecordId: link.target.sourceRecordId, planId: targetPlan, enabled: 1, identity: link.target }); } const source = { sourceKey: link.source.sourceKey, sourceRecordId: link.source.sourceRecordId, planId: plan++, enabled: 0, identity: link.source }; entries.push(source); findings.push({ sourceKey: source.sourceKey, sourceRecordId: source.sourceRecordId, dibaPlanId: source.planId, candidatePublicPlanId: targetPlan, candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: false, addressMatch: false, urlMatch: false, coordinatesNear: false } }); }
  for (let index = 0; index < 11; index += 1) { const source = { sourceKey: 'diba-old', sourceRecordId: `old-${index}`, planId: 1000 + index, enabled: 0, identity: { sourceKey: 'diba-old', sourceRecordId: `old-${index}` } }; const target = { sourceKey: 'gencat-agenda', sourceRecordId: `old-target-${index}`, planId: 2000 + index, enabled: 1, identity: { sourceKey: 'gencat-agenda', sourceRecordId: `old-target-${index}` } }; entries.push(source, target); }
  const byIdentity = new Map(); const byPlan = new Map(); for (const entry of entries) { const key = `${entry.identity.sourceKey}:${entry.identity.sourceRecordId}`; byIdentity.set(key, [entry]); byPlan.set(entry.planId, [entry]); }
  const components = []; for (const [targetRecordId, targetPlan] of byTarget) { const componentFindings = findings.filter(({ candidatePublicPlanId }) => candidatePublicPlanId === targetPlan); components.push({ componentId: `possible-${components.length + 1}`, dibaPlanIds: componentFindings.map(({ dibaPlanId }) => dibaPlanId), candidatePlanIds: [targetPlan], pairCount: componentFindings.length }); }
  const auditReport = { sameFeed: { clusters: [] }, currentPublicCandidates: { confirmed: [], confirmedSummary: { conflictComponents: [] }, possible: findings, possibleSummary: { conflictComponents: components } }, unresolvedMunicipalities: { records: [] } };
  const existing = { version: 1, decisions: Array.from({ length: 11 }, (_, index) => ({ source: { sourceKey: 'diba-old', sourceRecordId: `old-${index}` }, target: { sourceKey: 'gencat-agenda', sourceRecordId: `old-target-${index}` }, decision: 'LINK_TO_EXISTING', reason: 'previous confirmed', reviewedAt: '2026-09-02', reviewer: 'human-review' })) };
  const policyExisting = { crossSource: { possible: components.map((component) => ({ component, findings: findings.filter(({ dibaPlanId, candidatePublicPlanId }) => component.dibaPlanIds.includes(dibaPlanId) && component.candidatePlanIds.includes(candidatePublicPlanId)), activationBlocker: true })) } };
  return { links, auditReport, identityIndex: { byIdentity, byPlan }, existing, policyExisting };
}

test('E2 validates exactly twenty-three stable approved sources and preserves BubbleBike as a component-complete two-to-one review', () => {
  const input = fixture(); const payloads = new Map([['diba-escenari:escenari112430068591411746191364560', { data_inici: '2026-09-26 11:45:00' }], ['diba-escenari:escenari112430068591411746191364562', { data_inici: '2026-09-26 18:00:00' }]]);
  const preflight = validateE2Prewrite({ existingOverrides: input.existing, policy: input.policyExisting, identityIndex: input.identityIndex, sourcePayloadByIdentity: payloads });
  assert.equal(preflight.approvedCount, 23); assert.equal(preflight.validation.length, 23); assert.deepEqual(preflight.bubbleBike.sessionStarts.sort(), ['2026-09-26 11:45:00', '2026-09-26 18:00:00']);
  const appended = appendApprovedPossibleOverrides(input.existing); assert.equal(appended.decisions.length, 34);
  assert.deepEqual(appended.decisions.slice(0, 11), input.existing.decisions);
});

test('E2 planner creates 21 one-to-one plus two BubbleBike mappings and refuses a partial BubbleBike review', () => {
  const input = fixture(); const overrides = appendApprovedPossibleOverrides(input.existing); const policy = planDibaPolicy({ auditReport: input.auditReport, overrides, identityIndex: input.identityIndex }); const summary = summarizeReviewedPossiblePolicy({ policy, identityIndex: input.identityIndex });
  assert.equal(summary.reviewedPossibleComponents, 22); assert.equal(summary.reviewedPossibleSourceMappings, 23); assert.equal(summary.unexpectedMappings.length, 0); assert.equal(summary.bubbleBike.mappingCount, 2); assert.equal(summary.bubbleBike.target.sourceRecordId, '2026071400044@f3789cc34f003307');
  const partial = fixture({ omitBubbleSecond: true }); assert.throws(() => validateE2Prewrite({ existingOverrides: partial.existing, policy: partial.policyExisting, identityIndex: partial.identityIndex }), /approved sources do not exactly match/);
});
