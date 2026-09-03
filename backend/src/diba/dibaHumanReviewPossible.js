import { identityKey } from './dibaPolicyOverrides.js';

function text(value) { const result = String(value ?? '').trim(); return result || null; }
function parsePayload(value) { try { return JSON.parse(value); } catch { return {}; } }
function isDiba(source) { return String(source.key || source.sourceKey || '').startsWith('diba-'); }
function identity(source) { return { sourceKey: source.key, sourceRecordId: String(source.source_record_id) }; }
function formatIdentity(value) { return value ? `${value.sourceKey}:${value.sourceRecordId}` : '—'; }
function escapeMarkdown(value) { return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function excerpt(value, limit = 280) { const clean = text(value)?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') || null; return clean && clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean; }
function countBy(items, keyOf) { const result = {}; for (const item of items) { const key = keyOf(item); result[key] = (result[key] || 0) + 1; } return result; }
function topology(component) {
  const diba = component.dibaPlanIds.length; const publicPlans = component.candidatePlanIds.length;
  if (diba === 1 && publicPlans === 1) return '1 DIBA -> 1 public';
  if (diba > 1 && publicPlans === 1) return 'N DIBA -> 1 public';
  if (diba === 1 && publicPlans > 1) return '1 DIBA -> N public';
  if (diba > 1 && publicPlans > 1) return 'N DIBA -> N public';
  return 'complex';
}
function haversineKilometres(left, right) {
  if (![left?.latitude, left?.longitude, right?.latitude, right?.longitude].every(Number.isFinite)) return null;
  const radians = (value) => value * Math.PI / 180; const earth = 6371;
  const dLat = radians(right.latitude - left.latitude); const dLon = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLon / 2) ** 2;
  return Number((earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(4));
}
function sourcesFor(planId, state) { return state.sourcesByPlan.get(planId) || []; }
function occurrenceFor(planId, state) { return state.occurrencesByPlan.get(planId) || []; }
function currentProvenanceState(plan, sources) {
  if (!sources.length) return 'NO_PROVENANCE';
  if (sources.every(isDiba)) return plan?.status === 'active' ? 'DIBA_ONLY_ACTIVE_STAGING' : 'DIBA_ONLY_INACTIVE_STAGING';
  if (sources.some((source) => !isDiba(source) && Number(source.enabled) === 1)) return 'SHARED_WITH_ENABLED_PUBLIC_SOURCE';
  return plan?.status === 'active' ? 'SHARED_NO_ENABLED_PUBLIC_SOURCE' : 'SHARED_OR_PUBLIC_INACTIVE';
}
function componentFindings(component, findings) {
  return findings.filter(({ dibaPlanId, candidatePublicPlanId }) => component.dibaPlanIds.includes(dibaPlanId) && component.candidatePlanIds.includes(candidatePublicPlanId));
}
function dibaRecord(finding, state) {
  const record = finding.diba; const sourceKey = finding.sourceKey; const sourceRecordId = String(finding.sourceRecordId); const plan = state.plansById.get(finding.dibaPlanId);
  const source = sourcesFor(finding.dibaPlanId, state).find((item) => item.key === sourceKey && String(item.source_record_id) === sourceRecordId);
  const payload = parsePayload(source?.source_payload_json); const address = payload.grup_adreca || {}; const relation = payload.rel_municipis || {};
  return {
    stableIdentity: { sourceKey, sourceRecordId }, diagnostic: { currentPlanId: finding.dibaPlanId }, dataset: source?.dataset_id || record.dataset || null,
    content: {
      title: record.title, normalizedTitle: record.normalizedTitle, descriptionExcerpt: excerpt(payload.descripcio || payload.description),
      startDate: record.startDate, endDate: record.endDate, municipalityLiteral: record.rawMunicipalityName || relation.municipi_nom || address.municipi_nom || null,
      resolvedMunicipality: plan?.municipality || record.municipality || null, ine: record.rawIne || relation.ine || null,
      comarca: plan?.comarca || relation.grup_comarca?.comarca_nom || null, locality: plan?.locality || null,
      venue: record.venue, normalizedVenue: plan?.venue_name_normalized || null, address: record.address, coordinates: record.coordinates,
      scheduleText: plan?.schedule_text || null, session: record.session || null, duration: text(payload.durada), days: text(payload.dies),
      sourceUrl: source?.source_url || record.sourceUrl || null, effectiveUrl: source?.source_url || record.matcherSourceUrl || record.sourceUrl || null,
      secondaryPayloadUrls: record.secondaryPayloadUrls || [], acteId: text(payload.acte_id) || sourceRecordId,
    },
    state: { sourceEnabled: Number(source?.enabled) === 1, sourceActive: source ? 'present' : 'missing', planStatus: plan?.status || null, inactiveAt: plan?.inactive_at || null, provenance: currentProvenanceState(plan, sourcesFor(finding.dibaPlanId, state)) },
  };
}
function publicRecord(planId, state) {
  const plan = state.plansById.get(planId); const sources = sourcesFor(planId, state);
  const publicSources = sources.filter((source) => !isDiba(source) && Number(source.enabled) === 1)
    .sort((left, right) => identity(left).sourceKey.localeCompare(identity(right).sourceKey) || String(left.source_record_id).localeCompare(String(right.source_record_id)));
  const preferred = publicSources.find(({ key }) => key === 'gencat-agenda') || publicSources[0] || null;
  const provenance = sources.map((source) => ({ stableIdentity: identity(source), enabled: Number(source.enabled) === 1, sourceUrl: source.source_url || null, dataset: source.dataset_id || null, makesPlanPublic: !isDiba(source) && Number(source.enabled) === 1 }));
  return {
    diagnostic: { planId }, canonical: {
      title: plan?.original_title || null, normalizedTitle: plan?.original_title_normalized || null, descriptionExcerpt: excerpt(plan?.original_description),
      startDate: plan?.start_date || null, endDate: plan?.end_date || null, municipality: plan?.municipality || null, ine: plan?.municipality_ine || null,
      comarca: plan?.comarca || null, locality: plan?.locality || null, venue: plan?.venue_name || null, normalizedVenue: plan?.venue_name_normalized || null,
      address: plan?.address || null, coordinates: Number.isFinite(plan?.latitude) && Number.isFinite(plan?.longitude) ? { latitude: plan.latitude, longitude: plan.longitude } : null,
      canonicalUrl: plan?.website_url || null, active: plan?.status === 'active', status: plan?.status || null, inactiveAt: plan?.inactive_at || null,
    }, provenance, enabledPublicAnchor: preferred ? identity(preferred) : null,
    enabledPublicAnchorReason: preferred ? (publicSources.length === 1 ? 'sole enabled non-DIBA provenance on this public plan' : `deterministic enabled public provenance selected from ${publicSources.length} candidates`) : 'no enabled non-DIBA provenance is available',
    occurrenceEvidence: occurrenceFor(planId, state), commerceRelevantProvenance: provenance.filter(({ stableIdentity }) => ['fever', 'ticketmaster'].includes(stableIdentity.sourceKey)),
  };
}
function comparison(value, left, right) { return value ? 'exact/normalized match' : (!left || !right ? 'absent' : 'conflict'); }
function evidenceMatrix(finding, diba, candidate) {
  const evidence = finding.evidence || {}; const publicContent = candidate.canonical; const publicUrls = candidate.provenance.map(({ sourceUrl }) => sourceUrl).filter(Boolean);
  const dibaSession = diba.content.session?.fields || null; const publicSessions = candidate.occurrenceEvidence;
  return {
    title: { exactNormalized: Boolean(evidence.titleExact), diba: diba.content.title, public: publicContent.title, meaningfulDifference: evidence.titleExact ? null : 'normalized titles differ' },
    dateInterval: { exact: evidence.intervalRelation === 'identical', relation: evidence.intervalRelation || 'unknown', diba: { startDate: diba.content.startDate, endDate: diba.content.endDate }, public: { startDate: publicContent.startDate, endDate: publicContent.endDate } },
    municipality: { canonicalMatch: evidence.municipalityMatch ? 'yes' : 'no', diba: diba.content.resolvedMunicipality, public: publicContent.municipality },
    venue: { comparison: comparison(evidence.venueMatch, diba.content.venue, publicContent.venue), diba: diba.content.venue, public: publicContent.venue },
    address: { comparison: comparison(evidence.addressMatch, diba.content.address, publicContent.address), diba: diba.content.address, public: publicContent.address },
    coordinates: { diba: diba.content.coordinates, public: publicContent.coordinates, distanceKilometres: haversineKilometres(diba.content.coordinates, publicContent.coordinates), nearbyByApprovedMatcher: Boolean(evidence.coordinatesNear) },
    urls: { dibaEffectiveUrl: diba.content.effectiveUrl, publicSourceUrls: publicUrls, publicCanonicalUrl: publicContent.canonicalUrl, exactEventSpecificRelation: evidence.urlMatch ? 'yes' : 'no/unknown', genericProgrammeOrSiteUrl: diba.content.secondaryPayloadUrls.length ? 'yes' : 'no', secondaryDibaUrls: diba.content.secondaryPayloadUrls },
    session: { diba: { scheduleText: diba.content.scheduleText, fields: dibaSession }, publicStructuredOccurrences: publicSessions, comparison: !dibaSession && !publicSessions.length ? 'absent' : (!dibaSession || !publicSessions.length ? 'absent on one side' : 'requires human comparison') },
    descriptionOrganizerArtist: { dibaExcerpt: diba.content.descriptionExcerpt, publicExcerpt: publicContent.descriptionExcerpt, comparison: 'not used by the approved matcher; human inspection only' },
    matcher: { supportingSignalCount: evidence.supportingSignalCount ?? 0, disposition: evidence.matcherDisposition || 'POSSIBLE_NEEDS_HUMAN_REVIEW', reason: evidence.reason || null },
  };
}
function reasons(findings, component) {
  const possible = [...new Set(findings.map(({ evidence }) => evidence?.reason).filter(Boolean))];
  const notConfirmed = [...new Set(findings.map(({ evidence }) => {
    const missing = [];
    if (!evidence?.venueMatch) missing.push('matching venue'); if (!evidence?.addressMatch) missing.push('matching address'); if (!evidence?.urlMatch) missing.push('shared event-specific URL'); if (!evidence?.coordinatesNear) missing.push('nearby coordinates');
    return `Current matcher requires independent corroboration; this edge has no ${missing.join(', ')}.`;
  }))];
  const automatic = component.dibaPlanIds.length !== 1 ? ['Component is not reducible to one independently corroborated DIBA concept; automatic cross-source linking is prohibited.'] : ['Cross-source evidence is not venue+coordinates or equivalent event-specific identity.'];
  return { possible, notConfirmed, automatic };
}
function recommendation(component, relationships) {
  if (component.dibaPlanIds.length !== 1 || component.candidatePlanIds.length !== 1) return {
    recommendedDisposition: 'DEFER', confidence: 'MEDIUM', target: null, rationale: 'The component has non-1:1 topology. A pair-level link could silently leave another plausible record unresolved; review it as one component.', externalReviewPriority: 'REQUIRED',
  };
  const edge = relationships[0];
  return {
    recommendedDisposition: 'UNCERTAIN', confidence: 'LOW', target: null,
    rationale: 'Exact normalized title, municipality and overlapping interval identify a plausible match, but no venue, address, event-specific URL or nearby-coordinate corroboration supports a safe human link recommendation.', externalReviewPriority: 'REQUIRED',
  };
}
function reviewQuestion(component, diba, candidates) {
  if (component.dibaPlanIds.length !== 1 || component.candidatePlanIds.length !== 1) return `Do all ${diba.length} DIBA record(s) represent the same real-world event as the listed public candidate(s), without collapsing distinct sessions?`;
  return `Do ${formatIdentity(diba[0].stableIdentity)} and ${formatIdentity(candidates[0].enabledPublicAnchor)} describe the same real-world event/performance?`;
}
function externalUrls(diba, candidates) { return [...new Set([...diba.flatMap(({ content }) => [content.effectiveUrl, ...content.secondaryPayloadUrls]), ...candidates.flatMap(({ provenance, canonical }) => [...provenance.map(({ sourceUrl }) => sourceUrl), canonical.canonicalUrl])].filter(Boolean))]; }
function componentScore(item) {
  const edge = item.findings[0]?.evidence || {}; return (edge.titleExact ? 8 : 0) + (edge.intervalRelation === 'identical' ? 4 : 0) + (edge.municipalityMatch ? 3 : 0) + (edge.venueMatch ? 2 : 0) + (edge.addressMatch ? 2 : 0) + (edge.urlMatch ? 3 : 0) + (edge.coordinatesNear ? 1 : 0) - (item.component.dibaPlanIds.length - 1) * 5 - (item.component.candidatePlanIds.length - 1) * 5;
}

export function assertNoPossibleOverrides(policy, overrides) {
  const possibleKeys = new Set(policy.crossSource.possible.flatMap(({ findings }) => findings.map(({ sourceKey, sourceRecordId }) => `${sourceKey}:${sourceRecordId}`)));
  const conflicts = overrides.decisions.filter(({ source }) => possibleKeys.has(identityKey(source)));
  if (conflicts.length) throw new Error(`POSSIBLE source already has reviewed override(s): ${conflicts.map(({ source }) => identityKey(source)).join(', ')}.`);
  return { possibleSourceCount: possibleKeys.size, conflictingOverrides: 0 };
}

export function loadPossibleHumanReviewState(db) {
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

export function buildPossibleHumanReviewPack({ auditReport, policy, state, overrides }) {
  assertNoPossibleOverrides(policy, overrides);
  const policyComponents = policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker);
  if (policyComponents.length !== 22) throw new Error(`Expected exactly 22 unresolved POSSIBLE components; found ${policyComponents.length}.`);
  const candidates = policyComponents.map((decision) => {
    const component = decision.component; const findings = componentFindings(component, auditReport.currentPublicCandidates.possible);
    if (!findings.length) throw new Error(`POSSIBLE component ${component.componentId} has no audit findings.`);
    return { component, decision, findings };
  }).sort((left, right) => componentScore(right) - componentScore(left) || String(left.findings[0].diba.title).localeCompare(String(right.findings[0].diba.title)));
  const components = candidates.map(({ component, decision, findings }, index) => {
    const diba = [...new Map(findings.map((finding) => { const item = dibaRecord(finding, state); return [identityKey(item.stableIdentity), item]; })).values()];
    const publicCandidates = component.candidatePlanIds.map((planId) => publicRecord(planId, state));
    const relationships = findings.map((finding) => {
      const dibaSide = diba.find(({ diagnostic }) => diagnostic.currentPlanId === finding.dibaPlanId);
      const publicSide = publicCandidates.find(({ diagnostic }) => diagnostic.planId === finding.candidatePublicPlanId);
      return { diba: dibaSide.stableIdentity, publicPlanIdDiagnostic: finding.candidatePublicPlanId, publicTarget: publicSide.enabledPublicAnchor, evidence: evidenceMatrix(finding, dibaSide, publicSide) };
    });
    const advisoryRecommendation = recommendation(component, relationships); const reason = reasons(findings, component); const urls = externalUrls(diba, publicCandidates);
    return {
      reviewComponentId: `possible-review-${String(index + 1).padStart(3, '0')}`, sourceAuditComponentId: component.componentId, topology: topology(component),
      counts: { dibaSourceRecords: diba.length, dibaCurrentPlans: component.dibaPlanIds.length, publicCandidatePlans: component.candidatePlanIds.length, candidateEdges: findings.length },
      possibleReason: reason.possible, notConfirmedReason: reason.notConfirmed, automaticLinkBlocker: reason.automatic, policyDecision: decision.decision,
      diba, publicCandidates, relationships, humanReviewQuestion: reviewQuestion(component, diba, publicCandidates),
      dispositions: {
        LINK_TO_EXISTING: publicCandidates.every(({ enabledPublicAnchor }) => enabledPublicAnchor) ? `Only after component-complete review, link to one exact stable target: ${publicCandidates.map(({ enabledPublicAnchor }) => formatIdentity(enabledPublicAnchor)).join(', ')}. Never use diagnostic numeric plan IDs.` : 'No enabled public stable target is currently available.',
        KEEP_SEPARATE: `Keep DIBA identities ${diba.map(({ stableIdentity }) => formatIdentity(stableIdentity)).join(', ')} as separate plans only if review establishes a material event/session distinction.`,
        DEFER: 'Keep this component unresolved and unpublished while DIBA remains disabled; do not choose a pair-level target.',
        UNCERTAIN: 'Record no link until an external review establishes or disproves a shared real-world event identity.',
      },
      topologySafety: component.dibaPlanIds.length === 1 && component.candidatePlanIds.length === 1 ? 'One stable target could be selected after evidence review; no automatic link is authorized.' : 'Non-1:1 topology: do not decide any edge pair-by-pair. A decision must explain every DIBA record and every public candidate in this component.',
      advisoryRecommendation, externalReview: { priority: advisoryRecommendation.externalReviewPriority, urls, verify: 'Verify the same artist/company/organizer, scheduled time, venue and whether this is one unique event or a distinct recurring/session listing.' },
      sortEvidence: { title: findings[0].diba.title, date: findings[0].diba.startDate, municipality: findings[0].diba.municipality },
    };
  });
  const recommendationCounts = Object.fromEntries(['LINK_TO_EXISTING', 'KEEP_SEPARATE', 'DEFER', 'UNCERTAIN'].map((value) => [value, components.filter(({ advisoryRecommendation }) => advisoryRecommendation.recommendedDisposition === value).length]));
  const confidenceDistribution = countBy(components, ({ advisoryRecommendation }) => advisoryRecommendation.confidence);
  const externalReviewPriorityCounts = countBy(components, ({ externalReview }) => externalReview.priority);
  return { schemaVersion: 1, readOnly: true, scope: '22 unresolved possible cross-source components only', summary: {
    unresolvedPossibleComponents: components.length, topologyDistribution: countBy(components, ({ topology: value }) => value), recommendationCounts, confidenceDistribution, externalReviewPriorityCounts,
    existingConfirmedOverrides: overrides.decisions.length, possibleOverrides: 0,
    remainingBlockers: { confirmed: policy.crossSource.confirmed.filter(({ activationBlocker }) => activationBlocker).length, possible: policy.crossSource.possible.filter(({ activationBlocker }) => activationBlocker).length, sameFeed: policy.sameFeed.filter(({ decision }) => decision === 'NEEDS_HUMAN_REVIEW').length, sessionDefer: policy.sameFeed.filter(({ decision }) => decision === 'KEEP_SEPARATE_SESSION').length },
    publicActivationReady: policy.activation.publicActivationReady,
  }, components };
}

function details(component) {
  const diba = component.diba.map((item) => `- **${formatIdentity(item.stableIdentity)}** (diagnostic plan ${item.diagnostic.currentPlanId})\n  - title/normalized: ${item.content.title || '—'} / ${item.content.normalizedTitle || '—'}; dates: ${item.content.startDate || '—'} to ${item.content.endDate || '—'}; dataset/acte_id: ${item.dataset || '—'} / ${item.content.acteId || '—'}\n  - description: ${item.content.descriptionExcerpt || '—'}\n  - municipality literal/resolved/INE: ${item.content.municipalityLiteral || '—'} / ${item.content.resolvedMunicipality || '—'} / ${item.content.ine || '—'}; comarca/locality: ${item.content.comarca || '—'} / ${item.content.locality || '—'}\n  - venue/normalized/address/coordinates: ${item.content.venue || '—'} / ${item.content.normalizedVenue || '—'} / ${item.content.address || '—'} / ${JSON.stringify(item.content.coordinates)}\n  - schedule/session/duration/days: ${item.content.scheduleText || '—'} / ${JSON.stringify(item.content.session)} / ${item.content.duration || '—'} / ${item.content.days || '—'}\n  - effective URL: ${item.content.effectiveUrl || '—'}; secondary URLs: ${item.content.secondaryPayloadUrls.join(', ') || '—'}\n  - state: source enabled=${item.state.sourceEnabled}; plan=${item.state.planStatus}; inactive_at=${item.state.inactiveAt || '—'}; provenance=${item.state.provenance}`).join('\n');
  const publicCandidates = component.publicCandidates.map((item) => `- **diagnostic plan ${item.diagnostic.planId}**\n  - title/normalized: ${item.canonical.title || '—'} / ${item.canonical.normalizedTitle || '—'}; dates: ${item.canonical.startDate || '—'} to ${item.canonical.endDate || '—'}\n  - description: ${item.canonical.descriptionExcerpt || '—'}\n  - municipality/INE/comarca/locality: ${item.canonical.municipality || '—'} / ${item.canonical.ine || '—'} / ${item.canonical.comarca || '—'} / ${item.canonical.locality || '—'}\n  - venue/normalized/address/coordinates: ${item.canonical.venue || '—'} / ${item.canonical.normalizedVenue || '—'} / ${item.canonical.address || '—'} / ${JSON.stringify(item.canonical.coordinates)}\n  - canonical URL: ${item.canonical.canonicalUrl || '—'}; active=${item.canonical.active}; inactive_at=${item.canonical.inactiveAt || '—'}\n  - enabled public anchor: ${formatIdentity(item.enabledPublicAnchor)} (${item.enabledPublicAnchorReason})\n  - provenance: ${item.provenance.map(({ stableIdentity, enabled, sourceUrl, makesPlanPublic }) => `${formatIdentity(stableIdentity)} [enabled=${enabled}; public=${makesPlanPublic}; url=${sourceUrl || '—'}]`).join('; ')}\n  - commerce provenance: ${item.commerceRelevantProvenance.map(({ stableIdentity }) => formatIdentity(stableIdentity)).join(', ') || '—'}`).join('\n');
  const edges = component.relationships.map((relationship) => {
    const evidence = relationship.evidence;
    return `- **${formatIdentity(relationship.diba)} -> ${formatIdentity(relationship.publicTarget)}** (public plan diagnostic ${relationship.publicPlanIdDiagnostic})\n  - title exact normalized=${evidence.title.exactNormalized}; date exact=${evidence.dateInterval.exact}; relation=${evidence.dateInterval.relation}; municipality=${evidence.municipality.canonicalMatch}\n  - venue=${evidence.venue.comparison}; address=${evidence.address.comparison}; coordinates=${JSON.stringify(evidence.coordinates)}\n  - URL relation=${evidence.urls.exactEventSpecificRelation}; DIBA=${evidence.urls.dibaEffectiveUrl || '—'}; public=${evidence.urls.publicSourceUrls.join(', ') || '—'}\n  - session=${evidence.session.comparison}; matcher=${evidence.matcher.disposition}; signals=${evidence.matcher.supportingSignalCount}; reason=${evidence.matcher.reason || '—'}`;
  }).join('\n');
  return `### ${component.reviewComponentId} (${component.sourceAuditComponentId})\n\n**Topology:** ${component.topology}. DIBA source records: ${component.counts.dibaSourceRecords}; DIBA current plans: ${component.counts.dibaCurrentPlans}; public candidate plans: ${component.counts.publicCandidatePlans}; candidate edges: ${component.counts.candidateEdges}.\n\n**POSSIBLE BECAUSE:** ${component.possibleReason.join(' ; ')}\n\n**NOT CONFIRMED BECAUSE:** ${component.notConfirmedReason.join(' ; ')}\n\n**AUTO-LINK BLOCKED BECAUSE:** ${component.automaticLinkBlocker.join(' ; ')}\n\n#### DIBA side\n${diba}\n\n#### Public candidate side\n${publicCandidates}\n\n#### Evidence matrix\n${edges}\n\n#### Human review\n\nQuestion: ${component.humanReviewQuestion}\n\nLINK_TO_EXISTING: ${component.dispositions.LINK_TO_EXISTING}\n\nKEEP_SEPARATE: ${component.dispositions.KEEP_SEPARATE}\n\nDEFER: ${component.dispositions.DEFER}\n\nUNCERTAIN: ${component.dispositions.UNCERTAIN}\n\n**Topology safety:** ${component.topologySafety}\n\n**Advisory only:** ${component.advisoryRecommendation.recommendedDisposition} (${component.advisoryRecommendation.confidence}) — ${component.advisoryRecommendation.rationale}\n\n**External URL review:** ${component.externalReview.priority}. Verify: ${component.externalReview.verify}\n\nURLs: ${component.externalReview.urls.join(', ') || 'none stored'}\n`;
}

export function renderPossibleHumanReviewMarkdown(pack) {
  const index = pack.components.map((component, index) => {
    const diba = component.diba.map(({ content }) => content.title).join(' / '); const publicCandidates = component.publicCandidates.map(({ canonical }) => canonical.title).join(' / ');
    return `| ${index + 1} | ${escapeMarkdown(diba)} | ${escapeMarkdown(publicCandidates)} | ${escapeMarkdown(component.sortEvidence.date)} | ${escapeMarkdown(component.sortEvidence.municipality)} | ${component.topology} | ${escapeMarkdown(component.possibleReason.join('; '))} | ${component.advisoryRecommendation.recommendedDisposition} | ${component.advisoryRecommendation.confidence} |`;
  }).join('\n');
  return `# DIBA M1.4E1 — Human review pack: unresolved POSSIBLE components\n\nGenerated: ${pack.generatedAt || 'not recorded'}\n\n**Read-only:** this dossier records no decision, changes no SQLite/override/policy/matcher state, and covers only the current unresolved POSSIBLE cross-source components.\n\n## Compact index\n\n| # | DIBA title | Public candidate(s) | Date | Municipality | Topology | Why POSSIBLE | Recommendation | Confidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${index}\n\n## Current review boundary\n\nPOSSIBLE components: ${pack.summary.unresolvedPossibleComponents}. Existing CONFIRMED overrides: ${pack.summary.existingConfirmedOverrides}; POSSIBLE overrides: ${pack.summary.possibleOverrides}. Remaining blockers: CONFIRMED ${pack.summary.remainingBlockers.confirmed}; POSSIBLE ${pack.summary.remainingBlockers.possible}; same-feed ${pack.summary.remainingBlockers.sameFeed}; session DEFER ${pack.summary.remainingBlockers.sessionDefer}. **PUBLIC ACTIVATION READY: ${pack.summary.publicActivationReady ? 'YES' : 'NO'}**.\n\n${pack.components.map(details).join('\n')}\n`;
}
