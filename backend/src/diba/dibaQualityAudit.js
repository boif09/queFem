import { createHash } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from '../db/database.js';
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';
import { readAndVerifyIcgcSnapshot } from '../geography/icgcSnapshot.js';
import { DEFAULT_ICGC_MANIFEST_PATH } from '../jobs/updateIcgcGeography.js';

const DIBA_PREFIX = 'diba-';
const MUNICIPALITY_AUDIT_BUCKETS = [
  'EXACT_MUNICIPALITY_NAME_CANDIDATE', 'NORMALIZED_MUNICIPALITY_NAME_CANDIDATE',
  'POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION', 'LOCALITY_OR_SUBMUNICIPAL',
  'COMARCA_OR_REGION', 'MULTI_AREA_OR_SUPRAMUNICIPAL', 'MISSING_NAME', 'UNKNOWN_REVIEW_REQUIRED',
];
const LOCALITY_RULES = [{
  rawName: "Sant Pau d'Ordal", municipality: 'Subirats', ine: '08273',
  reason: 'Curated report-only locality rule: Sant Pau d’Ordal is a locality of Subirats; this is not an automatic resolution.',
}];

function text(value) { const result = String(value ?? '').trim(); return result || null; }
function dateOnly(value) { return String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null; }
function normalized(value) { return normalizeForFingerprint(value, { removeArticles: true }); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))]; }
function sourceKey(record) { return `${record.sourceKey}:${record.sourceRecordId}`; }
function parsePayload(value) { try { return JSON.parse(value); } catch { return {}; } }
function groupBy(items, keyOf) { const groups = new Map(); for (const item of items) { const key = keyOf(item); const group = groups.get(key) || []; group.push(item); groups.set(key, group); } return groups; }
function coordinatePair(value) { const match = String(value || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/); if (!match) return null; const latitude = Number(match[1]); const longitude = Number(match[2]); return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null; }
function intervalOverlaps(left, right) { return left.startDate && right.startDate && left.startDate <= (right.endDate || right.startDate) && (left.endDate || left.startDate) >= right.startDate; }
function near(left, right) { return [left.coordinates?.latitude, left.coordinates?.longitude, right.coordinates?.latitude, right.coordinates?.longitude].every(Number.isFinite) && Math.abs(left.coordinates.latitude - right.coordinates.latitude) <= 0.002 && Math.abs(left.coordinates.longitude - right.coordinates.longitude) <= 0.002; }
function matcherIncomingUrl(record) { return record.matcherSourceUrl ?? record.sourceUrl ?? null; }
function matcherCandidateUrls(record) { return record.matcherCandidateUrls ?? record.urls ?? []; }

// This mirrors MultiSourceMatcher.matchDibaCandidates without changing it.
// URL evidence is only the persisted incoming DIBA source URL. Secondary
// payload URLs are retained for reporting but never increase confidence.
export function dibaEvidence(left, right) {
  if (!left.normalizedTitle || left.normalizedTitle !== right.normalizedTitle || !left.normalizedMunicipality || left.normalizedMunicipality !== right.normalizedMunicipality || !intervalOverlaps(left, right)) return null;
  const venueMatch = Boolean(left.venue && normalized(left.venue) === normalized(right.venue));
  const addressMatch = Boolean(left.address && normalized(left.address) === normalized(right.address));
  const incomingUrl = matcherIncomingUrl(left); const urlMatch = Boolean(incomingUrl && matcherCandidateUrls(right).includes(incomingUrl)); const coordinatesNear = near(left, right);
  const signals = [venueMatch && 'matching venue', addressMatch && 'matching address', urlMatch && 'matching URL', coordinatesNear && 'nearby coordinates'].filter(Boolean);
  return {
    titleExact: true, municipalityMatch: true, dateOverlap: true, venueMatch, addressMatch, urlMatch, coordinatesNear, matcherIncomingSourceUrl: incomingUrl,
    supportingSignalCount: signals.length, intervalRelation: left.startDate === right.startDate && (left.endDate || left.startDate) === (right.endDate || right.startDate) ? 'identical' : 'overlapping',
    reason: signals.length ? `same title, municipality and overlapping interval; ${signals.join(', ')}` : 'same title, municipality and overlapping interval, but no matching venue, address, URL or nearby coordinates',
    matcherDisposition: signals.length ? 'CONFIRMED' : 'POSSIBLE_NEEDS_HUMAN_REVIEW', confirmedByCurrentMatcher: signals.length > 0,
  };
}

