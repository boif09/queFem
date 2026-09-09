import { MultiSourceMatcher } from '../deduplication/multiSourceMatcher.js';
import { PlanRepository, canonicalJson } from '../db/repositories/plan.repository.js';
import { TicketmasterReconciliationRepository } from '../db/repositories/ticketmasterReconciliation.repository.js';
import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';
import { classifyDate, dateInCatalonia, normalizeDibaRecord } from './m0Discovery.js';
import { dibaEvidence } from './dibaQualityAudit.js';
import { deferredFinalReviewKeys, loadFinalReviewDecisions, stableKey } from './dibaFinalReviewDecisions.js';
import { loadDibaPolicyOverridesSync } from './dibaPolicyOverrides.js';

export const DIBA_FEEDS = Object.freeze([
  { dataset: 'actesturisme_ca', sourceKey: 'diba-tourisme', label: 'Turisme: agenda d’activitats' },
  { dataset: 'escenari', sourceKey: 'diba-escenari', label: 'Teatres i auditoris: agenda d’activitats' },
  { dataset: 'actesmuseus', sourceKey: 'diba-museus', label: 'Museus: agenda d’activitats' },
]);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function array(value) { return Array.isArray(value) ? value.flatMap(array) : text(value) ? [text(value)] : []; }
function code(value) {
  const valueText = text(value);
  if (!valueText || !/^\d{1,6}$/.test(valueText)) return null;
  return valueText;
}

