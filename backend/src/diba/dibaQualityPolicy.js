export const SAME_FEED_DECISIONS = Object.freeze({
  SAFE_CONSOLIDATE: 'SAFE_CONSOLIDATE', KEEP_SEPARATE_SESSION: 'KEEP_SEPARATE_SESSION',
  KEEP_SEPARATE_DATE: 'KEEP_SEPARATE_DATE', NEEDS_HUMAN_REVIEW: 'NEEDS_HUMAN_REVIEW', DEFER: 'DEFER',
});
export const CROSS_SOURCE_DECISIONS = Object.freeze({
  AUTO_LINK_TO_EXISTING_PUBLIC_PLAN: 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN', POSSIBLE_DUPLICATE_HUMAN_REVIEW: 'POSSIBLE_DUPLICATE_HUMAN_REVIEW',
  KEEP_SEPARATE: 'KEEP_SEPARATE', DEFER: 'DEFER', IGNORE_FOR_CURRENT_VISIBILITY_ONLY: 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY',
});

function allEqual(values) { return values.length > 0 && values.every((value) => value === values[0]); }
function eventSpecificDibaUrl(value) {
  try { const url = new URL(value); return /diba\.cat$/i.test(url.hostname) && /fitxa/i.test(url.pathname) && Boolean(url.searchParams.get('id') || url.searchParams.get('acte_id')); } catch { return false; }
}
function scheduleFields(record) { return record.session?.fields || {}; }
// A duration describes length, not a session.  Consolidation needs an actual
// persisted schedule/time signal, so a duration-only payload deliberately
// remains reviewable rather than becoming evidence of a duplicate.
function actualScheduleSignal(record) {
  const fields = scheduleFields(record);
  return ['observacionsHorari', 'scheduleText', 'hora', 'time', 'horari']
    .map((key) => String(fields[key] ?? '').trim())
    .find(Boolean) || null;
}
function scheduleIdentity(record) { return JSON.stringify(scheduleFields(record)); }
function scheduleConflict(records) {
  const times = records.map(({ session }) => session?.fields?.observacionsHorari || null);
  const durations = records.map(({ session }) => session?.fields?.durada || null);
  return !allEqual(times) || !allEqual(durations) || !allEqual(records.map(scheduleIdentity));
}

export function evaluateSameFeedComponent(cluster) {
  const records = cluster.records || []; const edges = cluster.evidence || [];
  const result = { clusterId: cluster.clusterId, sourceKey: cluster.sourceKey, decision: SAME_FEED_DECISIONS.NEEDS_HUMAN_REVIEW, reasons: [], publicSessionDistinguishable: 'unknown', activationDisposition: null };
  if (!records.length || !allEqual(records.map(({ sourceKey = cluster.sourceKey }) => sourceKey))) return { ...result, reasons: ['records are not all from one DIBA source'] };
  if (!allEqual(records.map(({ normalizedTitle }) => normalizedTitle)) || !allEqual(records.map(({ municipality }) => municipality))) return { ...result, reasons: ['title or municipality differs'] };
  if (!allEqual(records.map(({ startDate, endDate }) => `${startDate}:${endDate}`))) return { ...result, decision: SAME_FEED_DECISIONS.KEEP_SEPARATE_DATE, reasons: ['date interval differs'] };
  if (!cluster.topology?.isClique) return { ...result, reasons: ['component is not a clique'] };
  if (!records.every(actualScheduleSignal)) return { ...result, reasons: ['actual raw schedule/time evidence is missing or incomplete; duration alone is insufficient'] };
  if (scheduleConflict(records)) return { ...result, decision: SAME_FEED_DECISIONS.KEEP_SEPARATE_SESSION, reasons: ['session time or duration conflicts'], publicSessionDistinguishable: false, activationDisposition: SAME_FEED_DECISIONS.DEFER };
  const urls = records.map(({ matcherSourceUrl }) => matcherSourceUrl || null);
  if (!allEqual(urls) || !eventSpecificDibaUrl(urls[0])) return { ...result, reasons: ['effective DIBA URL is absent, differs, or is not event-specific'] };
  if (!allEqual(records.map(({ venue }) => venue || null))) return { ...result, reasons: ['venue differs'] };
  if (!edges.length || !edges.every(({ addressMatch, coordinatesNear }) => addressMatch || coordinatesNear)) return { ...result, reasons: ['location corroboration is insufficient'] };
  return { ...result, decision: SAME_FEED_DECISIONS.SAFE_CONSOLIDATE, reasons: ['identical DIBA event-specific URL, interval, venue, schedule and location corroboration'], publicSessionDistinguishable: true };
}