class UnionFind { constructor(size) { this.parent = Array.from({ length: size }, (_, index) => index); } find(index) { return this.parent[index] === index ? index : (this.parent[index] = this.find(this.parent[index])); } join(left, right) { left = this.find(left); right = this.find(right); if (left !== right) this.parent[right] = left; } }
function sessionEvidence(payload, scheduleText = null) { const fields = { observacionsHorari: text(payload.observacions_horari), durada: text(payload.durada), dies: text(payload.dies), scheduleText: text(scheduleText) }; const present = Object.values(fields).some(Boolean); return { present, fields, fingerprint: present ? JSON.stringify(fields) : null }; }
function sessionComparison(records) { const present = records.filter(({ session }) => session?.present); if (!present.length) return { availability: 'ABSENT_FOR_ALL', comparison: 'UNKNOWN_ABSENT' }; if (present.length !== records.length) return { availability: 'PRESENT_FOR_SOME', comparison: 'UNKNOWN_INCOMPLETE' }; return new Set(present.map(({ session }) => session.fingerprint)).size === 1 ? { availability: 'PRESENT_FOR_ALL', comparison: 'IDENTICAL_SESSION_EVIDENCE' } : { availability: 'PRESENT_FOR_ALL', comparison: 'CONFLICTING_SESSION_EVIDENCE' }; }
function recordSummary(record) { return { sourceRecordId: record.sourceRecordId, planId: record.planId, title: record.title, normalizedTitle: record.normalizedTitle, startDate: record.startDate, endDate: record.endDate, municipality: record.municipality, venue: record.venue, address: record.address, matcherSourceUrl: matcherIncomingUrl(record), matcherCandidateUrls: matcherCandidateUrls(record), secondaryPayloadUrls: record.secondaryPayloadUrls || [], coordinates: record.coordinates, session: record.session || null }; }

export function buildSameFeedClusters(records) {
  const clusters = [];
  for (const [feedKey, sourceRecords] of groupBy(records, ({ sourceKey: key }) => key)) {
    const union = new UnionFind(sourceRecords.length); const edges = [];
    for (let left = 0; left < sourceRecords.length; left += 1) for (let right = left + 1; right < sourceRecords.length; right += 1) { const evidence = dibaEvidence(sourceRecords[left], sourceRecords[right]); if (evidence?.confirmedByCurrentMatcher) { union.join(left, right); edges.push({ left, right, evidence }); } }
    const byRoot = new Map(); sourceRecords.forEach((record, index) => { const root = union.find(index); const members = byRoot.get(root) || []; members.push({ record, index }); byRoot.set(root, members); });
    let ordinal = 0;
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      ordinal += 1; const indexes = new Set(members.map(({ index }) => index)); const clusterEdges = edges.filter(({ left, right }) => indexes.has(left) && indexes.has(right)); const componentRecords = members.map(({ record }) => record);
      const planIds = unique(componentRecords.map(({ planId }) => planId)); const allDibaOnly = componentRecords.every(({ dibaOnly }) => dibaOnly); const allOnePlan = planIds.length === 1; const possibleEdgeCount = (members.length * (members.length - 1)) / 2; const isClique = clusterEdges.length === possibleEdgeCount; const sessions = sessionComparison(componentRecords); const allStrong = clusterEdges.length > 0 && clusterEdges.every(({ evidence }) => evidence.supportingSignalCount >= 2);
      const classification = allOnePlan ? 'ALREADY_CONSOLIDATED' : (!allDibaOnly || !isClique || sessions.comparison === 'CONFLICTING_SESSION_EVIDENCE' ? 'NEEDS_HUMAN_REVIEW' : (allStrong ? 'HIGH_CONFIDENCE_DUPLICATE_CANDIDATE' : 'PROBABLE_DUPLICATE_CANDIDATE'));
      clusters.push({ sourceKey: feedKey, dataset: componentRecords[0].dataset, clusterId: `${feedKey}-${ordinal}`, sourceRecordCount: members.length, sourceRecordIds: componentRecords.map(({ sourceRecordId }) => sourceRecordId), planIds, distinctPlanCount: planIds.length, everyRecordMapsToSamePlan: allOnePlan, anyCurrentPlanHasEnabledSource: componentRecords.some(({ enabledSourceKeys }) => enabledSourceKeys.length > 0), allPlansDibaOnly: allDibaOnly, activationDuplicateRisk: !allOnePlan && allDibaOnly, classification, topology: { memberCount: members.length, actualEdgeCount: clusterEdges.length, possibleEdgeCount, isClique }, sessionEvidence: sessions, records: componentRecords.map(recordSummary), evidence: clusterEdges.map(({ left, right, evidence }) => ({ sourceRecordIds: [sourceRecords[left].sourceRecordId, sourceRecords[right].sourceRecordId], ...evidence })) });
    }
  }
  return clusters.sort((left, right) => left.sourceKey.localeCompare(right.sourceKey) || left.clusterId.localeCompare(right.clusterId));
}
export function summarizeSameFeedClusters(clusters) {
  const atRiskPlanIds = new Set(clusters.filter(({ activationDuplicateRisk }) => activationDuplicateRisk).flatMap(({ planIds }) => planIds));
  return { totalClusters: clusters.length, totalSourceRecordsInvolved: clusters.reduce((total, item) => total + item.sourceRecordCount, 0), alreadyConsolidatedClusters: clusters.filter(({ everyRecordMapsToSamePlan }) => everyRecordMapsToSamePlan).length, multiPlanClusters: clusters.filter(({ distinctPlanCount }) => distinctPlanCount > 1).length, nonCliqueClusters: clusters.filter(({ topology }) => !topology.isClique).length, conflictingSessionClusters: clusters.filter(({ sessionEvidence }) => sessionEvidence.comparison === 'CONFLICTING_SESSION_EVIDENCE').length, dibaOnlyPlansAtActivationRisk: atRiskPlanIds.size, bySource: Object.fromEntries([...groupBy(clusters, ({ sourceKey }) => sourceKey)].map(([key, items]) => [key, { clusters: items.length, sourceRecords: items.reduce((total, item) => total + item.sourceRecordCount, 0), multiPlanClusters: items.filter(({ distinctPlanCount }) => distinctPlanCount > 1).length }])) };
}

