import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDibaMunicipalityPolicy } from '../backend/src/diba/dibaMunicipalityAliases.js';
import { validateDibaPolicyOverrides } from '../backend/src/diba/dibaPolicyOverrides.js';
import { planDibaPolicy } from '../backend/src/diba/dibaPolicyPlanner.js';
import { CROSS_SOURCE_DECISIONS, evaluateCrossSourceComponent, evaluateSameFeedComponent, publicFieldPlan, SAME_FEED_DECISIONS, stableAnchor } from '../backend/src/diba/dibaQualityPolicy.js';

function record(id, overrides = {}) {
  return { sourceRecordId: String(id), planId: Number(id), normalizedTitle: 'concert', municipality: 'Mataró', startDate: '2026-09-10', endDate: '2026-09-10', venue: 'Teatre', matcherSourceUrl: 'https://escenari.diba.cat/fitxa?id=123', session: { present: true, fields: { observacionsHorari: '10:00', durada: '60m', dies: null, scheduleText: '10:00' }, fingerprint: '10:00' }, ...overrides };
}
function cluster(records, overrides = {}) {
  return { clusterId: 'diba-escenari-1', sourceKey: 'diba-escenari', planIds: records.map(({ planId }) => planId), records, topology: { isClique: true }, evidence: records.length > 1 ? [{ addressMatch: true, coordinatesNear: false }] : [], ...overrides };
}
function finding(sourceRecordId, dibaPlanId, candidatePublicPlanId, overrides = {}) {
  return { sourceKey: 'diba-escenari', sourceRecordId: String(sourceRecordId), dibaPlanId, candidatePublicPlanId, candidateVisibility: { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE' }, evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: true, coordinatesNear: true, urlMatch: false }, ...overrides };
}

test('same-feed policy accepts only the full approved duplicate contract', () => {
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2)])).decision, SAME_FEED_DECISIONS.SAFE_CONSOLIDATE);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { session: { present: true, fields: { observacionsHorari: '12:00', durada: '60m' }, fingerprint: '12:00' } })])).decision, SAME_FEED_DECISIONS.KEEP_SEPARATE_SESSION);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { session: { present: true, fields: { observacionsHorari: '10:00', durada: '90m' }, fingerprint: '10:00-90' } })])).decision, SAME_FEED_DECISIONS.KEEP_SEPARATE_SESSION);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { session: { present: false, fields: {}, fingerprint: null } })])).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { startDate: '2026-09-11', endDate: '2026-09-11' })])).decision, SAME_FEED_DECISIONS.KEEP_SEPARATE_DATE);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2)], { topology: { isClique: false } })).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { matcherSourceUrl: 'https://escenari.diba.cat/programa' })])).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
});

test('same-feed distinct sessions defer because current model has no structured public session representation', () => {
  const result = evaluateSameFeedComponent(cluster([record(1), record(2, { session: { present: true, fields: { observacionsHorari: '12:00', durada: '60m' }, fingerprint: '12' } })]));
  assert.equal(result.publicSessionDistinguishable, false); assert.equal(result.activationDisposition, SAME_FEED_DECISIONS.DEFER);
});

test('cross-source policy requires component-level strong evidence', () => {
  const one = { componentId: 'one', dibaPlanIds: [1], candidatePlanIds: [10] };
  assert.equal(evaluateCrossSourceComponent(one, [finding('1', 1, 10)], new Map()).decision, CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN);
  assert.equal(evaluateCrossSourceComponent(one, [finding('1', 1, 10, { evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: true, coordinatesNear: false } })], new Map()).decision, CROSS_SOURCE_DECISIONS.POSSIBLE_DUPLICATE_HUMAN_REVIEW);
  assert.equal(evaluateCrossSourceComponent({ ...one, candidatePlanIds: [10, 11] }, [finding('1', 1, 10)], new Map()).decision, CROSS_SOURCE_DECISIONS.POSSIBLE_DUPLICATE_HUMAN_REVIEW);
});

test('N:1 is auto-linkable only after a safe same-feed reduction', () => {
  const component = { componentId: 'many', dibaPlanIds: [1, 2], candidatePlanIds: [10] }; const findings = [finding('1', 1, 10), finding('2', 2, 10)];
  assert.equal(evaluateCrossSourceComponent(component, findings, new Map()).decision, CROSS_SOURCE_DECISIONS.POSSIBLE_DUPLICATE_HUMAN_REVIEW);
  const same = new Map([['cluster', { decision: SAME_FEED_DECISIONS.SAFE_CONSOLIDATE, planIds: [1, 2] }]]);
  assert.equal(evaluateCrossSourceComponent(component, findings, same).decision, CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN);
});

