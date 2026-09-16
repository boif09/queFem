import { createHash } from 'node:crypto';
import { BaseImporter } from './baseImporter.js';
import { canonicalJson } from '../db/repositories/plan.repository.js';
import { PlanSourceImageRepository } from '../db/repositories/planSourceImage.repository.js';
import {
  GencatImageMetadataResolver,
  gencatImageUrl,
  selectGencatImagePath,
} from '../gencat/imageMetadataResolver.js';
import { DEFAULT_GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET } from '../gencat/imagePolicy.js';
import { isOutsideCatalonia } from '../location/cataloniaScope.js';
import { normalizePlan } from '../normalizers/plan.normalizer.js';
import { nullableString } from '../normalizers/text.normalizer.js';
import {
  currentYearInCatalonia,
  temporalCoherenceIssue,
} from '../quality/temporalCoherence.js';
import { isPlanRetained, retentionCutoff } from '../retention/eventRetention.js';

export const GENCAT_DATASET_ID = 'rhpv-yr4f';
export const GENCAT_DATASET_URL = 'https://analisi.transparenciacatalunya.cat/Cultura-oci/Agenda-cultural-de-Catalunya-per-localitzacions-/rhpv-yr4f';
const GENCAT_RESOURCE_URL = `https://analisi.transparenciacatalunya.cat/resource/${GENCAT_DATASET_ID}.json`;
const GENCAT_METADATA_URL = `https://analisi.transparenciacatalunya.cat/api/views/${GENCAT_DATASET_ID}`;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseMetadataDate(unixSeconds) {
  const seconds = Number(unixSeconds);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function recordForIdentity(record) {
  const {
    imatges: _images,
    destacada_imatge: _featuredImage,
    imgapp: _appImage,
    ...allowedRecord
  } = record;

  if (typeof allowedRecord.descripcio_html === 'string') {
    allowedRecord.descripcio_html = allowedRecord.descripcio_html.replace(/<img\b[^>]*>/gi, '');
  }
  return allowedRecord;
}

function approvedSourcePayload(record) {
  const { imgapp: _appImage, ...payload } = record;
  if (typeof payload.descripcio_html === 'string') {
    payload.descripcio_html = payload.descripcio_html.replace(/<img\b[^>]*>/gi, '');
  }
  return payload;
}

function historicalImagePriority(state, cutoff) {
  if (state.status !== 'active' || state.has_enabled_source !== 1) {
    return { tier: 3, date: null };
  }

  if (state.has_enabled_occurrence_history === 1) {
    if (!state.next_active_occurrence) return { tier: 3, date: null };
    if (state.next_active_occurrence === cutoff) return { tier: 0, date: cutoff };
    if (state.next_active_occurrence > cutoff) return { tier: 1, date: state.next_active_occurrence };
    return { tier: 3, date: null };
  }

  if (state.permanent === 1) return { tier: 2, date: null };
  const effectiveEndDate = state.end_date || state.start_date;
  if (!effectiveEndDate || effectiveEndDate < cutoff) return { tier: 3, date: null };
  if (state.start_date && state.start_date > cutoff) return { tier: 1, date: state.start_date };
  return { tier: 0, date: cutoff };
}

const FAIRNESS_WEIGHTS = Object.freeze({ high: 8, permanent: 1, historical: 1 });
const FAIRNESS_GROUPS = Object.freeze(['high', 'permanent', 'historical']);

function proportionalSlots(capacity, groups) {
  if (capacity <= 0 || groups.length === 0) return new Map();
  const totalWeight = groups.reduce((total, group) => total + FAIRNESS_WEIGHTS[group], 0);
  const slots = new Map(groups.map((group) => [group, Math.floor((capacity * FAIRNESS_WEIGHTS[group]) / totalWeight)]));
  let remaining = capacity - [...slots.values()].reduce((total, count) => total + count, 0);
  const byRemainder = [...groups].sort((left, right) => {
    const leftRemainder = (capacity * FAIRNESS_WEIGHTS[left]) % totalWeight;
    const rightRemainder = (capacity * FAIRNESS_WEIGHTS[right]) % totalWeight;
    return rightRemainder - leftRemainder || FAIRNESS_GROUPS.indexOf(left) - FAIRNESS_GROUPS.indexOf(right);
  });
  for (let index = 0; remaining > 0; index = (index + 1) % byRemainder.length) {
    const group = byRemainder[index];
    slots.set(group, slots.get(group) + 1);
    remaining -= 1;
  }
  return slots;
}

export function selectFairHistoricalImageCandidates(candidates, budget) {
  if (budget === 0 || candidates.length === 0) return [];
  const queues = {
    high: candidates.filter(({ priority }) => priority.tier <= 1),
    permanent: candidates.filter(({ priority }) => priority.tier === 2),
    historical: candidates.filter(({ priority }) => priority.tier === 3),
  };
  const offsets = new Map(FAIRNESS_GROUPS.map((group) => [group, 0]));
  const selected = [];
  let remaining = budget;

  while (remaining > 0) {
    const available = FAIRNESS_GROUPS.filter((group) => offsets.get(group) < queues[group].length);
    if (available.length === 0) break;
    const slots = proportionalSlots(remaining, available);
    let claimed = 0;
    for (const group of available) {
      const count = Math.min(slots.get(group), queues[group].length - offsets.get(group));
      if (count === 0) continue;
      selected.push(...queues[group].slice(offsets.get(group), offsets.get(group) + count));
      offsets.set(group, offsets.get(group) + count);
      claimed += count;
    }
    remaining -= claimed;
  }
  return selected;
}

export class GencatAgendaImporter extends BaseImporter {
  constructor({
    db,
    fetchImpl = globalThis.fetch,
    pageSize = 1000,
    retentionDays = 0,
    now = () => new Date(),
    logger = console,
    imagesEnabled = true,
    imageMetadataResolver,
    imageMetadataRetryHours = 24,
    historicalImageResolutionBudget = DEFAULT_GENCAT_HISTORICAL_IMAGE_RESOLUTION_BUDGET,
  }) {
    super({ db, logger });
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    this.fetchImpl = fetchImpl;
    this.pageSize = pageSize;
    this.retentionDays = retentionDays;
    this.now = now;
    this.cutoff = null;
    this.datasetUpdatedAt = null;
    this.imagesEnabled = imagesEnabled;
    this.imageMetadataResolver = imageMetadataResolver || new GencatImageMetadataResolver({ fetchImpl });
    this.imageMetadataRetryMs = imageMetadataRetryHours * 60 * 60 * 1000;
    if (!Number.isSafeInteger(historicalImageResolutionBudget) || historicalImageResolutionBudget < 0) {
      throw new TypeError('El pressupost de resolució històrica Gencat no és vàlid.');
    }
    this.historicalImageResolutionBudget = historicalImageResolutionBudget;
    this.historicalImageResolutions = 0;
    this.deferredHistoricalImageResolutions = 0;
    this.sourceImages = new PlanSourceImageRepository(db);
  }

  async run() {
    this.historicalImageResolutions = 0;
    this.deferredHistoricalImageResolutions = 0;
    return super.run();
  }

  isHistoricalResolutionCandidate(record, sourceRecordId, state) {
    if (!state) return false;
    const imagePath = selectGencatImagePath(record.imatges);
    if (!imagePath) return false;
    const url = gencatImageUrl(imagePath);
    if (state.image_url && state.image_url !== url) return false;
    if (state.attribution_known === 1) return false;
    if (state.image_url && state.attribution_known === 0) {
      const checkedAt = Date.parse(state.image_updated_at);
      if (Number.isFinite(checkedAt) && this.now().getTime() - checkedAt < this.imageMetadataRetryMs) {
        return false;
      }
    }
    return Boolean(sourceRecordId);
  }

  prioritizeHistoricalImageRecords(records) {
    if (!this.imagesEnabled) return records;
    const source = this.sources.requireApproved(this.getSourceId());
    if (source.allows_images !== 1) return records;

    const identified = records.map((record, originalIndex) => {
      try {
        return { record, originalIndex, sourceRecordId: this.getExternalId(record) };
      } catch {
        // Preserve BaseImporter's per-record error reporting for malformed rows.
        return { record, originalIndex, sourceRecordId: null };
      }
    });
    const states = this.sourceImages.findGencatHistoricalImageStates(
      source.id,
      identified.flatMap(({ sourceRecordId }) => sourceRecordId ? [sourceRecordId] : []),
      this.cutoff,
    );
    const candidates = [];
    const ordinary = [];
    for (const item of identified) {
      const state = item.sourceRecordId ? states.get(item.sourceRecordId) : null;
      if (!this.isHistoricalResolutionCandidate(item.record, item.sourceRecordId, state)) {
        ordinary.push(item);
        continue;
      }
      candidates.push({ ...item, priority: historicalImagePriority(state, this.cutoff) });
    }
    candidates.sort((left, right) => (
      left.priority.tier - right.priority.tier
      || String(left.priority.date || '').localeCompare(String(right.priority.date || ''))
      || left.originalIndex - right.originalIndex
    ));
    const selected = selectFairHistoricalImageCandidates(candidates, this.historicalImageResolutionBudget);
    const selectedSet = new Set(selected);
    return [...ordinary, ...selected, ...candidates.filter((item) => !selectedSet.has(item))]
      .map(({ record }) => record);
  }

  imageMetadataSummary() {
    return {
      historicalResolutionBudget: this.historicalImageResolutionBudget,
      historicalResolutions: this.historicalImageResolutions,
      deferredHistoricalResolutions: this.deferredHistoricalImageResolutions,
    };
  }

  getSourceId() {
    return 'gencat-agenda';
  }

  normalize(record) {
    return normalizePlan(record);
  }

  getExternalId(record) {
    if (!record.codi) throw new Error('El registre no conté el camp oficial codi.');
    // The dataset has no unique row identifier and can contain different payloads
    // for the same activity and location. An immutable payload identity preserves
    // every distinct official variant instead of overwriting one of them.
    const payloadHash = createHash('sha256')
      .update(canonicalJson(recordForIdentity(record)))
      .digest('hex')
      .slice(0, 16);
    return `${record.codi}@${payloadHash}`;
  }

  getSourcePayload(record) {
    return approvedSourcePayload(record);
  }

  async prepareRecord(record, normalized, source, sourceRecordId) {
    if (!this.imagesEnabled || source.allows_images !== 1) return null;
    const imagePath = selectGencatImagePath(record.imatges);
    if (!imagePath) return { action: 'remove' };
    const url = gencatImageUrl(imagePath);
    const priorSourceRecord = this.plans.getSourceRecord(source.id, sourceRecordId);
    const existing = this.sourceImages.findResolutionBySourceRecord(source.id, sourceRecordId);
    if (existing && existing.url === url) {
      if (existing.attribution_known === 1) return null;
      const checkedAt = Date.parse(existing.updated_at);
      if (Number.isFinite(checkedAt) && this.now().getTime() - checkedAt < this.imageMetadataRetryMs) return null;
    }
    const historicalResolution = Boolean(priorSourceRecord) && (!existing || existing.url === url);
    if (historicalResolution) {
      if (this.historicalImageResolutions >= this.historicalImageResolutionBudget) {
        this.deferredHistoricalImageResolutions += 1;
        return { action: 'defer' };
      }
      this.historicalImageResolutions += 1;
    }
    const metadata = await this.imageMetadataResolver.resolve({ codi: record.codi, imagePath });
    const selection = {
      url,
      ratio: 'unknown',
      width: 1,
      height: 1,
      isFallback: false,
      attribution: metadata.attribution,
      attributionKnown: metadata.attributionKnown,
    };
    return {
      action: 'persist',
      selections: { card: selection, detail: selection },
    };
  }

  async afterPersist(record, normalized, source, sourceRecordId, outcome, prepared) {
    if (!prepared || prepared.action === 'defer') return;
    const sourceRecord = this.plans.getSourceRecord(source.id, sourceRecordId);
    if (!sourceRecord) throw new Error('No s’ha trobat la procedència Gencat acabada de persistir.');
    this.sourceImages.persistSelections(
      sourceRecord.id,
      prepared.action === 'persist' ? prepared.selections : {},
      this.now().toISOString(),
    );
  }

  getSourceUrl(record) {
    return nullableString(record.urlactivitat) || GENCAT_DATASET_URL;
  }

  getSourceCreatedAt(record) {
    return nullableString(record.data_creacio);
  }

  getSourceUpdatedAt() {
    return this.datasetUpdatedAt;
  }

  getInvalidIssue(record, normalized) {
    return temporalCoherenceIssue(normalized.plan, {
      currentYear: currentYearInCatalonia(this.now()),
    });
  }

  describeInvalidRecord(record, normalized, issue) {
    return {
      source_record_id: String(record.codi),
      title: normalized.plan.original_title,
      reason: issue.code,
      message: issue.message,
      start_date: normalized.plan.start_date,
      end_date: normalized.plan.end_date,
    };
  }

  shouldImport(record, normalized) {
    const cutoff = this.cutoff || retentionCutoff(this.retentionDays, this.now());
    return isPlanRetained(normalized.plan, cutoff) && !isOutsideCatalonia(normalized.plan);
  }

  async requestJson(url) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await this.fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Resposta HTTP ${response.status} de la font oficial.`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt < 3) await wait(500 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async *fetch() {
    const metadata = await this.requestJson(GENCAT_METADATA_URL);
    if (metadata.id !== GENCAT_DATASET_ID || !Array.isArray(metadata.columns)) {
      throw new Error('Els metadades de la font oficial no tenen l’estructura esperada.');
    }
    this.datasetUpdatedAt = parseMetadataDate(metadata.rowsUpdatedAt);
    this.cutoff = retentionCutoff(this.retentionDays, this.now());
    const cutoffDateTime = `${this.cutoff}T00:00:00.000`;
    const currentRecordsWhere = [
      `data_fi >= '${cutoffDateTime}'`,
      `(data_fi IS NULL AND data_inici >= '${cutoffDateTime}')`,
      "permanent = 'Sí'",
    ].join(' OR ');

    const allRecords = [];
    let offset = 0;
    while (true) {
      const url = new URL(GENCAT_RESOURCE_URL);
      url.searchParams.set('$limit', String(this.pageSize));
      url.searchParams.set('$offset', String(offset));
      url.searchParams.set('$order', 'codi,espai,adre_a,latitud,longitud');
      url.searchParams.set('$where', currentRecordsWhere);
      const records = await this.requestJson(url);
      if (!Array.isArray(records)) {
        throw new Error('La resposta de dades de la font oficial no és una llista.');
      }

      allRecords.push(...records);
      if (records.length < this.pageSize) break;
      offset += records.length;
    }
    yield* this.prioritizeHistoricalImageRecords(allRecords);
  }
}