function sourcesFor(plan, allSourcesByPlan) { return allSourcesByPlan.get(plan.id) || []; }
function planProfile(plan, allSourcesByPlan) { const sources = sourcesFor(plan, allSourcesByPlan); const enabledSourceKeys = sources.filter(({ enabled }) => enabled === 1).map(({ key }) => key); return { ...plan, sources, enabledSourceKeys, dibaOnly: sources.length > 0 && sources.every(({ key }) => key.startsWith(DIBA_PREFIX)) }; }
function visibilityContext(plan) {
  if (!plan?.enabledSourceKeys?.length) return { state: 'NO_ENABLED_SOURCE', publishability: 'NOT_PUBLISHABLE_NO_ENABLED_SOURCE', countedAsCurrentTwoCardRisk: false };
  if (plan.status !== 'active') return { state: 'ENABLED_SOURCE_INACTIVE', publishability: 'NOT_PUBLISHABLE_PLAN_INACTIVE', countedAsCurrentTwoCardRisk: false };
  return { state: 'ENABLED_SOURCE_CURRENTLY_ACTIVE', publishability: 'ENABLED_SOURCE_VISIBILITY_CONTEXT_DEPENDENT', countedAsCurrentTwoCardRisk: true, note: 'The public query additionally evaluates occurrences, quality, retention, Catalonia scope and temporal coherence; this audit does not claim a guaranteed visible card.' };
}

export function reconcileHistoricalAmbiguities({ originalRuns, dibaRecordsByKey, plansById, allSourcesByPlan }) {
  const findings = []; const historicalPairs = new Set(); const historicalSourceRecords = new Set();
  for (const run of originalRuns) for (const detail of parsePayload(run.summary_json).ambiguousDetails || []) {
    const acteId = String(detail.diba?.acteId || ''); const historicalKey = `${run.sourceKey}:${acteId}`; const record = dibaRecordsByKey.get(historicalKey) || null; const candidateId = detail.candidatePlan?.id ?? null; const candidate = candidateId === null ? null : plansById.get(Number(candidateId)) || null; const dibaProfile = record ? planProfile(plansById.get(record.planId), allSourcesByPlan) : null; const candidateProfile = candidate ? planProfile(candidate, allSourcesByPlan) : null; const samePlan = Boolean(dibaProfile && candidateProfile && dibaProfile.id === candidateProfile.id); const candidateVisibility = visibilityContext(candidateProfile); const publicConflict = Boolean(!samePlan && dibaProfile?.dibaOnly && candidateVisibility.countedAsCurrentTwoCardRisk); const classification = samePlan ? 'RESOLVED_SAME_PLAN' : (publicConflict ? 'PUBLIC_DUPLICATE_RISK' : (candidateVisibility.state === 'ENABLED_SOURCE_INACTIVE' ? 'ENABLED_SOURCE_INACTIVE_DIAGNOSTIC' : (dibaProfile && candidateProfile ? 'SEPARATE_BUT_NO_PUBLIC_CONFLICT' : 'NEEDS_HUMAN_REVIEW')));
    historicalSourceRecords.add(historicalKey); if (candidateId !== null) historicalPairs.add(`${historicalKey}:${candidateId}`);
    findings.push({ sourceKey: run.sourceKey, firstCompletedImportRunId: run.importRunId, sourceRecordId: acteId, currentDibaPlanId: dibaProfile?.id ?? null, historicalCandidatePlanId: candidateId, candidatePlanExists: Boolean(candidateProfile), currentDibaPlanExists: Boolean(dibaProfile), samePlan, currentDibaPlanStatus: dibaProfile?.status ?? null, currentDibaPlanEnabledSources: dibaProfile?.enabledSourceKeys || [], currentDibaPlanDibaOnly: Boolean(dibaProfile?.dibaOnly), candidatePlanStatus: candidateProfile?.status ?? null, candidatePlanInactiveAt: candidateProfile?.inactive_at ?? null, currentCandidatePlanEnabledSources: candidateProfile?.enabledSourceKeys || [], candidateVisibility, wouldEnableTwoPublicCards: publicConflict, classification, originalEvidence: detail.evidence || null });
  }
  return { findings, historicalPairs, historicalSourceRecords, firstCompletedRuns: originalRuns.map(({ sourceKey: key, importRunId }) => ({ sourceKey: key, importRunId })), summary: { findingCount: findings.length, distinctHistoricalSourceRecordCount: historicalSourceRecords.size, distinctHistoricalCandidatePlanCount: new Set(findings.map(({ historicalCandidatePlanId }) => historicalCandidatePlanId).filter(Number.isFinite)).size, classifications: Object.fromEntries([...groupBy(findings, ({ classification }) => classification)].map(([key, rows]) => [key, rows.length])) } };
}

