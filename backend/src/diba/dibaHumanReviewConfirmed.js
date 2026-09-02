import { identityKey } from './dibaPolicyOverrides.js';

function text(value) { const result = String(value ?? '').trim(); return result || null; }
function parsePayload(value) { try { return JSON.parse(value); } catch { return {}; } }
function dateOnly(value) { return String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null; }
function isDiba(source) { return String(source.key || source.sourceKey || '').startsWith('diba-'); }
function escapeMarkdown(value) { return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function formatIdentity(identity) { return identity ? `${identity.sourceKey}:${identity.sourceRecordId}` : '—'; }
function equalNormalized(left, right) { return Boolean(left && right && left === right); }
function haversineKilometres(left, right) {
  if (![left?.latitude, left?.longitude, right?.latitude, right?.longitude].every(Number.isFinite)) return null;
  const radians = (value) => value * Math.PI / 180; const earth = 6371;
  const dLat = radians(right.latitude - left.latitude); const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return Number((earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(4));
}
function sourceIdentity(source) { return { sourceKey: source.key, sourceRecordId: String(source.source_record_id) }; }
function sourcesFor(planId, state) { return state.sourcesByPlan.get(planId) || []; }
function occurrenceFor(planId, state) { return state.occurrencesByPlan.get(planId) || []; }
function componentFindings(component, confirmed) {
  return confirmed.filter(({ dibaPlanId, candidatePublicPlanId }) => component.dibaPlanIds.includes(dibaPlanId) && component.candidatePlanIds.includes(candidatePublicPlanId));
}
function topology(component) {
  const diba = component.dibaPlanIds.length; const publicPlans = component.candidatePlanIds.length;
  if (diba === 1 && publicPlans === 1) return '1 DIBA -> 1 public';
  if (diba > 1 && publicPlans === 1) return 'N DIBA -> 1 public';
  if (diba === 1 && publicPlans > 1) return '1 DIBA -> N public';
  return 'complex';
}
function currentProvenanceState(plan, sources) {
  if (!sources.length) return 'NO_PROVENANCE';
  if (sources.every(isDiba)) return 'DIBA_ONLY';
  if (plan.status !== 'active') return 'SHARED_OR_PUBLIC_INACTIVE';
  if (sources.some((source) => !isDiba(source) && Number(source.enabled) === 1)) return 'SHARED_WITH_ENABLED_PUBLIC_SOURCE';
  return 'SHARED_NO_ENABLED_PUBLIC_SOURCE';
}
function dibaRecord(finding, state) {
  const record = finding.diba; const sourceKey = finding.sourceKey; const sourceRecordId = String(finding.sourceRecordId); const planId = finding.dibaPlanId;
  const plan = state.plansById.get(planId); const source = sourcesFor(planId, state).find((item) => item.key === sourceKey && String(item.source_record_id) === sourceRecordId);
  const payload = parsePayload(source?.source_payload_json); const address = payload.grup_adreca || {}; const relation = payload.rel_municipis || {};
  const effectiveUrl = source?.source_url || record.sourceUrl || null;
  return {
    stableIdentity: { sourceKey, sourceRecordId },
    diagnostic: { currentPlanId: planId },
    dataset: source?.dataset_id || record.dataset || null,
    content: {
      title: record.title, normalizedTitle: record.normalizedTitle, startDate: record.startDate, endDate: record.endDate,
      municipalityLiteral: record.rawMunicipalityName || relation.municipi_nom || address.municipi_nom || null,
      resolvedMunicipality: plan?.municipality || record.municipality || null, ine: record.rawIne || relation.ine || null,
      comarca: plan?.comarca || null, locality: plan?.locality || null, venue: record.venue, address: record.address,
      coordinates: record.coordinates, scheduleText: plan?.schedule_text || null, session: record.session || null,
      duration: text(payload.durada), sourceUrl: source?.source_url || null, effectiveUrl,
      secondaryPayloadUrls: record.secondaryPayloadUrls || [],
    },
    state: { active: plan?.status === 'active', status: plan?.status || null, inactiveAt: plan?.inactive_at || null, provenance: currentProvenanceState(plan || {}, sourcesFor(planId, state)) },
  };
}
function publicRecord(planId, state) {
  const plan = state.plansById.get(planId); const sources = sourcesFor(planId, state); const publicSources = sources.filter((source) => !isDiba(source) && Number(source.enabled) === 1)
    .sort((left, right) => `${left.key}:${left.source_record_id}`.localeCompare(`${right.key}:${right.source_record_id}`));
  const preferred = publicSources.find(({ key }) => key === 'gencat-agenda') || publicSources[0] || null;
  const provenance = sources.map((source) => ({
    ...sourceIdentity(source), enabled: Number(source.enabled) === 1, sourceUrl: source.source_url || null,
    dataset: source.dataset_id || null, makesPlanPublic: !isDiba(source) && Number(source.enabled) === 1,
  }));
  return {
    diagnostic: { planId },
    canonical: {
      title: plan?.original_title || null, normalizedTitle: plan?.original_title_normalized || null, startDate: plan?.start_date || null, endDate: plan?.end_date || null,
      municipality: plan?.municipality || null, comarca: plan?.comarca || null, locality: plan?.locality || null,
      venue: plan?.venue_name || null, address: plan?.address || null,
      coordinates: Number.isFinite(plan?.latitude) && Number.isFinite(plan?.longitude) ? { latitude: plan.latitude, longitude: plan.longitude } : null,
      informationalUrl: plan?.website_url || null, active: plan?.status === 'active', status: plan?.status || null, inactiveAt: plan?.inactive_at || null,
    },
    provenance,
    enabledPublicAnchor: preferred ? sourceIdentity(preferred) : null,
    enabledPublicAnchorReason: preferred ? (publicSources.length === 1 ? 'sole enabled non-DIBA provenance on this public plan' : `selected deterministic enabled public provenance from ${publicSources.length} candidates`) : 'no enabled non-DIBA provenance is available',
    occurrenceEvidence: occurrenceFor(planId, state),
    commerceRelevantProvenance: provenance.filter(({ sourceKey }) => sourceKey === 'fever' || sourceKey === 'ticketmaster'),
  };
}
function evidenceMatrix(finding, diba, publicCandidate) {
  const evidence = finding.evidence; const publicContent = publicCandidate.canonical;
  const distanceKilometres = haversineKilometres(diba.content.coordinates, publicContent.coordinates);
  const dibaSchedule = diba.content.session?.fields || null; const publicSessions = publicCandidate.occurrenceEvidence;
  const session = !dibaSchedule && !publicSessions.length ? 'absent' : (!dibaSchedule || !publicSessions.length ? 'absent on one side' : 'requires human comparison');
  const publicUrls = publicCandidate.provenance.map(({ sourceUrl }) => sourceUrl).filter(Boolean);
  return {
    title: { exactNormalized: evidence.titleExact, diba: diba.content.title, public: publicContent.title, difference: evidence.titleExact ? null : 'normalized titles differ' },
    dateInterval: { exact: evidence.intervalRelation === 'identical', relation: evidence.intervalRelation, diba: { startDate: diba.content.startDate, endDate: diba.content.endDate }, public: { startDate: publicContent.startDate, endDate: publicContent.endDate } },
    municipality: { exactCanonicalMunicipality: evidence.municipalityMatch, diba: diba.content.resolvedMunicipality, public: publicContent.municipality },
    venue: { comparison: evidence.venueMatch ? 'exact/normalized match' : (!diba.content.venue || !publicContent.venue ? 'absent' : 'conflict'), diba: diba.content.venue, public: publicContent.venue },
    address: { comparison: evidence.addressMatch ? 'exact/normalized match' : (!diba.content.address || !publicContent.address ? 'absent' : 'conflict'), diba: diba.content.address, public: publicContent.address },
    coordinates: { diba: diba.content.coordinates, public: publicContent.coordinates, distanceKilometres, nearbyByApprovedMatcher: evidence.coordinatesNear },
    urls: {
      dibaEffectiveUrl: diba.content.effectiveUrl, publicSourceUrls: publicUrls, sameEventSpecificIdentity: evidence.urlMatch ? 'yes' : 'unknown',
      programmeOrGeneralUrl: diba.content.secondaryPayloadUrls.length ? 'yes' : 'no', secondaryDibaUrls: diba.content.secondaryPayloadUrls,
    },
    session: { diba: { scheduleText: diba.content.scheduleText, fields: dibaSchedule }, publicStructuredOccurrences: publicSessions, comparison: session },
  };
}
function recommendation(finding, matrix, publicCandidate) {
  const target = publicCandidate.enabledPublicAnchor;
  if (!target) return { recommendedDisposition: 'UNCERTAIN', confidence: 'LOW', target: null, requiresExternalUrlInspection: true, rationale: 'No enabled public provenance is available as a stable review target.' };
  if (!matrix.dateInterval.exact) return { recommendedDisposition: 'DEFER', confidence: 'MEDIUM', target: null, requiresExternalUrlInspection: true, rationale: 'The title, municipality and place evidence is strong, but the published interval differs; verify the event-specific pages before deciding whether this is one exhibition with stale/incomplete dates.' };
  if (finding.evidence.titleExact && finding.evidence.municipalityMatch && finding.evidence.venueMatch && matrix.session.comparison !== 'requires human comparison') {
    return { recommendedDisposition: 'LINK_TO_EXISTING', confidence: 'MEDIUM', target, requiresExternalUrlInspection: true, rationale: 'Exact title, date, municipality and venue strongly suggest one event, but the approved automatic rule lacks a second independent corroboration. Confirm the event-specific pages before recording a human decision.' };
  }
  return { recommendedDisposition: 'UNCERTAIN', confidence: 'LOW', target: null, requiresExternalUrlInspection: true, rationale: 'The approved matcher found a confirmed edge, but the remaining evidence does not safely support a human link recommendation without external inspection.' };
}
function automaticLinkBlocker(finding, diba, publicCandidate, policyReasons) {
  const evidence = finding.evidence; const publicCoordinates = publicCandidate.canonical.coordinates; const dibaCoordinates = diba.content.coordinates;
  if (evidence.intervalRelation !== 'identical') return [`date interval overlaps but is not identical (DIBA ${diba.content.startDate}..${diba.content.endDate}; public ${publicCandidate.canonical.startDate}..${publicCandidate.canonical.endDate}); the automatic rule requires an identical interval`];
  if (evidence.venueMatch && !evidence.coordinatesNear) {
    if (!dibaCoordinates) return ['venue matches, but DIBA coordinates are unavailable; the automatic rule requires venue match plus nearby coordinates'];
    if (!publicCoordinates) return ['venue matches, but public coordinates are unavailable; the automatic rule requires venue match plus nearby coordinates'];
    return ['venue matches, but the available coordinates are not nearby under the approved matcher threshold'];
  }
  if (evidence.coordinatesNear && !evidence.venueMatch) return ['coordinates are nearby, but venue is absent or does not match after normalization; the automatic rule requires venue match plus nearby coordinates'];
  if (!evidence.urlMatch) return ['no shared event-specific URL identity provides the alternative automatic corroboration'];
  return policyReasons;
}
function componentScore(component) {
  return component.findings.reduce((score, finding) => score + (finding.evidence.intervalRelation === 'identical' ? 4 : 0) + (finding.evidence.venueMatch ? 2 : 0) + (finding.evidence.coordinatesNear ? 1 : 0) + (finding.evidence.urlMatch ? 3 : 0), 0);
}

export function buildConfirmedHumanReviewPack({ auditReport, policy, state }) {
  const policyByComponent = new Map(policy.crossSource.confirmed.map((item) => [item.componentId, item]));
  const candidates = auditReport.currentPublicCandidates.confirmedSummary.conflictComponents.map((component) => {
    const decision = policyByComponent.get(component.componentId); const findings = componentFindings(component, auditReport.currentPublicCandidates.confirmed);
    return { component, decision, findings };
  }).filter(({ decision }) => decision && decision.decision !== 'AUTO_LINK_TO_EXISTING_PUBLIC_PLAN' && decision.decision !== 'IGNORE_FOR_CURRENT_VISIBILITY_ONLY')
    .sort((left, right) => componentScore(right) - componentScore(left) || left.findings[0].diba.title.localeCompare(right.findings[0].diba.title));
  const components = candidates.map(({ component, decision, findings }, index) => {
    const diba = findings.map((finding) => dibaRecord(finding, state)); const publicCandidates = component.candidatePlanIds.map((planId) => publicRecord(planId, state));
    const relationships = findings.map((finding) => {
      const dibaSide = diba.find(({ diagnostic }) => diagnostic.currentPlanId === finding.dibaPlanId);
      const publicSide = publicCandidates.find(({ diagnostic }) => diagnostic.planId === finding.candidatePublicPlanId);
      const matrix = evidenceMatrix(finding, dibaSide, publicSide); const advice = recommendation(finding, matrix, publicSide);
      return { diba: dibaSide.stableIdentity, publicPlanIdDiagnostic: finding.candidatePublicPlanId, publicTarget: publicSide.enabledPublicAnchor, evidence: matrix, recommendation: advice };
    });
    const first = findings[0]; const advice = relationships[0].recommendation;
    const blockers = findings.map((finding) => automaticLinkBlocker(finding, diba.find(({ diagnostic }) => diagnostic.currentPlanId === finding.dibaPlanId), publicCandidates.find(({ diagnostic }) => diagnostic.planId === finding.candidatePublicPlanId), decision.reasons));
    return {
      reviewComponentId: `confirmed-review-${String(index + 1).padStart(3, '0')}`, sourceAuditComponentId: component.componentId,
      topology: topology(component), counts: { dibaRecords: diba.length, dibaCurrentPlans: component.dibaPlanIds.length, publicCandidatePlans: component.candidatePlanIds.length, edges: findings.length },
      confirmedReason: findings.map(({ evidence }) => evidence.reason), automaticLinkBlocker: blockers.flat(), policyDecisionReason: decision.reasons,
      diba, publicCandidates, relationships,
      humanReviewQuestion: 'Do these records describe the same real-world event/performance?',
      dispositions: {
        LINK_TO_EXISTING: advice.target ? `Use stable public target ${formatIdentity(advice.target)}; do not use the numeric plan ID.` : 'Choose one enabled public stable provenance target only after review.',
        KEEP_SEPARATE: `Leave DIBA identities ${diba.map(({ stableIdentity }) => formatIdentity(stableIdentity)).join(', ')} separate from the public candidate plan(s).`,
        DEFER: `Leave DIBA identities ${diba.map(({ stableIdentity }) => formatIdentity(stableIdentity)).join(', ')} unpublished while DIBA remains disabled.`,
      },
      advisoryRecommendation: advice,
      sortEvidence: { title: first.diba.title, date: first.diba.startDate, municipality: first.diba.municipality },
    };
  });
  const recommendationCounts = Object.fromEntries(['LINK_TO_EXISTING', 'KEEP_SEPARATE', 'DEFER', 'UNCERTAIN'].map((key) => [key, components.filter(({ advisoryRecommendation }) => advisoryRecommendation.recommendedDisposition === key).length]));
  return { schemaVersion: 1, readOnly: true, scope: 'unresolved confirmed cross-source components only', summary: { unresolvedConfirmedComponents: components.length, topologyDistribution: Object.fromEntries([...new Set(components.map(({ topology: value }) => value))].map((value) => [value, components.filter(({ topology: item }) => item === value).length])), recommendationCounts, excludedSummary: { possibleComponents: policy.crossSource.possible.length, sameFeedHumanReviewComponents: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length, sameFeedDeferredSessionComponents: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length } }, components };
}

export function loadConfirmedHumanReviewState(db) {
  const plans = db.prepare('SELECT * FROM plans').all();
  const sources = db.prepare(`SELECT ps.id, ps.plan_id, ps.source_record_id, ps.source_url, ps.source_payload_json, s.key, s.enabled, s.dataset_id
    FROM plan_sources ps JOIN sources s ON s.id=ps.source_id ORDER BY ps.plan_id, s.key, ps.source_record_id`).all();
  const occurrences = db.prepare(`SELECT ps.plan_id, s.key AS source_key, ps.source_record_id, o.*
    FROM plan_occurrences o JOIN plan_sources ps ON ps.id=o.plan_source_id JOIN sources s ON s.id=ps.source_id
    WHERE o.status='active' ORDER BY ps.plan_id, s.key, o.local_date, o.local_time`).all();
  const sourcesByPlan = new Map(); for (const source of sources) { const values = sourcesByPlan.get(source.plan_id) || []; values.push(source); sourcesByPlan.set(source.plan_id, values); }
  const occurrencesByPlan = new Map(); for (const occurrence of occurrences) { const values = occurrencesByPlan.get(occurrence.plan_id) || []; values.push(occurrence); occurrencesByPlan.set(occurrence.plan_id, values); }
  return { plansById: new Map(plans.map((plan) => [plan.id, plan])), sourcesByPlan, occurrencesByPlan };
}

export function renderConfirmedHumanReviewMarkdown(pack) {
  const index = pack.components.map((component, index) => {
    const relation = component.relationships[0]; const diba = component.diba[0]; const publicCandidate = component.publicCandidates[0];
    return `| ${index + 1} | ${escapeMarkdown(diba.content.title)} | ${escapeMarkdown(publicCandidate.canonical.title)} | ${escapeMarkdown(diba.content.startDate)} | ${escapeMarkdown(diba.content.resolvedMunicipality)} | ${component.topology} | ${escapeMarkdown(component.automaticLinkBlocker.join('; '))} | ${component.advisoryRecommendation.recommendedDisposition} | ${component.advisoryRecommendation.confidence} |`;
  }).join('\n');
  const details = pack.components.map((component) => {
    const diba = component.diba.map((item) => `- **${formatIdentity(item.stableIdentity)}** (plan diagnostic ${item.diagnostic.currentPlanId})\n  - Title: ${item.content.title}; normalized: ${item.content.normalizedTitle}; dates: ${item.content.startDate} to ${item.content.endDate}; dataset: ${item.dataset || '—'}\n  - Municipality literal: ${item.content.municipalityLiteral || '—'}; resolved / INE: ${item.content.resolvedMunicipality || '—'} / ${item.content.ine || '—'}; comarca/locality: ${item.content.comarca || '—'} / ${item.content.locality || '—'}\n  - Venue/address: ${item.content.venue || '—'} / ${item.content.address || '—'}; coordinates: ${JSON.stringify(item.content.coordinates)}\n  - Schedule/duration: ${item.content.scheduleText || '—'} / ${item.content.duration || '—'}; state: ${item.state.status}/${item.state.provenance}\n  - Effective URL: ${item.content.effectiveUrl || '—'}; secondary/programme URLs: ${item.content.secondaryPayloadUrls.join(', ') || '—'}`).join('\n');
    const publicCandidates = component.publicCandidates.map((item) => `- **plan diagnostic ${item.diagnostic.planId}**\n  - Title: ${item.canonical.title}; dates: ${item.canonical.startDate} to ${item.canonical.endDate}; municipality/comarca/locality: ${item.canonical.municipality || '—'} / ${item.canonical.comarca || '—'} / ${item.canonical.locality || '—'}\n  - Venue/address: ${item.canonical.venue || '—'} / ${item.canonical.address || '—'}; coordinates: ${JSON.stringify(item.canonical.coordinates)}; active: ${item.canonical.active}; informational URL: ${item.canonical.informationalUrl || '—'}\n  - Enabled public anchor: ${formatIdentity(item.enabledPublicAnchor)} (${item.enabledPublicAnchorReason})\n  - Provenance: ${item.provenance.map((source) => `${formatIdentity(source)} [enabled=${source.enabled}; URL=${source.sourceUrl || '—'}]`).join('; ')}\n  - Structured active occurrences: ${JSON.stringify(item.occurrenceEvidence)}; Fever/Ticketmaster provenance: ${item.commerceRelevantProvenance.map((source) => formatIdentity(source)).join(', ') || 'none'}`).join('\n');
    const evidence = component.relationships.map(({ diba: dibaIdentity, publicTarget, evidence: matrix }) => `- **${formatIdentity(dibaIdentity)} -> ${formatIdentity(publicTarget)}**\n  - Title exact normalized: ${matrix.title.exactNormalized}; date exact: ${matrix.dateInterval.exact} (${matrix.dateInterval.diba.startDate}..${matrix.dateInterval.diba.endDate} vs ${matrix.dateInterval.public.startDate}..${matrix.dateInterval.public.endDate}); municipality exact: ${matrix.municipality.exactCanonicalMunicipality}\n  - Venue: ${matrix.venue.comparison} (${matrix.venue.diba || '—'} vs ${matrix.venue.public || '—'}); address: ${matrix.address.comparison}; coordinates: ${JSON.stringify(matrix.coordinates.diba)} vs ${JSON.stringify(matrix.coordinates.public)}; distance km: ${matrix.coordinates.distanceKilometres ?? '—'}\n  - URL identity: ${matrix.urls.sameEventSpecificIdentity}; DIBA effective: ${matrix.urls.dibaEffectiveUrl || '—'}; public source URLs: ${matrix.urls.publicSourceUrls.join(', ') || '—'}\n  - Session: ${matrix.session.comparison}`).join('\n');
    return `## ${component.reviewComponentId} — ${component.sortEvidence.title}\n\n**Topology:** ${component.topology}. DIBA records: ${component.counts.dibaRecords}; current DIBA plans: ${component.counts.dibaCurrentPlans}; public candidates: ${component.counts.publicCandidatePlans}; edges: ${component.counts.edges}.\n\n**CONFIRMED because:** ${component.confirmedReason.join('; ')}\n\n**AUTO-LINK BLOCKED BECAUSE:** ${component.automaticLinkBlocker.join('; ')}\n\n### DIBA side\n\n${diba}\n\n### Public candidate side\n\n${publicCandidates}\n\n### Side-by-side evidence\n\n${evidence}\n\n### Human review\n\n${component.humanReviewQuestion}\n\n- **LINK_TO_EXISTING:** ${component.dispositions.LINK_TO_EXISTING}\n- **KEEP_SEPARATE:** ${component.dispositions.KEEP_SEPARATE}\n- **DEFER:** ${component.dispositions.DEFER}\n\n### Advisory only\n\n**${component.advisoryRecommendation.recommendedDisposition} (${component.advisoryRecommendation.confidence})** — ${component.advisoryRecommendation.rationale}\n\nExternal/manual URL inspection required: ${component.advisoryRecommendation.requiresExternalUrlInspection ? 'yes' : 'no'}.`;
  }).join('\n\n');
  return `# DIBA M1.4D1 — Human review pack: unresolved CONFIRMED components\n\n**READ-ONLY REVIEW PREPARATION — NO DECISIONS APPLIED, NO SQLITE MUTATION.**\n\nScope: ${pack.scope}. Components: ${pack.summary.unresolvedConfirmedComponents}.\n\n| # | DIBA title | Public title | Date | Municipality | Topology | Auto-link blocker | Recommendation | Confidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${index}\n\nRecommendation counts: ${Object.entries(pack.summary.recommendationCounts).map(([key, value]) => `${key}=${value}`).join(', ')}.\n\n${details}\n`;
}