export function dibaHorizon(now = new Date(), days = 365) {
  const today = dateInCatalonia(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return { today, horizonEnd: date.toISOString().slice(0, 10) };
}

export function municipalityIndex(snapshot) {
  const index = new Map();
  for (const { properties } of snapshot?.features || []) {
    const territory = {
      municipality: properties.NOMMUNI, comarca: properties.NOMCOMAR, province: properties.NOMPROV,
      municipalityCode: properties.CODIMUNI, comarcaCode: properties.CODICOMAR, provinceCode: properties.CODIPROV,
    };
    index.set(properties.CODIMUNI, territory);
    // DIBA uses the five-digit INE municipality relation. ICGC's municipal
    // layer uses a six-digit code whose first five digits are that same INE
    // identity. Add it only when the snapshot makes the relation unique.
    const ine = properties.CODIMUNI.slice(0, 5);
    if (!index.has(ine)) index.set(ine, territory);
    else if (index.get(ine)?.municipalityCode !== properties.CODIMUNI) index.set(ine, null);
  }
  return index;
}

function categorySlugs(dataset, item) {
  const words = normalizeForFingerprint([item.title, ...item.categories].filter(Boolean).join(' '));
  const has = (pattern) => pattern.test(words);
  if (dataset === 'actesmuseus') return ['museus'];
  if (dataset === 'escenari') {
    if (has(/(^|-)(musica|musical|concert|concerts|jazz|opera)(-|$)/)) return ['musica'];
    return ['espectacles'];
  }
  if (has(/(^|-)(gastronomia|gastronomic|enoturisme|vi|vino)(-|$)/)) return ['gastronomia'];
  if (has(/(^|-)(senderisme|excursio|excursion|caminada)(-|$)/)) return ['senderisme'];
  if (has(/(^|-)(natura|natural)(-|$)/)) return ['natura'];
  if (has(/(^|-)(fira|fires|mercat|mercats)(-|$)/)) return ['fires-mercats'];
  if (has(/(^|-)(festa|festes)(-|$)/)) return ['festes'];
  if (has(/(^|-)(museu|museus|museo)(-|$)/)) return ['museus'];
  if (has(/(^|-)(monument|patrimoni|patrimonio)(-|$)/)) return ['patrimoni'];
  return ['cultura'];
}

function sourcePayload(raw, item, feed) {
  // Keep only the official source fields useful for audit. `imatge` is retained
  // as provenance, but is never copied to plans or plan_source_images.
  return {
    dataset: feed.dataset, acte_id: item.id, id_secundari: item.secondaryId,
    titol: raw.titol ?? null, descripcio: raw.descripcio ?? null,
    data_inici: item.rawStart, data_fi: item.rawEnd,
    observacions_horari: raw.observacions_horari ?? null, durada: raw.durada ?? null, dies: raw.dies ?? null,
    rel_municipis: raw.rel_municipis ?? null, grup_adreca: raw.grup_adreca ?? null,
    acte_url: raw.acte_url ?? null, url_inscripcions: raw.url_inscripcions ?? null,
    url_general: raw.url_general ?? null, preu: raw.preu ?? null, public: raw.public ?? null,
    categoria: raw.categoria ?? null, tags: raw.tags ?? null, imatge: raw.imatge ?? null,
    _lastChange: item.lastChange,
  };
}

export function normalizeDibaImportRecord(feed, raw, { today, horizonEnd, municipalities = new Map() }) {
  const item = normalizeDibaRecord(feed.dataset, raw);
  const temporalState = classifyDate(item, { today, horizonEnd });
  const hasValidInterval = Boolean(item.startDate && item.endDate && item.endDate >= item.startDate);
  const requiredSemantics = {
    hasIdentity: Boolean(item.id), hasValidInterval, hasTitle: Boolean(item.title),
    valid: Boolean(item.id && hasValidInterval && item.title),
  };
  if (!item.id) return { state: 'invalid', reason: 'missing acte_id', item, temporalState, requiredSemantics };
  if (temporalState !== 'candidate') return { state: temporalState, reason: temporalState, item, temporalState, requiredSemantics };
  // A missing end date is deliberately rejected. M0 did not establish that this
  // field has reliable single-session semantics for these feeds.
  if (!item.endDate) return { state: 'invalid', reason: 'missing end date semantics', item, temporalState, requiredSemantics };
  if (item.endDate < item.startDate) return { state: 'invalid', reason: 'end date precedes start date', item, temporalState, requiredSemantics };
  if (!item.title) return { state: 'invalid', reason: 'missing title', item, temporalState, requiredSemantics };
  const municipality = municipalities.get(code(item.municipalityCode));
  const unresolvedMunicipality = !municipality;
  const plan = {
    kind: 'event', fingerprint: `diba|${feed.dataset}|${item.id}`, original_language: 'ca',
    original_title: item.title, original_description: item.description,
    title_ca: item.title, title_es: null, subtitle_ca: null, subtitle_es: null,
    description_ca: item.description, description_es: null,
    start_date: item.startDate, end_date: item.endDate, schedule_text: item.schedule,
    permanent: 0, price_text: item.price, is_free: /^(gratu.it|0(?:[,.]0+)?\s*(€|eur)?)/i.test(item.price || '') ? 1 : null,
    province: municipality?.province ?? null, comarca: municipality?.comarca ?? null,
    municipality: municipality?.municipality ?? null, locality: null,
    address: item.address, postal_code: item.postalCode, venue_name: item.venue,
    // grup_adreca.localitzacio is retained only when DIBA has supplied it in
    // the event-address group; shared plans are filled rather than overwritten.
    latitude: item.coordinates?.latitude ?? null, longitude: item.coordinates?.longitude ?? null,
    website_url: item.eventUrl || item.generalUrl, ticket_url: null, image_url: null, image_reuse_allowed: 0,
    family_friendly: null, indoor: null, outdoor: null, recommended_months: null,
    featured: 0, quality_score: 45, status: 'active',
  };
  return {
    state: 'candidate', item, temporalState, requiredSemantics, unresolvedMunicipality,
    candidate: {
      sourceRecordId: item.id, sourceUrl: item.eventUrl || item.generalUrl || null,
      sourceCreatedAt: null, sourceUpdatedAt: item.lastChange,
      sourcePayload: sourcePayload(raw, item, feed), plan,
      categorySlugs: categorySlugs(feed.dataset, item), occurrences: [],
    },
  };
}

function emptySummary(feed) {
  return {
    dataset: feed.dataset, sourceKey: feed.sourceKey, fetched: 0, rawRecords: 0, rawSourceRecords: 0, eligible: 0, eligibleSourceRecords: 0, invalid: 0,
    historical: 0, outside_horizon: 0, undated: 0, inserted: 0, updated: 0, unchanged: 0,
    newSourceRecordInserts: 0, existingSourceRecordUpdates: 0, updatesOfExistingSameSourceRecord: 0,
    linksToExistingPlans: 0, linksToPreExistingPlans: 0, linksToEarlierDibaPlans: 0, crossDibaLinkDetails: [], uniqueNewPublicPlans: 0,
    matchedExisting: 0, internalDibaMatches: 0, ambiguous: 0, ambiguousDetails: [],
    unresolvedMunicipalities: 0, unresolvedMunicipalityDetails: [], categories: {}, plannedRemovals: 0, intendedRemovals: 0, reconciliableExistingSourceRecords: 0, removed: 0,
    sameFeedPotentialDuplicateRecords: 0, sameFeedPotentialDuplicateClusters: [], ambiguousRecords: 0, allowMassRemovalUsed: false,
    actionableRecords: 0, actionableWithRequiredSemantics: 0,
    noOccurrencesCreated: 0, dryRun: false, catalogCommitted: false,
    safety: { status: 'pending', code: null, blockers: [] },
  };
}

function validateRegisteredSource(source) {
  if (!source || source.allows_data_reuse !== 1 || !source.license_name || !source.license_url || !source.reviewed_at) {
    throw new Error('DIBA source registration/legal review is incomplete; apply migrations before a real import.');
  }
}

export class DibaImporter {
  constructor({
    db, client, now = () => new Date(), lookaheadDays = 365, municipalities = new Map(),
    maximumRemovalRatio = 0.5, minimumHealthRatio = 0.5, postCommitCheck, beforePersist,
    insideTransaction, finalDeferredKeys = deferredFinalReviewKeys(),
    reviewedOverrides = loadDibaPolicyOverridesSync(), finalReviewDecisions = loadFinalReviewDecisions(),
  }) {
    this.db = db; this.client = client; this.now = now; this.lookaheadDays = lookaheadDays;
    this.municipalities = municipalities; this.maximumRemovalRatio = maximumRemovalRatio; this.minimumHealthRatio = minimumHealthRatio;
    this.plans = new PlanRepository(db); this.matcher = new MultiSourceMatcher(db);
    this.reconciliation = new TicketmasterReconciliationRepository(db);
    this.sourceByKey = db.prepare('SELECT * FROM sources WHERE key=?');
    this.findExistingSource = db.prepare(`SELECT id AS source_link_id, plan_id, source_payload_json, source_url
      FROM plan_sources WHERE source_id=? AND source_record_id=?`);
    this.findPlan = db.prepare('SELECT * FROM plans WHERE id=?');
    this.findPlanSources = db.prepare(`SELECT ps.source_id, ps.source_record_id, ps.source_url, s.key, s.enabled
      FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? ORDER BY s.key, ps.source_record_id`);
    this.planHasEnabledSource = db.prepare(`SELECT 1 FROM plan_sources ps JOIN sources s ON s.id=ps.source_id
      WHERE ps.plan_id=? AND s.enabled=1 LIMIT 1`);
    this.findStableIdentity = db.prepare(`SELECT ps.plan_id AS planId, p.status, s.key AS sourceKey,
      ps.source_record_id AS sourceRecordId, s.enabled
      FROM plan_sources ps JOIN sources s ON s.id=ps.source_id JOIN plans p ON p.id=ps.plan_id
      WHERE s.key=? AND ps.source_record_id=?`);
    this.postCommitCheck = postCommitCheck || (() => this.db.pragma('integrity_check', { simple: true }));
    this.beforePersist = beforePersist;
    this.insideTransaction = insideTransaction;
    this.finalDeferredKeys = finalDeferredKeys;
    this.reviewedOverrides = new Map(reviewedOverrides.decisions.map((decision) => [stableKey(decision.source), decision]));
    this.finalReviewBySource = new Map();
    for (const decision of finalReviewDecisions.decisions) for (const member of decision.sourceMembers) this.finalReviewBySource.set(stableKey(member), decision);
  }

  candidateProfile(feed, candidate) {
    const payload = candidate.sourcePayload || {};
    return {
      sourceKey: feed.sourceKey, dataset: feed.dataset, sourceRecordId: String(candidate.sourceRecordId),
      normalizedTitle: normalizeForFingerprint(candidate.plan.original_title, { removeArticles: true }),
      normalizedMunicipality: normalizeForFingerprint(candidate.plan.municipality),
      startDate: candidate.plan.start_date, endDate: candidate.plan.end_date,
      venue: candidate.plan.venue_name, address: candidate.plan.address,
      coordinates: Number.isFinite(candidate.plan.latitude) && Number.isFinite(candidate.plan.longitude)
        ? { latitude: candidate.plan.latitude, longitude: candidate.plan.longitude } : null,
      matcherSourceUrl: candidate.sourceUrl, matcherCandidateUrls: [candidate.sourceUrl].filter(Boolean),
      session: { fields: { observacionsHorari: payload.observacions_horari, durada: payload.durada, dies: payload.dies, scheduleText: candidate.plan.schedule_text } },
    };
  }

  reviewedDisposition(sourceKey, sourceRecordId) {
    const key = stableKey({ sourceKey, sourceRecordId });
    const finalDecision = this.finalReviewBySource.get(key);
    if (finalDecision) return { type: `FINAL_${finalDecision.disposition}`, key: finalDecision.sourceMembers.map(stableKey).sort().join('|'), decision: finalDecision };
    if (this.finalDeferredKeys.has(key)) return { type: 'FINAL_DEFER', key, decision: null };
    const override = this.reviewedOverrides.get(key);
    return override ? { type: `OVERRIDE_${override.decision}`, key, decision: override } : null;
  }

  resolveReviewedTarget(identity) {
    const rows = this.findStableIdentity.all(identity.sourceKey, identity.sourceRecordId);
    return rows.length === 1 ? rows[0] : null;
  }

  planContainsDeferredIdentity(plan) {
    return (plan.sourceLinks || []).some(({ sourceKey, sourceRecordId }) => {
      const disposition = this.reviewedDisposition(sourceKey, sourceRecordId);
      return disposition?.type === 'FINAL_DEFER' || disposition?.type === 'OVERRIDE_DEFER';
    });
  }

  reviewedSameFeedComponent(component) {
    const dispositions = component.map(({ sourceRecordId }) => this.reviewedDisposition(component[0].sourceKey, sourceRecordId));
    if (dispositions.some((item) => !item)) return null;
    if (dispositions.every(({ type, key }) => type.startsWith('FINAL_') && key === dispositions[0].key)) return dispositions[0];
    if (dispositions.every(({ type, decision }) => type === 'OVERRIDE_LINK_TO_EXISTING'
      && stableKey(decision.target) === stableKey(dispositions[0].decision.target))) return dispositions[0];
    if (dispositions.every(({ type }) => type === 'OVERRIDE_KEEP_SEPARATE')) return dispositions[0];
    if (dispositions.every(({ type }) => type === 'OVERRIDE_DEFER')) return dispositions[0];
    return null;
  }

  sameFeedComponents(feed, candidates) {
    const profiles = candidates.map((candidate) => this.candidateProfile(feed, candidate));
    const parent = profiles.map((_, index) => index);
    const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
    const join = (left, right) => { left = find(left); right = find(right); if (left !== right) parent[right] = left; };
    const edges = [];
    for (let left = 0; left < profiles.length; left += 1) for (let right = left + 1; right < profiles.length; right += 1) {
      const evidence = dibaEvidence(profiles[left], profiles[right]) || dibaEvidence(profiles[right], profiles[left]);
      if (evidence) { join(left, right); edges.push({ left, right, evidence }); }
    }
    const groups = new Map();
    profiles.forEach((profile, index) => { const root = find(index); const group = groups.get(root) || []; group.push(profile); groups.set(root, group); });
    return [...groups.entries()].filter(([, members]) => members.length > 1).map(([root, members]) => ({
      members,
      evidence: edges.filter(({ left, right }) => find(left) === root && find(right) === root).map(({ evidence }) => evidence),
    }));
  }

  persistedSameFeedComponent(component, entriesById) {
    const entries = component.members.map(({ sourceRecordId }) => entriesById.get(String(sourceRecordId)));
    if (entries.some((entry) => !entry || entry.existingPlanId == null || entry.disposition !== 'UNREVIEWED' || entry.suppressPublication)) return null;
    const planIds = [...new Set(entries.map(({ existingPlanId }) => String(existingPlanId)))];
    if (planIds.length !== 1) return null;
    const plan = this.overlayPlan(planIds[0]);
    if (!plan?.sourceLinks?.length) return null;
    return { status: 'EXISTING_PERSISTED_COMPONENT', planId: plan.id };
  }

  datasetSafetyPlan(feed, candidates, bounds, virtualPlans = new Map()) {
    const source = this.sourceByKey.get(feed.sourceKey);
    const blockers = [];
    const entries = [];
    const topology = [];
    const effectiveVirtualPlans = [...virtualPlans.values()];
    const planSnapshot = (plan) => plan ? ({
      id: String(plan.id), original_title: plan.original_title, start_date: plan.start_date, end_date: plan.end_date,
      municipality: plan.municipality, venue_name: plan.venue_name, address: plan.address,
      latitude: plan.latitude, longitude: plan.longitude, status: plan.status,
      sourceLinks: (plan.sourceLinks || []).map(({ sourceId, sourceKey, sourceRecordId: id, sourceUrl, enabled }) => ({ sourceId, sourceKey, sourceRecordId: id, sourceUrl, enabled })),
    }) : null;
    for (const candidate of candidates) {
      const sourceRecordId = String(candidate.sourceRecordId);
      const existingSource = source ? this.findExistingSource.get(source.id, sourceRecordId) : null;
      const existingPlan = existingSource ? this.overlayPlan(existingSource.plan_id) : null;
      const shadowedPlanIds = new Set(effectiveVirtualPlans.filter(({ overlayOrigin }) => overlayOrigin !== 'new').map(({ id }) => String(id)));
      const databaseCandidates = this.matcher.dibaCandidates(candidate.plan)
        .filter(({ id }) => String(id) !== String(existingSource?.plan_id) && !shadowedPlanIds.has(String(id)));
      const compatibleVirtualPlans = effectiveVirtualPlans.filter((virtual) => (
        String(virtual.id) !== String(existingSource?.plan_id)
        && String(virtual.municipality || '').toLocaleLowerCase('ca') === String(candidate.plan.municipality || '').toLocaleLowerCase('ca')
        && (virtual.end_date || virtual.start_date) >= candidate.plan.start_date
        && virtual.start_date <= (candidate.plan.end_date || candidate.plan.start_date)
      ));
      const analysis = this.matcher.analyzeDibaCandidates(candidate.plan, [...databaseCandidates, ...compatibleVirtualPlans], { sourceUrl: candidate.sourceUrl });
      const confirmedPlanIds = [...new Set(analysis.confirmedCandidates.map(({ id }) => String(id)))].sort();
      const possiblePlanIds = [...new Set(analysis.possible.map(({ id }) => String(id)))].sort();
      const disposition = this.reviewedDisposition(feed.sourceKey, sourceRecordId);
      let targetPlanId = null;
      let reviewedTarget = null;
      let suppressPublication = disposition?.type === 'FINAL_DEFER' || disposition?.type === 'OVERRIDE_DEFER';
      if (disposition?.type === 'OVERRIDE_LINK_TO_EXISTING') {
        const target = this.resolveReviewedTarget(disposition.decision.target);
        if (!target) blockers.push({ code: 'REVIEWED_TARGET_NOT_RESOLVED', sourceRecordIds: [sourceRecordId], target: disposition.decision.target });
        else {
          reviewedTarget = target;
          targetPlanId = target.planId;
          if (target.enabled !== 1) blockers.push({ code: 'REVIEWED_TARGET_NOT_ENABLED_PUBLIC_SOURCE', sourceRecordIds: [sourceRecordId], target: disposition.decision.target });
          const unexpected = [...confirmedPlanIds, ...possiblePlanIds].filter((planId) => planId !== String(target.planId));
          if (unexpected.length) blockers.push({ code: 'REVIEWED_COMPONENT_TOPOLOGY_CHANGED', sourceRecordIds: [sourceRecordId], unexpectedPlanIds: [...new Set(unexpected)].sort() });
          if (existingSource && existingSource.plan_id !== target.planId) blockers.push({ code: 'REVIEWED_SOURCE_LINK_CHANGED', sourceRecordIds: [sourceRecordId], expectedPlanId: target.planId, actualPlanId: existingSource.plan_id });
        }
      } else if (disposition?.type === 'FINAL_CONSOLIDATE_TO_ONE_PLAN') {
        const target = this.resolveReviewedTarget(disposition.decision.canonicalSourceIdentity);
        if (!target) blockers.push({ code: 'REVIEWED_TARGET_NOT_RESOLVED', sourceRecordIds: [sourceRecordId], target: disposition.decision.canonicalSourceIdentity });
        else {
          reviewedTarget = target;
          targetPlanId = target.planId;
          if (existingSource && existingSource.plan_id !== target.planId) blockers.push({
            code: 'REVIEWED_FINAL_SOURCE_LINK_CHANGED', sourceRecordIds: [sourceRecordId],
            canonicalSourceIdentity: disposition.decision.canonicalSourceIdentity,
            expectedPlanId: target.planId, actualPlanId: existingSource.plan_id,
          });
        }
      } else if (suppressPublication || disposition?.type === 'OVERRIDE_KEEP_SEPARATE') {
        targetPlanId = existingSource?.plan_id ?? null;
      } else {
        if (possiblePlanIds.length) blockers.push({ code: 'UNRESOLVED_CROSS_SOURCE_POSSIBLE', sourceRecordIds: [sourceRecordId], candidatePlanIds: possiblePlanIds });
        if (confirmedPlanIds.length > 1) blockers.push({ code: 'UNRESOLVED_MULTIPLE_CONFIRMED_TARGETS', sourceRecordIds: [sourceRecordId], candidatePlanIds: confirmedPlanIds });
        if (confirmedPlanIds.length === 1) {
          const target = analysis.confirmedCandidates.find(({ id }) => String(id) === confirmedPlanIds[0]);
          if (this.planContainsDeferredIdentity(target)) blockers.push({ code: 'UNKNOWN_IDENTITY_MATCHES_REVIEWED_DEFER', sourceRecordIds: [sourceRecordId], candidatePlanIds: confirmedPlanIds });
          else targetPlanId = target.id;
        }
      }
      const existingHasOtherEnabledSource = Boolean(existingPlan?.sourceLinks.some(({ sourceId, enabled }) => sourceId !== source?.id && enabled === 1));
      entries.push({ sourceRecordId, existingPlanId: existingSource?.plan_id ?? null, existingHasOtherEnabledSource, targetPlanId, suppressPublication, disposition: disposition?.type || 'UNREVIEWED', reviewedTarget, confirmedPlanIds, possiblePlanIds });
      topology.push({
        sourceRecordId, existingSource: existingSource || null, existingPlan: planSnapshot(existingPlan),
        candidates: [...databaseCandidates, ...compatibleVirtualPlans].map(planSnapshot).sort((left, right) => left.id.localeCompare(right.id)),
      });
    }
    const entriesById = new Map(entries.map((entry) => [entry.sourceRecordId, entry]));
    const sameFeed = this.sameFeedComponents(feed, candidates);
    for (const component of sameFeed) {
      const reviewed = this.reviewedSameFeedComponent(component.members);
      const persisted = reviewed ? null : this.persistedSameFeedComponent(component, entriesById);
      if (!reviewed && !persisted) blockers.push({
        code: 'UNRESOLVED_SAME_FEED_COMPONENT',
        sourceRecordIds: component.members.map(({ sourceRecordId }) => sourceRecordId).sort(),
        dispositions: component.members.map(({ sourceRecordId }) => this.reviewedDisposition(feed.sourceKey, sourceRecordId)?.type || 'UNREVIEWED'),
      });
    }
    const removalRows = source ? this.reconciliation.candidates(source.id, bounds.today, bounds.horizonEnd)
      .map(({ source_link_id: sourceLinkId, source_record_id: sourceRecordId, plan_id: planId }) => ({ sourceLinkId, sourceRecordId: String(sourceRecordId), planId }))
      .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId)) : [];
    const state = { source: source ? { id: source.id, key: source.key, enabled: source.enabled, allows_images: source.allows_images } : null, entries, topology, removalRows };
    return { entries, entriesById, blockers, sameFeed, removalRows, authorization: canonicalJson(state) };
  }

  overlayPlan(planId) {
    const plan = this.findPlan.get(planId);
    if (!plan) return null;
    return this.withSourceLinks(plan, this.findPlanSources.all(planId));
  }

  withSourceLinks(plan, sourceLinks, { virtual = false, overlayOrigin = 'pre-existing' } = {}) {
    const links = sourceLinks.map((link) => ({
      sourceId: link.source_id ?? link.sourceId, sourceRecordId: String(link.source_record_id ?? link.sourceRecordId),
      sourceUrl: link.source_url ?? link.sourceUrl ?? null, sourceKey: link.key ?? link.sourceKey,
      enabled: Number(link.enabled ?? 0),
    }));
    return {
      ...plan, virtual, overlayOrigin, sourceLinks: links,
      sourceUrls: links.map(({ sourceUrl }) => sourceUrl).filter(Boolean),
      enabledSourceKeys: links.filter(({ enabled }) => enabled === 1).map(({ sourceKey }) => sourceKey),
    };
  }

  stageDryPersistence({ candidate, source, existingSource, match, base }) {
    const sourcePayloadMatches = Boolean(existingSource && existingSource.source_payload_json === canonicalJson(candidate.sourcePayload));
    const sourceRecordKey = String(candidate.sourceRecordId);
    const sourceLink = {
      sourceId: source.id, sourceRecordId: sourceRecordKey, sourceUrl: candidate.sourceUrl,
      sourceKey: source.key, enabled: source.enabled,
    };
    const isNewPlan = !base;
    const planId = isNewPlan ? `virtual:${candidate.sourcePayload.dataset}:${sourceRecordKey}` : base.id;
    let effective = isNewPlan
      ? { ...candidate.plan, id: planId, virtual: true, overlayOrigin: 'new', sourceLinks: [] }
      : { ...base, virtual: true, overlayOrigin: base.overlayOrigin || 'pre-existing' };

    if (existingSource) {
      if (!sourcePayloadMatches || candidate.refreshCanonical) {
        if (!candidate.provenanceOnly) {
          if (candidate.preserveExistingPlan) {
            for (const [field, value] of Object.entries(candidate.plan)) {
              if (!['fingerprint', 'quality_score', 'status'].includes(field) && effective[field] == null) effective[field] = value;
            }
            if (effective.status === 'inactive' && candidate.plan.status === 'active') effective.status = 'active';
            effective.quality_score = Math.max(effective.quality_score || 0, candidate.plan.quality_score || 0);
          } else {
            effective = { ...effective, ...candidate.plan, id: planId, fingerprint: effective.fingerprint };
          }
        }
      } else if (!candidate.provenanceOnly && candidate.plan.status === 'active' && effective.status === 'inactive') {
        effective.status = 'active';
      }
    } else if (!isNewPlan && !candidate.provenanceOnly) {
      for (const [field, value] of Object.entries(candidate.plan)) {
        if (!['fingerprint', 'quality_score', 'status'].includes(field) && effective[field] == null) effective[field] = value;
      }
      if (effective.status === 'inactive' && candidate.plan.status === 'active') effective.status = 'active';
      effective.quality_score = Math.max(effective.quality_score || 0, candidate.plan.quality_score || 0);
    }

    const priorLinks = effective.sourceLinks || [];
    const shouldReplaceSourceLink = !existingSource || !sourcePayloadMatches || candidate.refreshCanonical;
    const sourceLinks = shouldReplaceSourceLink
      ? [...priorLinks.filter((link) => !(link.sourceId === source.id && link.sourceRecordId === sourceRecordKey)), sourceLink]
      : priorLinks;
    const staged = this.withSourceLinks(effective, sourceLinks, { virtual: true, overlayOrigin: effective.overlayOrigin });
    const outcome = existingSource ? (sourcePayloadMatches && !candidate.refreshCanonical ? 'skipped' : 'updated') : (isNewPlan ? 'inserted' : 'updated');
    return { staged, outcome };
  }

  async run({ dryRun = false, feeds = DIBA_FEEDS, allowMassRemoval = false } = {}) {
    const bounds = dibaHorizon(this.now(), this.lookaheadDays);
    const results = [];
    const virtualPlans = new Map();
    for (const feed of feeds) {
      try { results.push(await this.runFeed(feed, bounds, { dryRun, virtualPlans, allowMassRemoval })); }
      catch (error) {
        results.push({ ...(error.summary || { dataset: feed.dataset, sourceKey: feed.sourceKey, dryRun }), failed: true, failureCode: error.code || 'DIBA_DATASET_FAILED', error: error.message });
      }
    }
    const failures = results.filter(({ failed }) => failed);
    if (failures.length) {
      const error = new Error(`DIBA import incomplete: ${failures.map(({ dataset, error: reason }) => `${dataset} (${reason})`).join(', ')}`);
      error.results = results;
      throw error;
    }
    return { bounds, datasets: results, dryRun };
  }

  ambiguousDetail(feed, candidate, detail) {
    const { item, plan } = candidate;
    const target = detail.candidate;
    return {
      diba: {
        dataset: feed.dataset, acteId: candidate.sourceRecordId, title: item?.title || plan.original_title,
        normalizedTitle: normalizeForFingerprint(item?.title || plan.original_title, { removeArticles: true }),
        municipality: item?.municipality || null, municipalityIdentifier: item?.municipalityCode || null,
        start: plan.start_date, end: plan.end_date, venue: plan.venue_name, address: plan.address,
        url: candidate.sourceUrl, coordinates: item?.coordinates || null,
      },
      candidatePlan: {
        id: target.id, title: target.original_title, normalizedTitle: normalizeForFingerprint(target.original_title, { removeArticles: true }),
        enabledSources: target.enabledSourceKeys || [], start: target.start_date, end: target.end_date,
        municipality: target.municipality, venue: target.venue_name, address: target.address,
        urls: target.sourceUrls || [], coordinates: Number.isFinite(target.latitude) && Number.isFinite(target.longitude)
          ? { latitude: target.latitude, longitude: target.longitude } : null,
      },
      evidence: detail.evidence,
    };
  }

  async runFeed(feed, bounds, { dryRun, virtualPlans, allowMassRemoval }) {
    const summary = emptySummary(feed); summary.dryRun = dryRun; summary.allowMassRemovalUsed = allowMassRemoval;
    const source = this.sourceByKey.get(feed.sourceKey);
    let runId = null;
    if (!dryRun && source) runId = Number(this.db.prepare("INSERT INTO import_runs (source_id,started_at,status) VALUES (?,?,'running')").run(source.id, this.now().toISOString()).lastInsertRowid);
    try {
      if (!dryRun) validateRegisteredSource(source);
      const fetched = await this.client.fetchDataset(feed.dataset);
      if (!fetched.records.length) throw new Error(`DIBA ${feed.dataset} returned an empty snapshot; reconciliation refused.`);
      summary.fetched = summary.rawRecords = summary.rawSourceRecords = fetched.records.length;
      const reconciliable = source ? this.reconciliation.candidates(source.id, bounds.today, bounds.horizonEnd) : [];
      const existingIds = new Set(reconciliable.map(({ source_record_id: id }) => String(id)));
      summary.reconciliableExistingSourceRecords = existingIds.size;
      const candidates = [];
      let validIdentity = 0;
      let validDateSemantics = 0;
      let normalizedWithRequiredSemantics = 0;
      let reconciliableDateFailures = 0;
      for (const raw of fetched.records) {
        const result = normalizeDibaImportRecord(feed, raw, { ...bounds, municipalities: this.municipalities });
        const { requiredSemantics = {}, temporalState } = result;
        const hasIdentity = requiredSemantics.hasIdentity;
        const hasValidInterval = requiredSemantics.hasValidInterval;
        if (hasIdentity) validIdentity += 1;
        if (hasIdentity && hasValidInterval) validDateSemantics += 1;
        if (requiredSemantics.valid) normalizedWithRequiredSemantics += 1;
        const isReconciliableDateFailure = hasIdentity && !hasValidInterval && existingIds.has(String(result.item.id));
        if (temporalState === 'candidate' || isReconciliableDateFailure) {
          summary.actionableRecords += 1;
          if (requiredSemantics.valid) summary.actionableWithRequiredSemantics += 1;
        }
        if (isReconciliableDateFailure) reconciliableDateFailures += 1;
        if (result.state !== 'candidate') { summary[result.state] = (summary[result.state] || 0) + 1; continue; }
        summary.eligible = summary.eligibleSourceRecords += 1;
        result.candidate.item = result.item;
        if (result.unresolvedMunicipality) {
          summary.unresolvedMunicipalities += 1;
          summary.unresolvedMunicipalityDetails.push({
            dataset: feed.dataset, acteId: result.candidate.sourceRecordId, title: result.item.title,
            rawMunicipalityName: result.item.municipality, rawMunicipalityIne: result.item.municipalityCode,
            coordinates: result.item.coordinates || null,
            reason: result.item.municipalityCode ? 'INE relation is absent or not uniquely present in ICGC' : 'rel_municipis.ine is absent or empty',
          });
        }
        for (const slug of result.candidate.categorySlugs) summary.categories[slug] = (summary.categories[slug] || 0) + 1;
        candidates.push(result.candidate);
      }
      summary.normalization = {
        validIdentity, validDateSemantics, normalizedWithRequiredSemantics,
        identityRatio: fetched.records.length ? validIdentity / fetched.records.length : 0,
        dateSemanticsRatio: validIdentity ? validDateSemantics / validIdentity : 0,
        normalizationRatio: validDateSemantics ? normalizedWithRequiredSemantics / validDateSemantics : 0,
        actionableRecords: summary.actionableRecords,
        actionableWithRequiredSemantics: summary.actionableWithRequiredSemantics,
        actionableNormalizationRatio: summary.actionableRecords ? summary.actionableWithRequiredSemantics / summary.actionableRecords : 0,
        reconciliableDateFailures,
      };
      if (summary.normalization.identityRatio < this.minimumHealthRatio
        || summary.normalization.dateSemanticsRatio < this.minimumHealthRatio
        || summary.normalization.actionableNormalizationRatio < this.minimumHealthRatio) {
        throw new Error(`DIBA ${feed.dataset} parser health guard rejected identity/date/actionable-semantic ratios.`);
      }
      if (!candidates.length) throw new Error(`DIBA ${feed.dataset} produced no valid current/future records; reconciliation refused.`);
      const seenIds = new Set(candidates.map(({ sourceRecordId }) => sourceRecordId));
      summary.plannedRemovals = [...existingIds].filter((id) => !seenIds.has(id)).length;
      summary.intendedRemovals = summary.plannedRemovals;
      // Exactly 50% is permitted; only a greater-than-half removal is blocked.
      if (existingIds.size && summary.plannedRemovals / existingIds.size > this.maximumRemovalRatio && !allowMassRemoval) {
        throw new Error(`DIBA ${feed.dataset} desired-set guard rejected removal ${summary.plannedRemovals}/${existingIds.size}.`);
      }

      const safety = this.datasetSafetyPlan(feed, candidates, bounds, dryRun ? virtualPlans : new Map());
      summary.sameFeedPotentialDuplicateRecords = new Set(safety.sameFeed.flatMap(({ members }) => members.map(({ sourceRecordId }) => sourceRecordId))).size;
      summary.sameFeedPotentialDuplicateClusters = safety.sameFeed.map(({ members, evidence }) => ({
        dataset: feed.dataset, classification: 'NEEDS REVIEW',
        sourceRecordIds: members.map(({ sourceRecordId }) => sourceRecordId).sort(),
        records: members, evidence: evidence[0] || null, componentEvidence: evidence,
      }));
      summary.safety = {
        status: safety.blockers.length ? (dryRun ? 'would-reject' : 'rejected') : 'approved',
        code: safety.blockers.length ? 'UNRESOLVED_DIBA_AMBIGUITY' : null,
        blockers: safety.blockers,
      };
      if (safety.blockers.length && !dryRun) {
        const error = new Error(`DIBA ${feed.dataset} recurring safety guard rejected ${safety.blockers.length} unresolved ambiguity component(s).`);
        error.code = 'UNRESOLVED_DIBA_AMBIGUITY';
        throw error;
      }

      const stagedVirtualPlans = new Map();
      const virtualPlanForId = (id) => virtualPlans.get(String(id));

      for (const candidate of candidates) {
        const safetyEntry = safety.entriesById.get(String(candidate.sourceRecordId));
        const existingSource = source ? this.findExistingSource.get(source.id, candidate.sourceRecordId) : null;
        const effectiveVirtualPlans = [...virtualPlans.values()];
        const shadowedPlanIds = new Set(effectiveVirtualPlans.filter(({ overlayOrigin }) => overlayOrigin !== 'new').map(({ id }) => String(id)));
        const databaseCandidates = this.matcher.dibaCandidates(candidate.plan).filter(({ id }) => !shadowedPlanIds.has(String(id)));
        const compatibleVirtualPlans = dryRun ? effectiveVirtualPlans.filter((virtual) => (
          String(virtual.municipality || '').toLocaleLowerCase('ca') === String(candidate.plan.municipality || '').toLocaleLowerCase('ca')
          && (virtual.end_date || virtual.start_date) >= candidate.plan.start_date
          && virtual.start_date <= (candidate.plan.end_date || candidate.plan.start_date)
        )) : [];
        const match = this.matcher.matchDibaCandidates(candidate.plan, [...databaseCandidates, ...compatibleVirtualPlans], { sourceUrl: candidate.sourceUrl });
        const reviewedTarget = safetyEntry?.targetPlanId == null ? null
          : [...databaseCandidates, ...compatibleVirtualPlans].find(({ id }) => String(id) === String(safetyEntry.targetPlanId))
            || this.overlayPlan(safetyEntry.targetPlanId);
        if (safetyEntry?.suppressPublication) match.confirmed = null;
        else if (reviewedTarget) match.confirmed = reviewedTarget;
        if (match.possible.length) {
          summary.ambiguous += 1;
          summary.ambiguousDetails.push(...match.possibleDetails.map((detail) => this.ambiguousDetail(feed, candidate, detail)));
        }
        const virtualMatch = Boolean(match.confirmed?.virtual);
        if (match.confirmed) {
          summary.matchedExisting += 1;
          if (virtualMatch) {
            if (!existingSource && match.confirmed.overlayOrigin === 'new') {
              summary.linksToEarlierDibaPlans += 1;
              summary.crossDibaLinkDetails.push({
                dataset: feed.dataset, acteId: candidate.sourceRecordId,
                linkedToDataset: match.confirmed.dataset, linkedToActeId: match.confirmed.sourceRecordId,
                evidence: 'same M1 automatic match rule (title, municipality, interval and supporting venue/address/URL/coordinates)',
              });
            } else if (!existingSource) {
              summary.linksToExistingPlans += 1;
              if (match.confirmed.sourceLinks?.some(({ sourceKey }) => sourceKey?.startsWith('diba-'))) {
                summary.preExistingPlanWithEarlierDibaProvenance = (summary.preExistingPlanWithEarlierDibaProvenance || 0) + 1;
              }
            }
          }
          else {
            if (!existingSource) {
              summary.linksToExistingPlans += 1;
            }
            const hasDiba = this.db.prepare("SELECT 1 FROM plan_sources ps JOIN sources s ON s.id=ps.source_id WHERE ps.plan_id=? AND s.key LIKE 'diba-%'").get(match.confirmed.id);
            if (hasDiba) summary.internalDibaMatches += 1;
          }
        }
        if (existingSource) { summary.existingSourceRecordUpdates += 1; summary.updatesOfExistingSameSourceRecord += 1; }
        else summary.newSourceRecordInserts += 1;
        candidate.targetPlanId = safetyEntry?.targetPlanId ?? match.confirmed?.id;
        candidate.preserveExistingPlan = Boolean(match.confirmed) || Boolean(safetyEntry?.existingHasOtherEnabledSource);
        const targetPlanId = existingSource?.plan_id || candidate.targetPlanId;
        const targetHasEnabledSource = match.confirmed?.virtual
          ? Boolean(match.confirmed.enabledSourceKeys?.length)
          : targetPlanId && Boolean(this.planHasEnabledSource.get(targetPlanId));
        candidate.provenanceOnly = source.enabled === 0 && targetPlanId && targetHasEnabledSource;
        candidate.refreshCanonical = source.enabled === 1 && Boolean(existingSource);
        candidate.deferPublication = Boolean(safetyEntry?.suppressPublication);
        if (candidate.deferPublication) {
          candidate.plan.status = 'inactive';
          candidate.preserveExistingPlan = true;
        }
        if (dryRun) {
          const existingPlanId = existingSource?.plan_id;
          const matchedPlanId = match.confirmed?.id;
          const base = existingPlanId
            ? stagedVirtualPlans.get(String(existingPlanId)) || virtualPlanForId(existingPlanId) || this.overlayPlan(existingPlanId)
            : (matchedPlanId ? (stagedVirtualPlans.get(String(matchedPlanId))
              || (match.confirmed.virtual ? match.confirmed : this.overlayPlan(matchedPlanId))) : null);
          const preview = this.stageDryPersistence({ candidate, source, existingSource, match, base });
          summary[preview.outcome] += 1;
          if (preview.outcome === 'inserted') summary.uniqueNewPublicPlans += 1;
          stagedVirtualPlans.set(String(preview.staged.id), { ...preview.staged, dataset: feed.dataset, sourceRecordId: candidate.sourceRecordId });
          continue;
        }
        if (!existingSource && !match.confirmed) summary.uniqueNewPublicPlans += 1;
      }
      summary.ambiguousRecords = summary.ambiguous;
      summary.linksToPreExistingPlans = summary.linksToExistingPlans;
      summary.primaryDisposition = {
        eligibleSourceRecords: summary.eligibleSourceRecords,
        updatesOfExistingSameSourceRecord: summary.updatesOfExistingSameSourceRecord,
        linksToPreExistingPlans: summary.linksToPreExistingPlans,
        linksToEarlierDibaFeedPlans: summary.linksToEarlierDibaPlans,
        uniqueNewPublicPlans: summary.uniqueNewPublicPlans,
      };
      summary.primaryDisposition.total = summary.updatesOfExistingSameSourceRecord + summary.linksToPreExistingPlans
        + summary.linksToEarlierDibaPlans + summary.uniqueNewPublicPlans;
      summary.primaryDisposition.invariantHolds = summary.primaryDisposition.total === summary.eligibleSourceRecords;
      summary.noOccurrencesCreated = candidates.length;
      if (dryRun) {
        // Mirror the real feed-level transaction boundary: publish simulated
        // plans only after every record in this feed has been matched. A plan
        // has one effective representation: the latest feed replaces any
        // previous virtual state while retaining its stable plan identity.
        if (!safety.blockers.length) for (const [planId, plan] of stagedVirtualPlans) virtualPlans.set(planId, plan);
        return summary;
      }

      const startedAt = this.now().toISOString();
      this.beforePersist?.({ feed, summary, candidates });
      this.db.transaction(() => {
        const lockedSafety = this.datasetSafetyPlan(feed, candidates, bounds);
        if (lockedSafety.blockers.length || lockedSafety.authorization !== safety.authorization) {
          summary.safety = { status: 'rejected', code: 'DIBA_STALE_DATASET_AUTHORIZATION', blockers: lockedSafety.blockers };
          const error = new Error(`DIBA ${feed.dataset} database-dependent safety authorization changed before persistence.`);
          error.code = 'DIBA_STALE_DATASET_AUTHORIZATION';
          throw error;
        }
        this.insideTransaction?.({ feed, summary, candidates });
        for (const candidate of candidates) {
          const outcome = this.plans.persist({ ...candidate, sourceId: source.id, dibaOrphanFingerprintGuard: true });
          summary[outcome] += 1;
        }
        const removed = this.reconciliation.reconcile(source.id, seenIds, bounds.today, bounds.horizonEnd, { removedAt: startedAt, preservePlanStatus: source.enabled === 0 });
        summary.removed = removed.length;
      }).immediate();
      summary.catalogCommitted = true;
      const integrity = this.postCommitCheck({ feed, summary });
      if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed after ${feed.dataset}: ${integrity}`);
      this.db.prepare(`UPDATE import_runs SET finished_at=?,status='completed',fetched=?,inserted=?,updated=?,skipped=?,invalid=?,errors=0,error_message=NULL,summary_json=? WHERE id=?`)
        .run(this.now().toISOString(), summary.fetched, summary.inserted, summary.updated, summary.historical + summary.outside_horizon + summary.undated + summary.unchanged, summary.invalid, JSON.stringify(summary), runId);
      return summary;
    } catch (error) {
      if (!summary.catalogCommitted) {
        summary.inserted = 0; summary.updated = 0; summary.unchanged = 0; summary.removed = 0;
      }
      if (runId !== null) this.db.prepare(`UPDATE import_runs SET finished_at=?,status='failed',fetched=?,inserted=?,updated=?,skipped=?,invalid=?,errors=1,error_message=?,summary_json=? WHERE id=?`)
        .run(this.now().toISOString(), summary.fetched, summary.catalogCommitted ? summary.inserted : 0,
          summary.catalogCommitted ? summary.updated : 0, summary.historical + summary.outside_horizon + summary.undated + summary.unchanged,
          summary.invalid, String(error.message).slice(0, 500), JSON.stringify(summary), runId);
      error.summary = summary;
      throw error;
    }
  }
}