export function buildConflictComponents(findings) {
  const adjacency = new Map(); const add = (left, right) => { const values = adjacency.get(left) || new Set(); values.add(right); adjacency.set(left, values); };
  for (const finding of findings) { const diba = `d:${finding.dibaPlanId}`; const candidate = `p:${finding.candidatePublicPlanId}`; add(diba, candidate); add(candidate, diba); }
  const seen = new Set(); const components = [];
  for (const start of adjacency.keys()) { if (seen.has(start)) continue; const nodes = new Set(); const pending = [start]; seen.add(start); while (pending.length) { const node = pending.pop(); nodes.add(node); for (const next of adjacency.get(node) || []) if (!seen.has(next)) { seen.add(next); pending.push(next); } } const dibaPlanIds = [...nodes].filter((node) => node.startsWith('d:')).map((node) => Number(node.slice(2))).sort((a, b) => a - b); const candidatePlanIds = [...nodes].filter((node) => node.startsWith('p:')).map((node) => Number(node.slice(2))).sort((a, b) => a - b); const componentFindings = findings.filter(({ dibaPlanId, candidatePublicPlanId }) => nodes.has(`d:${dibaPlanId}`) && nodes.has(`p:${candidatePublicPlanId}`)); components.push({ componentId: `conflict-${components.length + 1}`, dibaPlanIds, candidatePlanIds, pairCount: componentFindings.length, dibaSourceRecordIds: unique(componentFindings.map(({ sourceRecordId }) => sourceRecordId)).sort() }); }
  return components;
}
export function summarizeCurrentCandidateSet(findings) {
  const conflictComponents = buildConflictComponents(findings); const historicalOverlapPairCounts = Object.fromEntries(['EXACT_FIRST_IMPORT_PAIR', 'HISTORICALLY_AMBIGUOUS_SOURCE_RECORD', 'NEW_SOURCE_RECORD'].map((key) => [key, 0])); for (const finding of findings) historicalOverlapPairCounts[finding.historicalOverlap.kind] += 1;
  return { pairCount: findings.length, distinctDibaSourceRecordCount: new Set(findings.map(({ sourceRecordId }) => sourceRecordId)).size, distinctDibaPlanCount: new Set(findings.map(({ dibaPlanId }) => dibaPlanId)).size, distinctCandidatePlanCount: new Set(findings.map(({ candidatePublicPlanId }) => candidatePublicPlanId)).size, distinctConflictComponentCount: conflictComponents.length, activePlanStateTwoCardRiskPairCount: findings.filter(({ countedAsCurrentTwoCardRisk }) => countedAsCurrentTwoCardRisk).length, historicalOverlapPairCounts, conflictComponents };
}
export function scanCurrentPublicDuplicateCandidates({ dibaRecords, publicPlans, historicalPairs = new Set(), historicalSourceRecords = new Set() }) {
  const confirmed = []; const possible = [];
  for (const record of dibaRecords.filter(({ dibaOnly }) => dibaOnly)) for (const plan of publicPlans) {
    if (plan.id === record.planId) continue; const candidate = { ...plan, planId: plan.id }; const evidence = dibaEvidence(record, candidate); if (!evidence) continue;
    const pairKey = `${sourceKey(record)}:${plan.id}`; const historicalOverlap = historicalPairs.has(pairKey) ? { kind: 'EXACT_FIRST_IMPORT_PAIR' } : (historicalSourceRecords.has(sourceKey(record)) ? { kind: 'HISTORICALLY_AMBIGUOUS_SOURCE_RECORD' } : { kind: 'NEW_SOURCE_RECORD' }); const candidateVisibility = visibilityContext(candidate);
    const finding = { sourceKey: record.sourceKey, sourceRecordId: record.sourceRecordId, dibaPlanId: record.planId, dibaPlanStatus: record.status ?? null, candidatePublicPlanId: plan.id, candidateEnabledSourceKeys: plan.enabledSourceKeys, candidatePlanStatus: plan.status ?? null, candidatePlanInactiveAt: plan.inactive_at ?? null, candidateVisibility, countedAsCurrentTwoCardRisk: candidateVisibility.countedAsCurrentTwoCardRisk, diba: recordSummary(record), candidate: recordSummary(candidate), evidence, historicalOverlap, classification: evidence.confirmedByCurrentMatcher ? 'CONFIRMED_MATCHER_PAIR' : 'POSSIBLE_NEEDS_HUMAN_REVIEW' };
    (evidence.confirmedByCurrentMatcher ? confirmed : possible).push(finding);
  }
  return { confirmed, possible, confirmedSummary: summarizeCurrentCandidateSet(confirmed), possibleSummary: summarizeCurrentCandidateSet(possible) };
}

