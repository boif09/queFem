import { identityKey, validateDibaPolicyOverrides } from './dibaPolicyOverrides.js';

const REVIEWED_AT = '2026-09-03';
const REVIEWER = 'human-review';
const COMMON_REASON = 'Human external/manual review confirmed the same real-world event despite insufficient venue, address, URL or coordinate corroboration for automatic policy.';

function stable(sourceKey, sourceRecordId) { return { sourceKey, sourceRecordId: String(sourceRecordId) }; }
function isDiba(entry) { return String(entry?.sourceKey || entry?.identity?.sourceKey || '').startsWith('diba-'); }
function componentSources(component) { return [...new Map(component.findings.map(({ sourceKey, sourceRecordId }) => { const value = stable(sourceKey, sourceRecordId); return [identityKey(value), value]; })).values()]; }
function componentForSource(policy, source) { return policy.crossSource.possible.find(({ findings }) => findings.some((item) => item.sourceKey === source.sourceKey && String(item.sourceRecordId) === String(source.sourceRecordId))) || null; }
function resolveExactly(index, identity, label) {
  const entries = index.byIdentity.get(identityKey(identity)) || [];
  if (entries.length !== 1) throw new Error(`${label} ${identityKey(identity)} must resolve exactly once; found ${entries.length}.`);
  return entries[0];
}
function countBy(items, keyOf) { const result = {}; for (const item of items) { const key = keyOf(item); result[key] = (result[key] || 0) + 1; } return result; }

export const APPROVED_POSSIBLE_LINKS = Object.freeze([
  ['escenari136611834552013661211366159', '2026072700010@3d84022daa3ce860'],
  ['escenari120008434552012000881366008', '2026072700005@52c7bcaec1faf704'],
  ['escenari1180435235913653671366035', '2026072400011@90d5368f687c346e'],
  ['escenari24989534552012188881366153', '2026072700006@c9b588eac5b160ee'],
  ['escenari1256174235913653201366037', '2026072400012@34e7ac207a45299b'],
  ['escenari121577322713146771364695', '2026071400047@951a6f096da8bf31'],
  ['escenari18482609680322661365178', '2026071400035@63b3d555cc18e095'],
  ['escenari33484834552013661241366161', '2026072700012@565c01aacf969a56'],
  ['escenari7280235913658601366045', '2026071000001@69e7ce4a7f6c598f'],
  ['escenari5515231934305515261364687', '2026071300035@5af66be7d8599e31'],
  ['escenari7658221313021661365213', '2026071500002@3948a2a3d9276b96'],
  ['escenari14440235913660531366145', '2026072400017@b25d11de4a547f10'],
  ['escenari73152359118051366031', '2026071300005@8aae2dd8e2d76e16'],
  ['escenari91081668599210738291364655', '20260619026@bd13944c0e3bdbc6'],
  ['escenari523200136475212600691365238', '20260619015@012511266e45b3c4'],
  ['escenari136608634552013660891366095', '2026071000006@802802407d04f913'],
  ['escenari22184235913661071366151', '2026072700004@6b7c1847bc8b3528'],
  ['escenari1218813235912188161366039', '2026072400016@f231bc945c6b7c10'],
  ['escenari1039157235913660091366015', '2026072700009@6b56e500178e186b'],
  ['escenari1313843235913641571366033', '2026071300006@f698b4b5ee83620a'],
  ['escenari1174850235911748531366029', '2026071000008@4b3eca8b54a5d54e'],
  ['escenari112430068591411746191364560', '2026071400044@f3789cc34f003307', 'Human review verified this DIBA record is the 11:45 BubbleBike session represented by the Gencat canonical schedule “11.45 i 18 h”; automatic corroboration was insufficient.'],
  ['escenari112430068591411746191364562', '2026071400044@f3789cc34f003307', 'Human review verified this DIBA record is the 18:00 BubbleBike session represented by the Gencat canonical schedule “11.45 i 18 h”; automatic corroboration was insufficient.'],
].map(([sourceRecordId, targetRecordId, reason]) => Object.freeze({
  source: stable('diba-escenari', sourceRecordId), target: stable('gencat-agenda', targetRecordId), decision: 'LINK_TO_EXISTING', reason: reason || COMMON_REASON, reviewedAt: REVIEWED_AT, reviewer: REVIEWER,
})));

export function approvedPossibleSourceKeys() { return new Set(APPROVED_POSSIBLE_LINKS.map(({ source }) => identityKey(source))); }