test('overrides are source-identity based and fail closed', () => {
  const valid = validateDibaPolicyOverrides({ version: 1, decisions: [{ source: { sourceKey: 'diba-escenari', sourceRecordId: '1' }, decision: 'LINK_TO_EXISTING', target: { sourceKey: 'gencat-agenda', sourceRecordId: 'x' }, reason: 'reviewed', reviewedAt: '2026-09-01', reviewer: 'test' }] });
  assert.equal(valid.decisions.length, 1);
  assert.throws(() => validateDibaPolicyOverrides({ version: 1, decisions: [{ source: { sourceKey: 'diba', sourceRecordId: '1' }, decision: 'LINK_TO_EXISTING', targetPlanId: 1, reason: 'x', reviewedAt: '2026-09-01', reviewer: 'r' }] }), /requires a stable target/);
  assert.throws(() => validateDibaPolicyOverrides({ version: 1, decisions: [{ source: { sourceKey: 'diba', sourceRecordId: '1' }, decision: 'KEEP_SEPARATE', target: { sourceKey: 'x', sourceRecordId: 'y' }, reason: 'x', reviewedAt: '2026-09-01', reviewer: 'r' }] }), /must not include a target/);
  assert.throws(() => validateDibaPolicyOverrides({ version: 1, decisions: [{ source: { sourceKey: 'diba', sourceRecordId: '1' }, decision: 'DEFER', reason: 'x', reviewedAt: '2026-09-01', reviewer: 'r' }, { source: { sourceKey: 'diba', sourceRecordId: '1' }, decision: 'DEFER', reason: 'x', reviewedAt: '2026-09-01', reviewer: 'r' }] }), /Duplicate/);
});

test('municipality policy is explicit and never generic fuzzy resolution', () => {
  const candidate = (bucket, raw, municipality = null, ine = null) => resolveDibaMunicipalityPolicy({ rawMunicipalityName: raw, analysis: { bucket, candidateMunicipality: municipality, candidateIne: ine } });
  assert.equal(candidate('EXACT_MUNICIPALITY_NAME_CANDIDATE', 'Viladrau', 'Viladrau', '17220').resolutionType, 'EXACT_MUNICIPALITY');
  assert.equal(candidate('POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION', 'Fogars de Monclús').ine, '08081');
  assert.equal(candidate('POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION', 'La Poble de Lillet').ine, '08166');
  assert.equal(candidate('POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION', 'El Pont de Vilomara').ine, '08182');
  assert.equal(candidate('LOCALITY_OR_SUBMUNICIPAL', "Sant Pau d'Ordal").municipality, 'Subirats');
  assert.equal(candidate('COMARCA_OR_REGION', 'Alt Penedès').resolutionType, 'COMARCA_ONLY');
  assert.equal(candidate('MULTI_AREA_OR_SUPRAMUNICIPAL', 'Catalunya').municipality, null);
  assert.equal(candidate('UNKNOWN_REVIEW_REQUIRED', 'Something else').deterministic, false);
});

test('anchor and field plan are deterministic and preserve public ownership', () => {
  assert.equal(stableAnchor([{ sourceKey: 'diba-tourisme', sourceRecordId: 'z' }, { sourceKey: 'diba-escenari', sourceRecordId: 'a' }]).sourceKey, 'diba-escenari');
  const fields = publicFieldPlan(); assert.equal(fields.title, 'KEEP_EXISTING'); assert.equal(fields.description, 'KEEP_EXISTING'); assert.equal(fields.venue, 'KEEP_EXISTING'); assert.equal(fields.address, 'KEEP_EXISTING'); assert.equal(fields.coordinates, 'KEEP_EXISTING'); assert.equal(fields.categories, 'NEVER_FROM_DIBA'); assert.equal(fields.image, 'NEVER_FROM_DIBA'); assert.equal(fields.status, 'NEVER_FROM_DIBA'); assert.equal(fields['ranking/featured'], 'NEVER_FROM_DIBA'); assert.equal(fields['commerce/affiliate'], 'NEVER_FROM_DIBA'); assert.equal(fields.municipality, 'ONLY_EXPLICIT_GEOGRAPHY_OPERATION');
});