export function municipalityReferencesFromSnapshot(snapshot) { return (snapshot?.features || []).map(({ properties }) => ({ municipality: properties.NOMMUNI, ine: String(properties.CODIMUNI || '').slice(0, 5), comarca: properties.NOMCOMAR })).filter(({ municipality, ine }) => municipality && /^\d{5}$/.test(ine)); }
function levenshtein(left, right) { const prior = Array.from({ length: right.length + 1 }, (_, index) => index); for (let i = 1; i <= left.length; i += 1) { let previous = prior[0]; prior[0] = i; for (let j = 1; j <= right.length; j += 1) { const current = prior[j]; prior[j] = Math.min(prior[j] + 1, prior[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1)); previous = current; } } return prior[right.length]; }
function typoOrAbbreviationCandidate(rawName, references) {
  const raw = normalized(rawName); if (raw.length < 7) return null;
  const candidates = references.map((reference) => { const target = normalized(reference.municipality); const distance = levenshtein(raw, target); const abbreviation = target.startsWith(`${raw}-`) || raw.startsWith(`${target}-`); return { ...reference, distance, similarity: 1 - (distance / Math.max(raw.length, target.length)), abbreviation }; }).filter(({ distance, similarity, abbreviation }) => abbreviation || (distance <= 2 && similarity >= 0.82)).sort((left, right) => left.distance - right.distance || right.similarity - left.similarity || left.municipality.localeCompare(right.municipality));
  if (!candidates.length || (candidates[1] && candidates[0].distance === candidates[1].distance && candidates[0].similarity === candidates[1].similarity)) return null;
  const best = candidates[0]; return { candidateMunicipality: best.municipality, candidateIne: best.ine, similarity: Number(best.similarity.toFixed(3)), reason: best.abbreviation ? 'Unique municipality-name prefix/abbreviation candidate in the local ICGC reference; report-only.' : `Unique near-name candidate in the local ICGC reference (edit distance ${best.distance}); report-only.` };
}
export function classifyUnresolvedMunicipality(record, references) {
  const rawName = text(record.rawMunicipalityName); if (!rawName) return { bucket: 'MISSING_NAME', candidateMunicipality: null, candidateIne: null, reason: 'No municipality name was supplied by DIBA.' };
  const exact = references.filter(({ municipality }) => municipality.toLocaleLowerCase('ca') === rawName.toLocaleLowerCase('ca')); if (exact.length === 1) return { bucket: 'EXACT_MUNICIPALITY_NAME_CANDIDATE', candidateMunicipality: exact[0].municipality, candidateIne: exact[0].ine, reason: 'Exact municipality name in the local ICGC reference.' };
  const normalizedName = normalized(rawName); const normalizedMatches = references.filter(({ municipality }) => normalized(municipality) === normalizedName); if (normalizedMatches.length === 1) return { bucket: 'NORMALIZED_MUNICIPALITY_NAME_CANDIDATE', candidateMunicipality: normalizedMatches[0].municipality, candidateIne: normalizedMatches[0].ine, reason: 'Accent/article-normalized municipality name in the local ICGC reference.' };
  const comarcaMatches = unique(references.filter(({ comarca }) => normalized(comarca) === normalizedName).map(({ comarca }) => comarca)); if (comarcaMatches.length) return { bucket: 'COMARCA_OR_REGION', candidateMunicipality: null, candidateIne: null, reason: `Matches local comarca reference: ${comarcaMatches.join(', ')}.` };
  if (/(catalunya|comarques|xarxa|parcs|provincia|barcelona)/.test(normalizedName)) return { bucket: 'MULTI_AREA_OR_SUPRAMUNICIPAL', candidateMunicipality: null, candidateIne: null, reason: 'Broad, network, provincial or multi-area label; no municipality inferred.' };
  const typo = typoOrAbbreviationCandidate(rawName, references); if (typo) return { bucket: 'POSSIBLE_MUNICIPALITY_TYPO_OR_ABBREVIATION', ...typo };
  const locality = LOCALITY_RULES.find(({ rawName: name }) => normalized(name) === normalizedName); if (locality) return { bucket: 'LOCALITY_OR_SUBMUNICIPAL', candidateMunicipality: locality.municipality, candidateIne: locality.ine, reason: locality.reason };
  return { bucket: 'UNKNOWN_REVIEW_REQUIRED', candidateMunicipality: null, candidateIne: null, reason: 'No evidence-supported municipality, locality, comarca or broad-area classification in local reference data.' };
}

