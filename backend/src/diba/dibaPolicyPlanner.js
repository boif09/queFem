import { identityKey, validateDibaPolicyOverrides } from './dibaPolicyOverrides.js';
import { resolveDibaMunicipalityPolicy } from './dibaMunicipalityAliases.js';
import { CROSS_SOURCE_DECISIONS, evaluateCrossSourceComponent, evaluateSameFeedComponent, publicFieldPlan, SAME_FEED_DECISIONS, stableAnchor } from './dibaQualityPolicy.js';

function identity(sourceKey, sourceRecordId) { return { sourceKey, sourceRecordId: String(sourceRecordId) }; }
function countBy(items, keyOf) { const result = {}; for (const item of items) { const key = keyOf(item); result[key] = (result[key] || 0) + 1; } return result; }
function isDiba(entry) { return String(entry.sourceKey).startsWith('diba-'); }

export function loadPolicyIdentityIndex(db) {
  const rows = db.prepare(`SELECT s.key AS sourceKey, ps.source_record_id AS sourceRecordId, ps.plan_id AS planId, s.enabled
    FROM plan_sources ps JOIN sources s ON s.id=ps.source_id ORDER BY s.key, ps.source_record_id, ps.id`).all();
  const byIdentity = new Map(); const byPlan = new Map();
  for (const row of rows) {
    const entry = { ...row, sourceRecordId: String(row.sourceRecordId), identity: identity(row.sourceKey, row.sourceRecordId) };
    const key = identityKey(entry.identity); const identities = byIdentity.get(key) || []; identities.push(entry); byIdentity.set(key, identities);
    const planEntries = byPlan.get(row.planId) || []; planEntries.push(entry); byPlan.set(row.planId, planEntries);
  }
  return { byIdentity, byPlan };
}
function resolveExactly(index, value, label) {
  const entries = index.byIdentity.get(identityKey(value)) || [];
  if (entries.length !== 1) throw new Error(`${label} identity ${identityKey(value)} must resolve exactly once; found ${entries.length}.`);
  return entries[0];
}
function resolveKeyExactly(index, key, label) {
  const entries = index.byIdentity.get(key) || [];
  if (entries.length !== 1) throw new Error(`${label} identity ${key} must resolve exactly once; found ${entries.length}.`);
  return entries[0];
}
function publicTargetForPlan(index, planId) {
  const candidates = (index.byPlan.get(planId) || []).filter((entry) => entry.enabled === 1 && !isDiba(entry))
    .sort((left, right) => identityKey(left.identity).localeCompare(identityKey(right.identity)));
  if (candidates.length !== 1) throw new Error(`Public target plan ${planId} must have exactly one enabled non-DIBA stable source identity; found ${candidates.length}.`);
  return candidates[0];
}
function overridesBySource(overrides, index) {
  const map = new Map();
  for (const decision of overrides.decisions) {
    const source = resolveExactly(index, decision.source, 'Override source');
    const target = decision.target ? resolveExactly(index, decision.target, 'Override target') : null;
    map.set(identityKey(source.identity), { ...decision, sourceEntry: source, targetEntry: target });
  }
  return map;
}
function componentDibaSources(component, findings) {
  const seen = new Map();
  for (const finding of findings) if (component.dibaPlanIds.includes(finding.dibaPlanId) && component.candidatePlanIds.includes(finding.candidatePublicPlanId)) {
    const source = identity(finding.sourceKey, finding.sourceRecordId); seen.set(identityKey(source), source);
  }
  return [...seen.values()].sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
}
// Human decisions are deliberately component-complete. A partial review cannot
// authorize moving its unreviewed neighbours.
function reviewedComponentDisposition(component, findings, overrides) {
  const sources = componentDibaSources(component, findings);
  const reviewed = sources.map((source) => overrides.get(identityKey(source)) || null);
  if (!sources.length) return { complete: false, decision: null, sources, reason: 'component has no DIBA source identities' };
  if (reviewed.some((item) => !item)) return { complete: false, decision: null, sources, reason: 'component review is incomplete' };
  const decisions = new Set(reviewed.map(({ decision }) => decision));
  if (decisions.size !== 1) return { complete: false, decision: null, sources, reason: 'component contains contradictory reviewed dispositions' };
  const decision = reviewed[0].decision;
  if (decision !== 'LINK_TO_EXISTING') return { complete: true, decision, sources, reviewed };
  const targets = reviewed.map(({ targetEntry }) => targetEntry);
  if (targets.some((target) => !target || target.enabled !== 1 || isDiba(target))) return { complete: false, decision: null, sources, reason: 'reviewed link target is not an enabled non-DIBA public source' };
  const planIds = new Set(targets.map(({ planId }) => planId));
  if (planIds.size !== 1) return { complete: false, decision: null, sources, reason: 'reviewed links do not share one approved public canonical target' };
  const target = targets[0];
  if (!component.candidatePlanIds.includes(target.planId)) return { complete: false, decision: null, sources, reason: 'reviewed link target is outside this conflict component' };
  return { complete: true, decision, sources, reviewed, target };
}
function addFinalMapping(mappings, sourceEntry, targetEntry, policy) {
  const key = identityKey(sourceEntry.identity); const existing = mappings.get(key);
  if (existing && identityKey(existing.finalTargetAnchor) !== identityKey(targetEntry.identity)) throw new Error(`Source ${key} has contradictory final destinations.`);
  mappings.set(key, { source: sourceEntry.identity, finalTargetAnchor: targetEntry.identity, diagnostic: { currentSourcePlanId: sourceEntry.planId, expectedCurrentTargetPlanId: targetEntry.planId, policy }, fieldPlan: publicFieldPlan() });
}
function policyEdge(source, target, policy) { return { source, target, policy }; }