test('planner emits only stable-identity future operations and blocks active possible components', () => {
  const diba = { sourceKey: 'diba-escenari', sourceRecordId: '1', planId: 1, identity: { sourceKey: 'diba-escenari', sourceRecordId: '1' }, enabled: 0 };
  const publicSource = { sourceKey: 'gencat-agenda', sourceRecordId: 'g1', planId: 10, identity: { sourceKey: 'gencat-agenda', sourceRecordId: 'g1' }, enabled: 1 };
  const index = { byIdentity: new Map([['diba-escenari:1', [diba]], ['gencat-agenda:g1', [publicSource]]]), byPlan: new Map([[1, [diba]], [10, [publicSource]]]) };
  const auditReport = {
    sameFeed: { clusters: [{ ...cluster([record(1)], { distinctPlanCount: 1 }), distinctPlanCount: 1 }] }, currentPublicCandidates: {
      confirmed: [finding('1', 1, 10)], confirmedSummary: { conflictComponents: [{ componentId: 'confirmed', dibaPlanIds: [1], candidatePlanIds: [10] }] },
      possible: [finding('1', 1, 10, { sourceRecordId: '1', evidence: { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: false, coordinatesNear: false } })], possibleSummary: { conflictComponents: [{ componentId: 'possible', dibaPlanIds: [1], candidatePlanIds: [10] }] },
    }, unresolvedMunicipalities: { records: [] },
  };
  const result = planDibaPolicy({ auditReport, overrides: { version: 1, decisions: [] }, identityIndex: index });
  assert.equal(result.sameFeed.length, 0);
  assert.equal(result.operations[0].type, 'RELINK_DIBA_SOURCE_TO_FINAL_TARGET');
  assert.deepEqual(result.operations[0].source, { sourceKey: 'diba-escenari', sourceRecordId: '1' });
  assert.equal(result.activation.blockerCounts.ACTIVE_POSSIBLE_COMPONENT_WITHOUT_COMPLETE_REVIEWED_DISPOSITION, 1);
});

test('same-feed policy requires actual schedule/time evidence, never duration alone', () => {
  const durationOnly = { present: true, fields: { durada: '60m' } };
  assert.equal(evaluateSameFeedComponent(cluster([record(1, { session: durationOnly }), record(2, { session: durationOnly })])).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
  assert.equal(evaluateSameFeedComponent(cluster([record(1, { session: durationOnly }), record(2, { session: { present: true, fields: { durada: '90m' } } })])).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { session: durationOnly })])).decision, SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2)])).decision, SAME_FEED_DECISIONS.SAFE_CONSOLIDATE);
  assert.equal(evaluateSameFeedComponent(cluster([record(1), record(2, { session: { present: true, fields: { observacionsHorari: '10:00', scheduleText: '10:00', durada: '90m' } } })])).decision, SAME_FEED_DECISIONS.KEEP_SEPARATE_SESSION);
});

function entry(sourceKey, sourceRecordId, planId, enabled) {
  return { sourceKey, sourceRecordId: String(sourceRecordId), planId, enabled, identity: { sourceKey, sourceRecordId: String(sourceRecordId) } };
}
function indexOf(entries) {
  const byIdentity = new Map(); const byPlan = new Map();
  for (const value of entries) { const key = `${value.sourceKey}:${value.sourceRecordId}`; byIdentity.set(key, [value]); const plans = byPlan.get(value.planId) || []; plans.push(value); byPlan.set(value.planId, plans); }
  return { byIdentity, byPlan };
}
function componentAudit({ diba, candidates, possible = true, sameFeedClusters = [], geographyRecords = [] }) {
  const evidence = possible ? { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: false, coordinatesNear: false } : { titleExact: true, municipalityMatch: true, intervalRelation: 'identical', venueMatch: true, coordinatesNear: true };
  const findings = diba.map((value) => finding(value.sourceRecordId, value.planId, candidates[0].planId, { sourceKey: value.sourceKey, evidence }));
  return {
    sameFeed: { clusters: sameFeedClusters },
    currentPublicCandidates: {
      confirmed: possible ? [] : findings,
      confirmedSummary: { conflictComponents: possible ? [] : [{ componentId: 'confirmed', dibaPlanIds: diba.map(({ planId }) => planId), candidatePlanIds: candidates.map(({ planId }) => planId) }] },
      possible: possible ? findings : [],
      possibleSummary: { conflictComponents: possible ? [{ componentId: 'possible', dibaPlanIds: diba.map(({ planId }) => planId), candidatePlanIds: candidates.map(({ planId }) => planId) }] : [] },
    },
    unresolvedMunicipalities: { records: geographyRecords },
  };
}
function reviewed(source, target) { return { source: source.identity, decision: 'LINK_TO_EXISTING', target: target.identity, reason: 'reviewed test component', reviewedAt: '2026-09-01', reviewer: 'test' }; }