function loadState(db) {
  const plans = db.prepare('SELECT * FROM plans').all(); const allSources = db.prepare(`SELECT ps.plan_id, ps.source_record_id, ps.source_url, s.key, s.enabled FROM plan_sources ps JOIN sources s ON s.id=ps.source_id ORDER BY ps.plan_id, s.key, ps.source_record_id`).all(); const allSourcesByPlan = new Map(); for (const source of allSources) { const entries = allSourcesByPlan.get(source.plan_id) || []; entries.push(source); allSourcesByPlan.set(source.plan_id, entries); }
  const categories = db.prepare(`SELECT pc.plan_id, c.slug FROM plan_categories pc JOIN categories c ON c.id=pc.category_id`).all(); const categoriesByPlan = new Map(); for (const category of categories) { const entries = categoriesByPlan.get(category.plan_id) || []; entries.push(category.slug); categoriesByPlan.set(category.plan_id, entries); }
  const dibaRows = db.prepare(`SELECT ps.plan_id, ps.source_record_id, ps.source_url, ps.source_payload_json, s.key AS source_key, s.dataset_id, p.original_title, p.start_date, p.end_date, p.schedule_text, p.municipality, p.venue_name, p.address, p.latitude, p.longitude, p.status, p.inactive_at FROM plan_sources ps JOIN sources s ON s.id=ps.source_id JOIN plans p ON p.id=ps.plan_id WHERE s.key LIKE 'diba-%' ORDER BY s.key, ps.source_record_id`).all(); const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const dibaRecords = dibaRows.map((row) => { const payload = parsePayload(row.source_payload_json); const address = payload.grup_adreca || {}; const relation = payload.rel_municipis || {}; const profile = planProfile(plansById.get(row.plan_id), allSourcesByPlan); const sourceUrl = row.source_url || null; const title = payload.titol || row.original_title; return { sourceKey: row.source_key, dataset: row.dataset_id, sourceRecordId: String(row.source_record_id), planId: row.plan_id, title, normalizedTitle: normalized(title), startDate: dateOnly(payload.data_inici) || row.start_date, endDate: dateOnly(payload.data_fi) || row.end_date, municipality: row.municipality, normalizedMunicipality: normalized(row.municipality), venue: address.adreca_nom || row.venue_name || null, address: address.adreca || row.address || null, coordinates: coordinatePair(address.localitzacio) || (Number.isFinite(row.latitude) && Number.isFinite(row.longitude) ? { latitude: row.latitude, longitude: row.longitude } : null), matcherSourceUrl: sourceUrl, matcherCandidateUrls: [sourceUrl].filter(Boolean), secondaryPayloadUrls: unique([payload.acte_url, payload.url_general].filter((url) => url && url !== sourceUrl)), sourceUrl, session: sessionEvidence(payload, row.schedule_text), status: row.status, inactive_at: row.inactive_at, dibaOnly: profile.dibaOnly, enabledSourceKeys: profile.enabledSourceKeys, rawMunicipalityName: relation.municipi_nom || address.municipi_nom || null, rawIne: relation.ine || null, categories: categoriesByPlan.get(row.plan_id) || [] }; });
  const publicPlans = plans.map((plan) => planProfile(plan, allSourcesByPlan)).filter(({ enabledSourceKeys }) => enabledSourceKeys.length).map((plan) => ({ ...plan, planId: plan.id, title: plan.original_title, normalizedTitle: normalized(plan.original_title), startDate: plan.start_date, endDate: plan.end_date, normalizedMunicipality: normalized(plan.municipality), venue: plan.venue_name, address: plan.address, coordinates: Number.isFinite(plan.latitude) && Number.isFinite(plan.longitude) ? { latitude: plan.latitude, longitude: plan.longitude } : null, matcherCandidateUrls: unique(plan.sources.map(({ source_url: url }) => url)), secondaryPayloadUrls: [] }));
  const originalRuns = db.prepare(`SELECT ir.id AS importRunId, ir.summary_json, s.key AS sourceKey FROM import_runs ir JOIN sources s ON s.id=ir.source_id WHERE s.key LIKE 'diba-%' AND ir.status='completed' AND ir.summary_json IS NOT NULL AND ir.id IN (SELECT MIN(ir2.id) FROM import_runs ir2 JOIN sources s2 ON s2.id=ir2.source_id WHERE s2.key LIKE 'diba-%' AND ir2.status='completed' GROUP BY ir2.source_id) ORDER BY s.key`).all(); const sourceStates = db.prepare("SELECT key, enabled, allows_images FROM sources WHERE key LIKE 'diba-%' ORDER BY key").all();
  return { plansById, allSourcesByPlan, dibaRecords, publicPlans, originalRuns, sourceStates };
}
function dibaOnlyInventory(records) { const planIds = unique(records.filter(({ dibaOnly }) => dibaOnly).map(({ planId }) => planId)).sort((left, right) => left - right); const only = records.filter(({ dibaOnly }) => dibaOnly); const bySource = Object.fromEntries([...groupBy(only, ({ sourceKey: key }) => key)].map(([key, items]) => [key, new Set(items.map(({ planId }) => planId)).size])); const distribution = {}; for (const items of groupBy(only, ({ planId }) => planId).values()) distribution[items.length] = (distribution[items.length] || 0) + 1; return { count: planIds.length, planIds, sha256: createHash('sha256').update(planIds.join(','), 'utf8').digest('hex'), bySource, sourceLinkCountDistribution: distribution }; }
function markdownTable(rows, columns) { const escape = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); return [`| ${columns.map(({ label }) => label).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${columns.map(({ value }) => escape(value(row))).join(' | ')} |`)].join('\n'); }
function metricRows(prefix, metrics) { return Object.entries(metrics).filter(([, value]) => typeof value === 'number').map(([key, value]) => ({ label: `${prefix}: ${key}`, value })); }