export function validateE2Prewrite({ existingOverrides, policy, identityIndex, sourcePayloadByIdentity = new Map() }) {
  const existing = validateDibaPolicyOverrides(existingOverrides);
  if (existing.decisions.length !== 11) throw new Error(`E2 expects exactly 11 existing CONFIRMED override decisions; found ${existing.decisions.length}.`);
  if (!existing.decisions.every(({ decision, reviewedAt, reviewer }) => decision === 'LINK_TO_EXISTING' && reviewedAt === '2026-09-02' && reviewer === REVIEWER)) throw new Error('E2 existing override state is not the expected approved CONFIRMED decision set.');
  if (new Set(APPROVED_POSSIBLE_LINKS.map(({ source }) => identityKey(source))).size !== 23) throw new Error('E2 approved POSSIBLE decisions must contain 23 unique stable sources.');
  const possible = policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker);
  if (possible.length !== 22) throw new Error(`E2 expects exactly 22 unresolved POSSIBLE components; found ${possible.length}.`);
  const existingKeys = new Set(existing.decisions.map(({ source }) => identityKey(source))); const approvedKeys = approvedPossibleSourceKeys();
  const currentPossibleKeys = new Set(possible.flatMap(componentSources).map(identityKey));
  if (currentPossibleKeys.size !== 23 || currentPossibleKeys.size !== approvedKeys.size || [...approvedKeys].some((key) => !currentPossibleKeys.has(key))) throw new Error('E2 approved sources do not exactly match the current unresolved POSSIBLE source set.');
  const validation = [];
  for (const decision of APPROVED_POSSIBLE_LINKS) {
    const sourceKey = identityKey(decision.source); if (existingKeys.has(sourceKey)) throw new Error(`E2 source already has an override: ${sourceKey}.`);
    const source = resolveExactly(identityIndex, decision.source, 'E2 source'); const target = resolveExactly(identityIndex, decision.target, 'E2 target');
    if (!isDiba(source)) throw new Error(`E2 source is not DIBA provenance: ${sourceKey}.`);
    if (isDiba(target) || target.enabled !== 1) throw new Error(`E2 target is not enabled non-DIBA public provenance: ${identityKey(decision.target)}.`);
    const possibleComponent = componentForSource(policy, decision.source);
    if (!possibleComponent || !possibleComponent.activationBlocker) throw new Error(`E2 source is not in a current unresolved POSSIBLE component: ${sourceKey}.`);
    if (!possibleComponent.component.candidatePlanIds.includes(target.planId)) throw new Error(`E2 target is outside the exact POSSIBLE component for ${sourceKey}.`);
    validation.push({ source: decision.source, target: decision.target, sourcePlanIdDiagnostic: source.planId, targetPlanIdDiagnostic: target.planId, componentId: possibleComponent.component.componentId, sourceResolvesExactlyOnce: true, targetResolvesExactlyOnce: true, sourceIsDiba: true, targetEnabledNonDiba: true, targetInExactComponent: true, noNumericDurableIdentity: true });
  }
  const bubbleSources = APPROVED_POSSIBLE_LINKS.filter(({ source }) => source.sourceRecordId.startsWith('escenari11243006859141174619136456'));
  if (bubbleSources.length !== 2 || new Set(bubbleSources.map(({ target }) => identityKey(target))).size !== 1) throw new Error('E2 BubbleBike decisions must contain both sources and one common target.');
  const bubbleComponent = componentForSource(policy, bubbleSources[0].source);
  if (!bubbleComponent || componentForSource(policy, bubbleSources[1].source)?.component.componentId !== bubbleComponent.component.componentId || bubbleComponent.component.dibaPlanIds.length !== 2 || bubbleComponent.component.candidatePlanIds.length !== 1) throw new Error('E2 BubbleBike must remain one 2->1 conflict component.');
  const expectedBubbleTarget = identityKey(bubbleSources[0].target); if (!bubbleComponent.component.candidatePlanIds.includes(resolveExactly(identityIndex, bubbleSources[0].target, 'E2 BubbleBike target').planId)) throw new Error('E2 BubbleBike target is not the sole component candidate.');
  const bubbleTimes = bubbleSources.map(({ source }) => String(sourcePayloadByIdentity.get(identityKey(source))?.data_inici || ''));
  if (sourcePayloadByIdentity.size && (!bubbleTimes.includes('2026-09-26 11:45:00') || !bubbleTimes.includes('2026-09-26 18:00:00'))) throw new Error(`E2 BubbleBike session precondition failed; expected 11:45 and 18:00, found ${bubbleTimes.join(', ')}.`);
  return { existingCount: existing.decisions.length, approvedCount: APPROVED_POSSIBLE_LINKS.length, validation, bubbleBike: { componentId: bubbleComponent.component.componentId, sources: bubbleSources.map(({ source }) => source), target: bubbleSources[0].target, targetKey: expectedBubbleTarget, sessionStarts: bubbleTimes }, existingConfirmedDecisions: existing.decisions };
}