test('reviewed links are component-complete and constrained to a candidate enabled public target', () => {
  const a = entry('diba-escenari', 'a', 1, 0); const b = entry('diba-escenari', 'b', 2, 0); const publicTarget = entry('gencat-agenda', 'p', 10, 1);
  const unrelated = entry('other-public', 'u', 11, 1); const disabled = entry('disabled-public', 'd', 12, 0); const dibaTarget = entry('diba-tourisme', 'x', 13, 0);
  const base = { auditReport: componentAudit({ diba: [a, b], candidates: [publicTarget] }), identityIndex: indexOf([a, b, publicTarget, unrelated, disabled, dibaTarget]) };
  const plan = (decisions) => planDibaPolicy({ ...base, overrides: { version: 1, decisions } });
  assert.equal(plan([reviewed(a, publicTarget)]).crossSource.possible[0].review.reason, 'component review is incomplete');
  const accepted = plan([reviewed(a, publicTarget), reviewed(b, publicTarget)]);
  assert.equal(accepted.crossSource.possible[0].reviewedDecision, 'LINK_TO_EXISTING'); assert.equal(accepted.mutationPlan.phases.finalSourceMappings.length, 2);
  assert.equal(plan([reviewed(a, unrelated), reviewed(b, unrelated)]).crossSource.possible[0].review.reason, 'reviewed link target is outside this conflict component');
  assert.equal(plan([reviewed(a, disabled), reviewed(b, disabled)]).crossSource.possible[0].review.reason, 'reviewed link target is not an enabled non-DIBA public source');
  assert.equal(plan([reviewed(a, dibaTarget), reviewed(b, dibaTarget)]).crossSource.possible[0].review.reason, 'reviewed link target is not an enabled non-DIBA public source');
  const secondPublic = entry('gencat-agenda', 'p2', 11, 1); const conflicting = planDibaPolicy({ auditReport: componentAudit({ diba: [a, b], candidates: [publicTarget, secondPublic] }), identityIndex: indexOf([a, b, publicTarget, secondPublic]), overrides: { version: 1, decisions: [reviewed(a, publicTarget), reviewed(b, secondPublic)] } });
  assert.equal(conflicting.crossSource.possible[0].review.reason, 'reviewed links do not share one approved public canonical target');
  assert.equal(plan([]).crossSource.possible[0].activationBlocker, true);
});

test('phased plan composes safe consolidation directly to public final destination without numeric ordering', () => {
  const a = entry('diba-escenari', 'a', 900, 0); const b = entry('diba-escenari', 'b', 2, 0); const publicTarget = entry('gencat-agenda', 'p', 10, 1);
  const records = [record('a', { planId: 900 }), record('b', { planId: 2 })]; const safeCluster = cluster(records, { distinctPlanCount: 2, planIds: [900, 2] });
  const result = planDibaPolicy({ auditReport: componentAudit({ diba: [a], candidates: [publicTarget], possible: false, sameFeedClusters: [safeCluster] }), overrides: { version: 1, decisions: [] }, identityIndex: indexOf([a, b, publicTarget]) });
  const mappings = result.mutationPlan.phases.finalSourceMappings;
  assert.equal(mappings.length, 2); assert.ok(mappings.every(({ finalTargetAnchor }) => finalTargetAnchor.sourceKey === 'gencat-agenda'));
  assert.equal(result.summary.policyLevelConsolidationEdges, 1); assert.equal(result.summary.policyLevelPublicLinkEdges, 1); assert.equal(result.summary.finalUniqueSourceRelinks, 2);
  assert.equal(result.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans.length, 2);
  assert.ok(result.mutationPlan.phases.finalInvariants.includes('no public or shared plan was inactivated'));
});

test('orphan estimate is distinct-plan safe and never includes shared/public plans', () => {
  const a = entry('diba-escenari', 'a', 1, 0); const publicTarget = entry('gencat-agenda', 'p', 10, 1); const shared = entry('gencat-agenda', 'shared', 1, 1);
  const result = planDibaPolicy({ auditReport: componentAudit({ diba: [a], candidates: [publicTarget], possible: false }), overrides: { version: 1, decisions: [] }, identityIndex: indexOf([a, publicTarget, shared]) });
  assert.equal(result.mutationPlan.phases.inactivateOrphans.length, 0);
});

test('explicit geography is applied against the final target context and is non-degrading', () => {
  const diba = entry('diba-tourisme', 'geo', 1, 0); const publicTarget = entry('gencat-agenda', 'p', 10, 1);
  const sourceRecord = { sourceRecordId: 'geo', planId: 1, rawMunicipalityName: 'Viladrau', analysis: { bucket: 'EXACT_MUNICIPALITY_NAME_CANDIDATE', candidateMunicipality: 'Viladrau', candidateIne: '17220' } };
  const result = planDibaPolicy({ auditReport: componentAudit({ diba: [diba], candidates: [publicTarget], possible: false, geographyRecords: [sourceRecord] }), overrides: { version: 1, decisions: [] }, identityIndex: indexOf([diba, publicTarget]) });
  const operation = result.mutationPlan.phases.explicitGeography[0];
  assert.deepEqual(operation.finalTargetAnchor, publicTarget.identity); assert.match(operation.rule, /NOOP_IF_VALID_GEOGRAPHY_EXISTS/);
});