export function renderDibaQualityAuditMarkdown(report) {
  const { activationRisk, sameFeed, historicalAmbiguities, currentPublicCandidates, unresolvedMunicipalities, dibaOnlyInventory } = report; const candidateTable = (title, findings, summary) => `## ${title}\n\n${markdownTable(findings, [{ label: 'DIBA source / acte', value: ({ sourceKey: key, sourceRecordId }) => `${key} / ${sourceRecordId}` }, { label: 'DIBA plan', value: ({ dibaPlanId }) => dibaPlanId }, { label: 'Enabled-source plan', value: ({ candidatePublicPlanId }) => candidatePublicPlanId }, { label: 'Plan state', value: ({ candidateVisibility }) => candidateVisibility.state }, { label: 'Historical overlap', value: ({ historicalOverlap }) => historicalOverlap.kind }, { label: 'Evidence', value: ({ evidence }) => evidence.reason }])}\n\n${markdownTable(metricRows(title, summary), [{ label: 'Cardinality', value: ({ label }) => label }, { label: 'Count', value: ({ value }) => value }])}`;
  return `# DIBA M1.4A.1 — Pre-activation data quality audit

Generated: ${report.generatedAt}

Database: \`${report.databasePath}\`

**Read-only analysis:** SQLite was opened read-only. This report did not run a DIBA import or dry-run, alter sources, merge plans, relink provenance, resolve geography, or change publication policy.

## Activation risk summary

**PUBLIC ACTIVATION READY: ${activationRisk.publicActivationReady ? 'YES' : 'NO'}** — analytical verdict only.

${markdownTable([{ label: 'DIBA-only plans (auditable inventory)', value: dibaOnlyInventory.count }, { label: 'Same-feed multi-plan clusters', value: sameFeed.summary.multiPlanClusters }, { label: 'Confirmed matcher pair count', value: currentPublicCandidates.confirmedSummary.pairCount }, { label: 'Possible matcher pair count', value: currentPublicCandidates.possibleSummary.pairCount }, { label: 'Historical public duplicate risks (active plan state)', value: activationRisk.historicalPublicDuplicateRisks }], [{ label: 'Metric', value: ({ label }) => label }, { label: 'Count', value: ({ value }) => value }])}

### DIBA-only denominator reproducibility

Count: ${dibaOnlyInventory.count}; sorted-ID SHA-256: \`${dibaOnlyInventory.sha256}\`. Full sorted IDs and source structure are in JSON. Counts by source: ${Object.entries(dibaOnlyInventory.bySource).map(([key, value]) => `${key}=${value}`).join(', ')}.

### DIBA source state

${markdownTable(report.sourceStates, [{ label: 'Source', value: ({ key }) => key }, { label: 'Enabled', value: ({ enabled }) => enabled }, { label: 'Allows images', value: ({ allows_images: images }) => images }])}

## A. Same-feed duplicate clusters

${markdownTable(sameFeed.clusters, [{ label: 'Source', value: ({ sourceKey: key }) => key }, { label: 'Cluster', value: ({ clusterId }) => clusterId }, { label: 'Plans', value: ({ planIds }) => planIds.join(', ') }, { label: 'Topology', value: ({ topology }) => `${topology.actualEdgeCount}/${topology.possibleEdgeCount}; clique=${topology.isClique}` }, { label: 'Session evidence', value: ({ sessionEvidence }) => `${sessionEvidence.availability}; ${sessionEvidence.comparison}` }, { label: 'Classification', value: ({ classification }) => classification }])}

\`HIGH_CONFIDENCE_DUPLICATE_CANDIDATE\` means **high priority for human review**, never safe to auto-merge. Non-clique components or conflicting session evidence are \`NEEDS_HUMAN_REVIEW\`; raw schedule/session fields remain in JSON.

## B1. First-import ambiguity history

Selected first completed import runs: ${historicalAmbiguities.firstCompletedRuns.map(({ sourceKey: key, importRunId }) => `${key}#${importRunId}`).join(', ')}.

${markdownTable(metricRows('Historical', historicalAmbiguities.summary), [{ label: 'Metric', value: ({ label }) => label }, { label: 'Count', value: ({ value }) => value }])}

${markdownTable(historicalAmbiguities.findings, [{ label: 'Source / acte', value: ({ sourceKey: key, sourceRecordId }) => `${key} / ${sourceRecordId}` }, { label: 'DIBA plan', value: ({ currentDibaPlanId }) => currentDibaPlanId }, { label: 'Historical plan', value: ({ historicalCandidatePlanId }) => historicalCandidatePlanId }, { label: 'Current state', value: ({ classification }) => classification }, { label: 'Candidate state', value: ({ candidateVisibility }) => candidateVisibility.state }])}

${candidateTable('B2A. Confirmed current matcher pairs', currentPublicCandidates.confirmed, currentPublicCandidates.confirmedSummary)}

${candidateTable('B2B. Possible current matcher pairs — needs human review', currentPublicCandidates.possible, currentPublicCandidates.possibleSummary)}

An enabled source does not guarantee a visible card. \`ENABLED_SOURCE_CURRENTLY_ACTIVE\` proves active plan state plus enabled provenance; final query visibility is context-dependent. \`ENABLED_SOURCE_INACTIVE\` remains diagnostic and is not counted as a current two-card risk.

## C. Unresolved Tourism municipalities

${markdownTable(Object.entries(unresolvedMunicipalities.summary).map(([bucket, count]) => ({ bucket, count })), [{ label: 'Bucket', value: ({ bucket }) => bucket }, { label: 'Count', value: ({ count }) => count }])}

${markdownTable(unresolvedMunicipalities.records, [{ label: 'Acte', value: ({ sourceRecordId }) => sourceRecordId }, { label: 'Raw municipality', value: ({ rawMunicipalityName }) => rawMunicipalityName }, { label: 'Bucket', value: ({ analysis }) => analysis.bucket }, { label: 'Candidate / INE', value: ({ analysis }) => analysis.candidateMunicipality ? `${analysis.candidateMunicipality} / ${analysis.candidateIne}` : '' }, { label: 'Reason', value: ({ analysis }) => analysis.reason }])}

Coordinates are supporting source data only. Neither exact nor typo/abbreviation candidates are resolved or persisted by this report.
`;
}