function strongCrossEvidence(finding) {
  const evidence = finding.evidence || {};
  return evidence.titleExact && evidence.municipalityMatch && evidence.intervalRelation === 'identical'
    && ((evidence.venueMatch && evidence.coordinatesNear) || (evidence.urlMatch && eventSpecificDibaUrl(evidence.matcherIncomingSourceUrl)));
}

export function evaluateCrossSourceComponent(component, findings, sameFeedDecisions) {
  const componentFindings = findings.filter(({ dibaPlanId, candidatePublicPlanId }) => component.dibaPlanIds.includes(dibaPlanId) && component.candidatePlanIds.includes(candidatePublicPlanId));
  const active = componentFindings.every(({ candidateVisibility }) => candidateVisibility?.state === 'ENABLED_SOURCE_CURRENTLY_ACTIVE');
  const base = { componentId: component.componentId, dibaPlanIds: component.dibaPlanIds, candidatePlanIds: component.candidatePlanIds, decision: CROSS_SOURCE_DECISIONS.POSSIBLE_DUPLICATE_HUMAN_REVIEW, reasons: [], activePublicationConflict: active, findings: componentFindings };
  if (!active) return { ...base, decision: CROSS_SOURCE_DECISIONS.IGNORE_FOR_CURRENT_VISIBILITY_ONLY, reasons: ['candidate enabled provenance is not currently active'] };
  if (component.candidatePlanIds.length !== 1) return { ...base, reasons: ['one DIBA concept has multiple public candidates'] };
  const allStrong = componentFindings.length > 0 && componentFindings.every(strongCrossEvidence);
  if (!allStrong) return { ...base, reasons: ['cross-source evidence is not venue+coordinates or equivalent event-specific identity'] };
  if (component.dibaPlanIds.length === 1) return { ...base, decision: CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN, reasons: ['1:1 component with strong independent evidence'] };
  const reducible = [...sameFeedDecisions.values()].some(({ decision, planIds }) => decision === SAME_FEED_DECISIONS.SAFE_CONSOLIDATE && component.dibaPlanIds.every((id) => planIds.includes(id)));
  return reducible ? { ...base, decision: CROSS_SOURCE_DECISIONS.AUTO_LINK_TO_EXISTING_PUBLIC_PLAN, reasons: ['N:1 component reduces to one safe same-feed DIBA concept'] }
    : { ...base, reasons: ['many-to-one component is not fully reducible by safe same-feed consolidation'] };
}

export function publicFieldPlan() {
  const keep = ['title', 'description', 'start_date', 'end_date', 'venue', 'address', 'coordinates', 'url'];
  const geography = ['municipality', 'comarca', 'province', 'locality'];
  const never = ['categories', 'image', 'status', 'ranking/featured', 'commerce/affiliate'];
  return Object.fromEntries([
    ...keep.map((field) => [field, 'KEEP_EXISTING']),
    ...geography.map((field) => [field, 'ONLY_EXPLICIT_GEOGRAPHY_OPERATION']),
    ...never.map((field) => [field, 'NEVER_FROM_DIBA']),
  ]);
}

export function stableAnchor(records) {
  return [...records].sort((left, right) => `${left.sourceKey}:${left.sourceRecordId}`.localeCompare(`${right.sourceKey}:${right.sourceRecordId}`))[0] || null;
}
