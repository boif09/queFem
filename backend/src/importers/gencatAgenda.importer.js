import { createHash } from 'node:crypto';
import { BaseImporter } from './baseImporter.js';
import { canonicalJson } from '../db/repositories/plan.repository.js';
import { normalizePlan } from '../normalizers/plan.normalizer.js';
import { nullableString } from '../normalizers/text.normalizer.js';
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

function recordWithoutRestrictedImages(record) {
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

export class GencatAgendaImporter extends BaseImporter {
  constructor({
    db,
    fetchImpl = globalThis.fetch,
    pageSize = 1000,
    retentionDays = 90,
    now = () => new Date(),
    logger = console,
  }) {
    super({ db, logger });
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació de fetch.');
    this.fetchImpl = fetchImpl;
    this.pageSize = pageSize;
    this.retentionDays = retentionDays;
    this.now = now;
    this.cutoff = null;
    this.datasetUpdatedAt = null;
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
      .update(canonicalJson(recordWithoutRestrictedImages(record)))
      .digest('hex')
      .slice(0, 16);
    return `${record.codi}@${payloadHash}`;
  }

  getSourcePayload(record) {
    return recordWithoutRestrictedImages(record);
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

  shouldImport(record, normalized) {
    return isPlanRetained(normalized.plan, this.cutoff || retentionCutoff(this.retentionDays, this.now()));
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

      for (const record of records) yield record;
      if (records.length < this.pageSize) break;
      offset += records.length;
    }
  }
}
