import { normalizeForFingerprint, stripHtml } from '../normalizers/text.normalizer.js';

export const PRIMARY_DATASETS = [
  'actesturisme_ca', 'escenari', 'actesmuseus', 'actesbiblioteques_ca', 'agendageneral_ca', 'exposicions',
];

const API_ORIGIN = 'https://do.diba.cat/api/';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function values(value) {
  if (Array.isArray(value)) return value.flatMap(values).filter(Boolean);
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return [];
}

function dateOnly(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== match[1] ? null : match[1];
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function dateInCatalonia(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function parseCoordinates(value) {
  const match = text(value).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function firstUrl(...fields) {
  for (const field of fields) {
    const value = values(field).find((candidate) => /^https:\/\//i.test(candidate));
    if (value) return value;
  }
  return null;
}

function normalized(value) {
  return normalizeForFingerprint(value, { removeArticles: true });
}

function overlap(a, b) {
  if (!a.startDate || !b.startDate) return false;
  const aEnd = a.endDate || a.startDate;
  const bEnd = b.endDate || b.startDate;
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

function daysApart(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function similarity(a, b) {
  const left = new Set(normalized(a).split('-').filter(Boolean));
  const right = new Set(normalized(b).split('-').filter(Boolean));
  if (!left.size || !right.size) return 0;
  const common = [...left].filter((token) => right.has(token)).length;
  return common / new Set([...left, ...right]).size;
}

function unionFind(length) {
  const parent = Array.from({ length }, (_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  return { find, join(a, b) { const left = find(a); const right = find(b); if (left !== right) parent[right] = left; } };
}

export function normalizeDibaRecord(dataset, record) {
  const address = record.grup_adreca || {};
  const municipalityRelation = record.rel_municipis || {};
  const municipality = text(municipalityRelation.municipi_nom) || text(address.municipi_nom) || text(record.municipi_nom) || null;
  const startDate = dateOnly(record.data_inici);
  const endDate = dateOnly(record.data_fi);
  const rawStart = text(record.data_inici);
  const rawEnd = text(record.data_fi);
  const coordinates = parseCoordinates(address.localitzacio || record.localitzacio);
  const title = text(record.titol) || null;
  return {
    dataset,
    id: text(record.acte_id) || null,
    secondaryId: text(record.id_secundari) || null,
    title,
    normalizedTitle: normalized(title),
    description: stripHtml(record.descripcio) || null,
    startDate,
    endDate,
    rawStart,
    rawEnd,
    municipality,
    normalizedMunicipality: normalized(municipality),
    municipalityCode: text(municipalityRelation.ine) || null,
    comarca: text(municipalityRelation.grup_comarca?.comarca_nom) || values(record.rel_comarca)[0] || null,
    venue: text(address.adreca_nom) || null,
    address: text(address.adreca) || null,
    postalCode: text(address.codi_postal) || null,
    coordinates,
    eventUrl: firstUrl(record.acte_url),
    registrationUrl: firstUrl(record.url_inscripcions, record.inscripcio),
    generalUrl: firstUrl(record.url_general),
    imageUrl: firstUrl(record.imatge),
    imageDomain: (() => { try { return new URL(firstUrl(record.imatge)).hostname; } catch { return null; } })(),
    price: text(record.preu) || null,
    categories: [...values(record.categoria), ...values(record.tags)],
    audience: values(record.public),
    lastChange: text(record._lastChange) || null,
    schedule: text(record.observacions_horari) || text(record.durada) || text(record.dies) || null,
  };
}

export function classifyDate(record, { today, horizonEnd }) {
  const invalid = (record.rawStart && !record.startDate) || (record.rawEnd && !record.endDate);
  if (invalid) return 'invalid';
  if (!record.startDate) return 'undated';
  const end = record.endDate || record.startDate;
  if (end < today) return 'historical';
  if (record.startDate > horizonEnd) return 'outside_horizon';
  return 'candidate';
}

async function pause(milliseconds) {
  if (milliseconds) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class DibaApiClient {
  constructor({ fetchImpl = globalThis.fetch, pageSize = 1000, timeoutMs = 30_000, retries = 3, delayMs = 100 } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Cal una implementació fetch per a DIBA.');
    this.fetchImpl = fetchImpl;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.delayMs = delayMs;
  }

  url(path) {
    return new URL(path, API_ORIGIN);
  }

  async request(path) {
    let lastError;
    for (let attempt = 1; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const started = performance.now();
        const response = await this.fetchImpl(this.url(path), { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`DIBA ha respost HTTP ${response.status} per ${path}.`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.elements)) throw new Error(`DIBA ha retornat una pàgina invàlida per ${path}.`);
        return { payload, milliseconds: Math.round(performance.now() - started), cacheControl: response.headers.get('cache-control') };
      } catch (error) {
        const transient = error.name === 'AbortError' || error.retryable || error instanceof TypeError;
        if (!transient || attempt === this.retries) {
          if (error.name === 'AbortError') throw new Error(`DIBA no ha respost dins del temps límit per ${path}.`);
          throw error;
        }
        lastError = error;
        await pause(250 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async listDatasets() {
    const response = await this.fetchImpl(this.url('info/datasets'), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`DIBA ha respost HTTP ${response.status} en l'inventari.`);
    const payload = await response.json();
    const datasets = Array.isArray(payload) ? payload : Object.values(payload).filter((item) => item && typeof item === 'object' && typeof item.machinename === 'string');
    if (!datasets.length) throw new Error('DIBA ha retornat un inventari invàlid.');
    return datasets;
  }

  async fetchDataset(dataset) {
    const records = [];
    const ids = new Set();
    const pageStats = [];
    let metadata = null;
    let expected = null;
    for (let start = 1; expected === null || start <= expected; start += this.pageSize) {
      const end = start + this.pageSize - 1;
      const result = await this.request(`dataset/${encodeURIComponent(dataset)}/pag-ini/${start}/pag-fi/${end}`);
      const { payload } = result;
      if (!metadata) {
        metadata = payload;
        expected = Number(payload.entitats);
        if (!Number.isInteger(expected) || expected < 0) throw new Error(`DIBA no ha indicat entitats vàlides per ${dataset}.`);
      }
      if (Number(payload.entitats) !== expected) throw new Error(`DIBA ha canviat el total durant la paginació de ${dataset}; torna a executar el dry-run.`);
      if (payload.elements.length === 0 && records.length < expected) throw new Error(`DIBA ha truncat la paginació de ${dataset} abans de ${expected} registres.`);
      for (const record of payload.elements) {
        const id = text(record.acte_id);
        if (!id) throw new Error(`DIBA ha retornat un acte sense acte_id a ${dataset}.`);
        if (ids.has(id)) throw new Error(`DIBA ha repetit l'acte ${id} durant la paginació de ${dataset}.`);
        ids.add(id);
        records.push(record);
      }
      pageStats.push({ start, end, received: payload.elements.length, milliseconds: result.milliseconds, cacheControl: result.cacheControl });
      if (records.length >= expected) break;
      await pause(this.delayMs);
    }
    if (records.length !== expected) throw new Error(`DIBA ha retornat ${records.length}/${expected} registres per ${dataset}; anàlisi incompleta.`);
    return { metadata, records, pageStats };
  }
}

export function clusterDibaCandidates(candidates) {
  const union = unionFind(candidates.length);
  const evidence = new Map();
  const add = (left, right, confidence) => {
    if (candidates[left].dataset === candidates[right].dataset) return;
    union.join(left, right);
    evidence.set(`${Math.min(left, right)}:${Math.max(left, right)}`, confidence);
  };
  const byKey = new Map();
  for (const [index, item] of candidates.entries()) {
    const keys = [];
    if (item.eventUrl) keys.push(`url:${item.eventUrl}`);
    if (item.secondaryId) keys.push(`secondary:${item.secondaryId}`);
    if (item.normalizedTitle && item.normalizedMunicipality) keys.push(`title-municipality:${item.normalizedTitle}:${item.normalizedMunicipality}`);
    for (const key of keys) {
      const prior = byKey.get(key) || [];
      for (const other of prior) {
        const peer = candidates[other];
        if (key.startsWith('url:') || key.startsWith('secondary:')) add(index, other, 'high');
        else if (overlap(item, peer)) add(index, other, 'high');
        else if (daysApart(item.startDate, peer.startDate) <= 3) add(index, other, 'probable');
      }
      prior.push(index);
      byKey.set(key, prior);
    }
  }
  const grouped = new Map();
  for (const index of candidates.keys()) {
    const root = union.find(index);
    const group = grouped.get(root) || [];
    group.push(index);
    grouped.set(root, group);
  }
  const clusters = [...grouped.values()].map((indices, clusterIndex) => {
    const members = indices.map((index) => candidates[index]);
    const confidences = indices.flatMap((left) => indices.map((right) => evidence.get(`${Math.min(left, right)}:${Math.max(left, right)}`)).filter(Boolean));
    const confidence = confidences.includes('high') ? 'high' : confidences.includes('probable') ? 'probable' : null;
    return { id: `diba-${clusterIndex + 1}`, confidence, members };
  });
  return clusters.sort((a, b) => a.members[0].dataset.localeCompare(b.members[0].dataset) || a.members[0].id.localeCompare(b.members[0].id));
}

export function matchDibaToLocal(clusters, localPlans) {
  const results = [];
  for (const cluster of clusters) {
    const candidate = cluster.members[0];
    let level = 'none';
    const rank = { high: 0, probable: 1, possible: 2, none: 3 };
    const matches = [];
    for (const plan of localPlans) {
      const sameMunicipality = candidate.normalizedMunicipality && candidate.normalizedMunicipality === normalized(plan.municipality);
      const sameTitle = candidate.normalizedTitle && candidate.normalizedTitle === normalized(plan.title);
      const dateOverlap = overlap(candidate, plan);
      const urlMatch = candidate.eventUrl && plan.urls.includes(candidate.eventUrl);
      const venueMatch = candidate.venue && normalized(candidate.venue) === normalized(plan.venue);
      let confidence = null;
      if ((sameTitle && sameMunicipality && dateOverlap) || (urlMatch && (sameTitle || dateOverlap))) confidence = 'high';
      else if (sameMunicipality && dateOverlap && similarity(candidate.title, plan.title) >= 0.75) confidence = 'probable';
      else if (sameMunicipality && daysApart(candidate.startDate, plan.startDate) <= 3 && similarity(candidate.title, plan.title) >= 0.55) confidence = 'possible';
      if (confidence) {
        matches.push({ id: plan.id, title: plan.title, municipality: plan.municipality, sources: plan.sources, confidence, venueMatch });
        if (rank[confidence] < rank[level]) level = confidence;
      }
    }
    results.push({ clusterId: cluster.id, level, matches: matches.filter((match) => match.confidence === level) });
  }
  return results;
}

export function localBaselineWarning() {
  return 'El solapamiento se calcula exclusivamente contra esta SQLite local de solo lectura; su completitud respecto a producción es desconocida.';
}

export function summarizeDataset(dataset, records, { today, horizonEnd }) {
  const candidates = [];
  const counts = { total: records.length, candidate: 0, historical: 0, outside_horizon: 0, invalid: 0, undated: 0 };
  for (const record of records) {
    const normalizedRecord = normalizeDibaRecord(dataset, record);
    const state = classifyDate(normalizedRecord, { today, horizonEnd });
    counts[state] += 1;
    if (state === 'candidate') candidates.push(normalizedRecord);
  }
  const fields = ['title', 'description', 'municipality', 'municipalityCode', 'comarca', 'coordinates', 'venue', 'address', 'eventUrl', 'registrationUrl', 'price', 'imageUrl', 'categories', 'lastChange'];
  const quality = Object.fromEntries(fields.map((field) => [field, candidates.filter((item) => Array.isArray(item[field]) ? item[field].length : Boolean(item[field])).length]));
  const municipalities = new Map();
  const categories = new Map();
  const imageDomains = new Map();
  const ranges = { single_day: 0, two_to_seven_days: 0, eight_to_thirtyone_days: 0, over_thirtyone_days: 0, no_end_date: 0 };
  for (const item of candidates) {
    if (item.municipality) municipalities.set(item.municipality, (municipalities.get(item.municipality) || 0) + 1);
    for (const category of item.categories) categories.set(category, (categories.get(category) || 0) + 1);
    if (item.imageDomain) imageDomains.set(item.imageDomain, (imageDomains.get(item.imageDomain) || 0) + 1);
    if (!item.endDate) ranges.no_end_date += 1;
    else {
      const days = daysApart(item.startDate, item.endDate);
      if (days === 0) ranges.single_day += 1;
      else if (days <= 6) ranges.two_to_seven_days += 1;
      else if (days <= 30) ranges.eight_to_thirtyone_days += 1;
      else ranges.over_thirtyone_days += 1;
    }
  }
  return {
    counts, candidates, quality, distinctMunicipalities: municipalities.size,
    topMunicipalities: [...municipalities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10),
    topCategories: [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15),
    imageDomains: [...imageDomains.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), ranges,
  };
}