export async function auditDibaQuality(db, { databasePath, municipalityReferences, generatedAt = new Date().toISOString() } = {}) {
  const state = loadState(db); const dibaRecordsByKey = new Map(state.dibaRecords.map((record) => [sourceKey(record), record])); const clusters = buildSameFeedClusters(state.dibaRecords); const sameFeedSummary = summarizeSameFeedClusters(clusters); const historicalAmbiguities = reconcileHistoricalAmbiguities({ ...state, dibaRecordsByKey }); const currentPublicCandidates = scanCurrentPublicDuplicateCandidates({ dibaRecords: state.dibaRecords, publicPlans: state.publicPlans, historicalPairs: historicalAmbiguities.historicalPairs, historicalSourceRecords: historicalAmbiguities.historicalSourceRecords }); const unresolved = state.dibaRecords.filter(({ sourceKey: key, rawIne }) => key === 'diba-tourisme' && !text(rawIne)).map((record) => ({ sourceRecordId: record.sourceRecordId, title: record.title, rawMunicipalityName: record.rawMunicipalityName, rawIne: record.rawIne, coordinates: record.coordinates, startDate: record.startDate, endDate: record.endDate, planId: record.planId, categories: record.categories, sourceUrl: record.sourceUrl, analysis: classifyUnresolvedMunicipality(record, municipalityReferences) })); const municipalitySummary = Object.fromEntries(MUNICIPALITY_AUDIT_BUCKETS.map((bucket) => [bucket, 0])); for (const { analysis } of unresolved) municipalitySummary[analysis.bucket] += 1; const inventory = dibaOnlyInventory(state.dibaRecords);
  const activationRisk = { dibaOnlyPlans: inventory.count, sameFeedMultiPlanClusters: sameFeedSummary.multiPlanClusters, sameFeedDibaOnlyPlansAtRisk: sameFeedSummary.dibaOnlyPlansAtActivationRisk, historicalPublicDuplicateRisks: historicalAmbiguities.findings.filter(({ classification }) => classification === 'PUBLIC_DUPLICATE_RISK').length, historicalAmbiguitiesNeedingReview: historicalAmbiguities.findings.filter(({ classification }) => classification === 'NEEDS_HUMAN_REVIEW').length, currentConfirmedPairCount: currentPublicCandidates.confirmedSummary.pairCount, currentPossiblePairCount: currentPublicCandidates.possibleSummary.pairCount, confirmedActivePlanStateTwoCardRiskPairCount: currentPublicCandidates.confirmedSummary.activePlanStateTwoCardRiskPairCount, possibleActivePlanStateTwoCardRiskPairCount: currentPublicCandidates.possibleSummary.activePlanStateTwoCardRiskPairCount, unresolvedMunicipalities: municipalitySummary };
  activationRisk.publicActivationReady = sameFeedSummary.multiPlanClusters === 0 && activationRisk.historicalPublicDuplicateRisks === 0 && activationRisk.currentConfirmedPairCount === 0 && activationRisk.currentPossiblePairCount === 0 && activationRisk.historicalAmbiguitiesNeedingReview === 0;
  const report = { schemaVersion: 2, generatedAt, databasePath: path.resolve(databasePath || ''), readOnly: true, sourceStates: state.sourceStates, activationRisk, dibaOnlyInventory: inventory, sameFeed: { summary: sameFeedSummary, clusters }, historicalAmbiguities, currentPublicCandidates, unresolvedMunicipalities: { summary: municipalitySummary, records: unresolved } };
  return { ...report, markdown: renderDibaQualityAuditMarkdown(report) };
}
export async function runDibaQualityAudit({ databasePath, manifestPath = DEFAULT_ICGC_MANIFEST_PATH, openDatabaseImpl = openDatabase, generatedAt } = {}) { const loaded = await readAndVerifyIcgcSnapshot(manifestPath); const db = openDatabaseImpl(databasePath, { readonly: true }); try { return auditDibaQuality(db, { databasePath, municipalityReferences: municipalityReferencesFromSnapshot(loaded.snapshot), generatedAt }); } finally { db.close(); } }