export function appendApprovedPossibleOverrides(existingOverrides) {
  validateDibaPolicyOverrides(existingOverrides);
  const result = { version: 1, decisions: [...existingOverrides.decisions, ...APPROVED_POSSIBLE_LINKS] };
  validateDibaPolicyOverrides(result); return result;
}

export function summarizeReviewedPossiblePolicy({ policy, identityIndex }) {
  const approvedKeys = approvedPossibleSourceKeys(); const mappings = policy.mutationPlan.phases.finalSourceMappings;
  const newMappings = mappings.filter(({ source }) => approvedKeys.has(identityKey(source)));
  const unexpectedMappings = mappings.filter(({ source }) => !approvedKeys.has(identityKey(source)));
  if (newMappings.length !== 23) throw new Error(`E2 expects 23 new reviewed POSSIBLE mappings; found ${newMappings.length}.`);
  if (unexpectedMappings.length) throw new Error(`E2 dry-run proposes ${unexpectedMappings.length} mapping(s) outside the 23 approved POSSIBLE sources.`);
  for (const mapping of newMappings) if (!approvedKeys.has(identityKey(mapping.source)) || mapping.fieldPlan.title !== 'KEEP_EXISTING' || mapping.fieldPlan['commerce/affiliate'] !== 'NEVER_FROM_DIBA') throw new Error(`E2 mapping field ownership or source scope is invalid for ${identityKey(mapping.source)}.`);
  const possible = policy.crossSource.possible; const unresolved = possible.filter(({ activationBlocker }) => activationBlocker);
  if (possible.length !== 22 || possible.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length !== 22 || unresolved.length) throw new Error(`E2 POSSIBLE review completeness failed: total=${possible.length}, reviewed=${possible.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length}, unresolved=${unresolved.length}.`);
  const byComponent = possible.map((item) => ({ componentId: item.component.componentId, sourceKeys: componentSources(item).map(identityKey), target: item.review.target?.identity || null, mappingCount: newMappings.filter(({ source }) => componentSources(item).some((value) => identityKey(value) === identityKey(source))).length }));
  const bubble = byComponent.find(({ sourceKeys }) => sourceKeys.some((key) => key.endsWith(':escenari112430068591411746191364560')));
  if (!bubble || bubble.sourceKeys.length !== 2 || bubble.mappingCount !== 2 || !bubble.target || identityKey(bubble.target) !== 'gencat-agenda:2026071400044@f3789cc34f003307') throw new Error('E2 BubbleBike is not component-complete with two mappings to the approved common target.');
  if (byComponent.some(({ sourceKeys, mappingCount }) => sourceKeys.length !== mappingCount)) throw new Error('E2 would partially resolve a POSSIBLE component.');
  const origins = new Set(newMappings.map(({ diagnostic }) => diagnostic.currentSourcePlanId)); const predictedOrphans = policy.mutationPlan.phases.recomputeOrphans.originalAffectedDibaStagingPlans;
  const everyOrphanDibaOnly = predictedOrphans.every(({ diagnostic }) => (identityIndex.byPlan.get(diagnostic.originalDibaStagingPlanId) || []).every(isDiba));
  return {
    reviewedPossibleComponents: possible.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length, reviewedPossibleSourceMappings: newMappings.length, newMappings, unexpectedMappings,
    componentMappings: byComponent, distinctOriginDibaPlans: origins.size, expectedFutureOrphans: predictedOrphans, everyExpectedOrphanIsDibaStaging: everyOrphanDibaOnly,
    bubbleBike: bubble, remaining: { confirmed: policy.crossSource.confirmed.filter(({ activationBlocker }) => activationBlocker).length, possible: unresolved.length, sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length, sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length },
    geography: { total: policy.geography.length, byResolutionType: countBy(policy.geography, ({ resolutionType }) => resolutionType), plannedMutations: policy.mutationPlan.phases.explicitGeography.length }, publicActivationReady: policy.activation.publicActivationReady,
  };
}