export function planDibaPolicy({ auditReport, overrides: rawOverrides, identityIndex }) {
  const overrides = validateDibaPolicyOverrides(rawOverrides); const reviewed = overridesBySource(overrides, identityIndex);
  const sameFeed = auditReport.sameFeed.clusters.filter(({ distinctPlanCount }) => distinctPlanCount > 1)
    .map((cluster) => ({ ...evaluateSameFeedComponent(cluster), cluster, planIds: cluster.planIds }));
  const sameFeedDecisions = new Map(sameFeed.map((item) => [item.clusterId, item]));
  const confirmedFindings = auditReport.currentPublicCandidates.confirmed;
  const crossConfirmed = auditReport.currentPublicCandidates.confirmedSummary.conflictComponents.map((component) => {
    const automatic = evaluateCrossSourceComponent(component, confirmedFindings, sameFeedDecisions);
    if (automatic.decision === CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN || automatic.decision === CROSS_SOURCE_DECISIONS.IGNORE_FOR_CURRENT_VISIBILITY_ONLY) return automatic;
    const disposition = reviewedComponentDisposition(component, confirmedFindings, reviewed);
    return { ...automatic, reviewedDecision: disposition.complete ? disposition.decision : null, review: disposition, activationBlocker: automatic.activePublicationConflict && !disposition.complete, decision: disposition.complete ? disposition.decision : automatic.decision };
  });
  const possibleFindings = auditReport.currentPublicCandidates.possible;
  const possibleComponents = auditReport.currentPublicCandidates.possibleSummary.conflictComponents.map((component) => {
    const findings = possibleFindings.filter(({ dibaPlanId, candidatePublicPlanId }) => component.dibaPlanIds.includes(dibaPlanId) && component.candidatePlanIds.includes(candidatePublicPlanId));
    const disposition = reviewedComponentDisposition(component, possibleFindings, reviewed);
    const active = findings.every(({ candidateVisibility }) => candidateVisibility?.state === 'ENABLED_SOURCE_CURRENTLY_ACTIVE');
    return { component, findings, activePublicationConflict: active, reviewedDecision: disposition.complete ? disposition.decision : null, review: disposition, activationBlocker: active && !disposition.complete, decision: disposition.complete ? disposition.decision : CROSS_SOURCE_DECISIONS.POSSIBLE_DUPLICATE_HUMAN_REVIEW };
  });

  const policyConsolidationEdges = []; const policyPublicLinkEdges = []; const directPublicTargets = new Map();
  for (const decision of crossConfirmed.filter(({ decision }) => decision === CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN || decision === 'LINK_TO_EXISTING')) {
    const target = decision.decision === 'LINK_TO_EXISTING' ? decision.review.target : publicTargetForPlan(identityIndex, decision.candidatePlanIds[0]);
    for (const finding of decision.findings) {
      const source = resolveExactly(identityIndex, identity(finding.sourceKey, finding.sourceRecordId), 'Confirmed DIBA source');
      directPublicTargets.set(identityKey(source.identity), target); policyPublicLinkEdges.push(policyEdge(source.identity, target.identity, decision.decision === 'LINK_TO_EXISTING' ? 'REVIEWED_LINK_TO_EXISTING' : 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN'));
    }
  }
  for (const item of possibleComponents.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING')) for (const source of item.review.sources) {
    const sourceEntry = resolveExactly(identityIndex, source, 'Reviewed DIBA source'); directPublicTargets.set(identityKey(sourceEntry.identity), item.review.target);
    policyPublicLinkEdges.push(policyEdge(sourceEntry.identity, item.review.target.identity, 'REVIEWED_LINK_TO_EXISTING'));
  }

  // Compose the final target before C2.  If the safe anchor links publicly,
  // every member has that public target directly, independent of array order.
  const composedTargets = new Map(directPublicTargets);
  for (const decision of sameFeed.filter(({ decision: value }) => value === SAME_FEED_DECISIONS.SAFE_CONSOLIDATE)) {
    const records = decision.cluster.records.map((record) => ({ ...record, sourceKey: decision.sourceKey }));
    const anchor = stableAnchor(records); const anchorEntry = resolveExactly(identityIndex, identity(anchor.sourceKey, anchor.sourceRecordId), 'Same-feed anchor');
    for (const record of records) if (record.sourceRecordId !== anchor.sourceRecordId) {
      const sourceEntry = resolveExactly(identityIndex, identity(record.sourceKey, record.sourceRecordId), 'Same-feed source');
      if (sourceEntry.planId !== anchorEntry.planId) policyConsolidationEdges.push(policyEdge(sourceEntry.identity, anchorEntry.identity, 'SAFE_CONSOLIDATE'));
    }
    const targets = records.map((record) => directPublicTargets.get(identityKey(identity(record.sourceKey, record.sourceRecordId)))).filter(Boolean);
    if (new Set(targets.map(({ planId }) => planId)).size === 1) for (const record of records) composedTargets.set(identityKey(identity(record.sourceKey, record.sourceRecordId)), targets[0]);
  }
  const finalMappings = new Map();
  for (const decision of sameFeed.filter(({ decision: value }) => value === SAME_FEED_DECISIONS.SAFE_CONSOLIDATE)) {
    const records = decision.cluster.records.map((record) => ({ ...record, sourceKey: decision.sourceKey }));
    const anchor = stableAnchor(records); const anchorEntry = resolveExactly(identityIndex, identity(anchor.sourceKey, anchor.sourceRecordId), 'Same-feed anchor');
    for (const record of records) {
      const sourceEntry = resolveExactly(identityIndex, identity(record.sourceKey, record.sourceRecordId), 'Same-feed source'); const target = composedTargets.get(identityKey(sourceEntry.identity));
      if (target) addFinalMapping(finalMappings, sourceEntry, target, 'COMPOSED_SAFE_CONSOLIDATION_TO_PUBLIC_LINK');
      else if (identityKey(sourceEntry.identity) !== identityKey(anchorEntry.identity)) addFinalMapping(finalMappings, sourceEntry, anchorEntry, 'SAFE_CONSOLIDATE');
    }
  }
  for (const [key, target] of composedTargets) addFinalMapping(finalMappings, resolveKeyExactly(identityIndex, key, 'Public-link source'), target, 'DIRECT_OR_COMPOSED_PUBLIC_LINK');
  const finalSourceMappings = [...finalMappings.values()].filter(({ diagnostic }) => diagnostic.currentSourcePlanId !== diagnostic.expectedCurrentTargetPlanId).sort((a, b) => identityKey(a.source).localeCompare(identityKey(b.source)));

  const geography = auditReport.unresolvedMunicipalities.records.map((record) => {
    const source = identity('diba-tourisme', record.sourceRecordId); const sourceEntry = resolveExactly(identityIndex, source, 'Geography DIBA source');
    const mapped = finalMappings.get(identityKey(sourceEntry.identity)); const finalTargetAnchor = mapped?.finalTargetAnchor || sourceEntry.identity;
    const finalTarget = resolveExactly(identityIndex, finalTargetAnchor, 'Geography final target');
    return { source, finalTargetAnchor, planId: sourceEntry.planId, targetPlanId: finalTarget.planId, ...resolveDibaMunicipalityPolicy(record) };
  });
  const explicitGeography = geography.filter(({ deterministic }) => deterministic).map((result) => ({ type: result.resolutionType === 'COMARCA_ONLY' ? 'RESOLVE_COMARCA' : 'RESOLVE_MUNICIPALITY', source: result.source, finalTargetAnchor: result.finalTargetAnchor, geography: result, rule: 'FILL_MISSING_COMPATIBLE_ONLY_OR_NOOP_IF_VALID_GEOGRAPHY_EXISTS', diagnostic: { currentSourcePlanId: result.planId, expectedCurrentTargetPlanId: result.targetPlanId } }));

  const movedKeys = new Set(finalSourceMappings.map(({ source }) => identityKey(source))); const estimatedOrphans = [];
  for (const [planId, entries] of identityIndex.byPlan) {
    const dibaEntries = entries.filter(isDiba);
    if (dibaEntries.length && entries.every(isDiba) && dibaEntries.every((entry) => movedKeys.has(identityKey(entry.identity)))) estimatedOrphans.push({ originalAffectedDibaSources: dibaEntries.map(({ identity: value }) => value), diagnostic: { originalDibaStagingPlanId: planId } });
  }
  const mutationPlan = { schemaVersion: 2, phases: {
    resolveAndValidate: finalSourceMappings.map(({ source, finalTargetAnchor, diagnostic }) => ({ source, finalTargetAnchor, diagnostic, checks: ['source resolves exactly once', 'target resolves exactly once', 'current source-to-plan association matches diagnostic', 'target source enabled/disabled context remains valid'] })),
    finalSourceMappings,
    relinkProvenance: finalSourceMappings.map(({ source, finalTargetAnchor, diagnostic }) => ({ source, finalTargetAnchor, diagnostic, contract: 'FUTURE_C2_ONLY: relink this stable provenance row directly to final target plan' })),
    explicitGeography,
    recomputeOrphans: { contract: 'FUTURE_C2_ONLY: after final provenance relinks, count plan_sources inside the transaction; only original affected DIBA staging plans with zero rows are eligible.', originalAffectedDibaStagingPlans: estimatedOrphans },
    inactivateOrphans: estimatedOrphans.map((item) => ({ ...item, contract: 'FUTURE_C2_ONLY: inactivate only after transaction-local zero-provenance check; never hard delete.' })),
    finalInvariants: ['every planned DIBA source identity exists exactly once', 'every planned source points to its expected final plan', 'no source identity disappeared or was duplicated', 'all inactivated plans have zero plan_sources', 'no public or shared plan was inactivated', 'no non-approved canonical fields changed', 'geography only fills compatible missing values and otherwise is NOOP', 'source enabled and image state remain unchanged', 'unresolved activation blockers remain blockers'],
    commit: { contract: 'FUTURE_C2_ONLY: commit only after final invariants pass.' },
  } };
  const operations = [...finalSourceMappings.map((mapping) => ({ type: 'RELINK_DIBA_SOURCE_TO_FINAL_TARGET', ...mapping })), ...explicitGeography, ...estimatedOrphans.map((item) => ({ type: 'MARK_ORPHAN_DIBA_PLAN_INACTIVE', ...item }))];
  const blockers = [
    ...possibleComponents.filter(({ activationBlocker }) => activationBlocker).map(({ review }) => ({ reason: 'ACTIVE_POSSIBLE_COMPONENT_WITHOUT_COMPLETE_REVIEWED_DISPOSITION', detail: review.reason })),
    ...sameFeed.filter(({ decision, activationDisposition }) => decision === SAME_FEED_DECISIONS.KEEP_SEPARATE_SESSION && activationDisposition === SAME_FEED_DECISIONS.DEFER).map(() => ({ reason: 'DISTINCT_SESSION_NOT_PUBLICLY_DISTINGUISHABLE' })),
    ...sameFeed.filter(({ decision }) => decision === SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW).map(() => ({ reason: 'SAME_FEED_COMPONENT_NEEDS_HUMAN_REVIEW' })),
    ...crossConfirmed.filter(({ decision, review }) => decision !== CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN && decision !== CROSS_SOURCE_DECISIONS.IGNORE_FOR_CURRENT_VISIBILITY_ONLY && !review?.complete).map(() => ({ reason: 'CONFIRMED_CROSS_SOURCE_COMPONENT_NEEDS_HUMAN_REVIEW' })),
  ];
  return { readOnly: true, sameFeed, crossSource: { confirmed: crossConfirmed, possible: possibleComponents }, geography, mutationPlan, operations, activation: { publicActivationReady: false, blockers, blockerCounts: countBy(blockers, ({ reason }) => reason) }, summary: {
    sameFeed: countBy(sameFeed, ({ decision }) => decision), crossConfirmed: countBy(crossConfirmed, ({ decision }) => decision), reviewedConfirmedLink: crossConfirmed.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length,
    possible: { totalComponents: possibleComponents.length, reviewedLink: possibleComponents.filter(({ reviewedDecision }) => reviewedDecision === 'LINK_TO_EXISTING').length, reviewedKeepSeparate: possibleComponents.filter(({ reviewedDecision }) => reviewedDecision === 'KEEP_SEPARATE').length, reviewedDefer: possibleComponents.filter(({ reviewedDecision }) => reviewedDecision === 'DEFER').length, unresolved: possibleComponents.filter(({ activationBlocker }) => activationBlocker).length },
    policyLevelConsolidationEdges: policyConsolidationEdges.length, policyLevelPublicLinkEdges: policyPublicLinkEdges.length, finalUniqueSourceRelinks: finalSourceMappings.length, geography: countBy(geography, ({ resolutionType }) => resolutionType), plannedOperations: countBy(operations, ({ type }) => type),
  } };
}
