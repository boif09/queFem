import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIRECTORY, '../../..');
export const DEFAULT_FALLBACK_ARCHIVE_PATH = path.join(PROJECT_ROOT, 'tenspla_pexels_fallback_library_v1.zip');
export const DEFAULT_FALLBACK_ASSET_ROOT = path.join(PROJECT_ROOT, 'frontend/public/media/fallbacks');

export const CATEGORY_POOL_BY_PLAN_CATEGORY = Object.freeze({
  festes: 'festes',
  musica: 'musica',
  'fires-mercats': 'fires-mercats',
  gastronomia: 'gastronomia',
  familia: 'familia',
  espectacles: 'espectacles',
  cultura: 'cultura',
  museus: 'museus',
  patrimoni: 'patrimoni',
  natura: 'natura',
  senderisme: 'natura',
  muntanya: 'natura',
  platges: 'natura',
  bicicleta: 'natura',
  miradors: 'natura',
  'parcs-jardins': 'natura',
  monuments: 'patrimoni',
  pobles: 'patrimoni',
});

const REQUIRED_ITEM_FIELDS = [
  'id', 'local_filename', 'category', 'subtype', 'pexels_photo_id', 'source_page',
  'photographer', 'source_title', 'license', 'license_url', 'selected_at', 'alt_ca', 'alt_es',
  'detail_disclosure_ca', 'detail_disclosure_es',
];

function assert(condition, message) {
  if (!condition) throw new Error(`Manifest d'imatges genèriques invàlid: ${message}`);
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function stableHash(value) {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(String(value || ''));
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function readZipEntries(archivePath) {
  const archive = fs.readFileSync(archivePath);
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(end >= 0, 'no s’ha trobat el directori ZIP final');
  const entryCount = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert(archive.readUInt32LE(cursor) === 0x02014b50, 'directori ZIP corrupte');
    const compression = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert(archive.readUInt32LE(localOffset) === 0x04034b50, `entrada ZIP invàlida: ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    assert(compression === 0 || compression === 8, `compressió ZIP no admesa: ${name}`);
    entries.set(name, compression === 8 ? zlib.inflateRawSync(data) : data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryByBasename(entries, basename) {
  const entry = [...entries.entries()].find(([name]) => name.endsWith(`/${basename}`) || name === basename);
  assert(entry, `falta ${basename} al paquet`);
  return JSON.parse(entry[1].toString('utf8'));
}

export function validateFallbackManifest(manifest, guidance) {
  assert(manifest?.schema_version === 1, 'schema_version ha de ser 1');
  assert(manifest.count === 100 && Array.isArray(manifest.items) && manifest.items.length === 100, 'calen exactament 100 registres');
  assert(guidance?.version === 1, 'resolver-guidance.json ha de ser versió 1');
  const expectedCategories = Object.keys(guidance.category_order.reduce((result, category) => ({ ...result, [category]: 10 }), {}));
  assert(expectedCategories.length === 10 && guidance.fallback_category === 'cultura', 'categories de resolució incorrectes');
  assert(Object.keys(manifest.categories || {}).length === 10, 'calen les deu categories de la llibreria');
  const ids = new Set();
  const filenames = new Set();
  const perCategory = new Map(expectedCategories.map((category) => [category, 0]));
  for (const item of manifest.items) {
    for (const field of REQUIRED_ITEM_FIELDS) assert(item[field] !== undefined && item[field] !== '', `falta ${field} a un registre`);
    assert(!ids.has(item.id), `ID duplicat: ${item.id}`);
    assert(!filenames.has(item.local_filename), `fitxer local duplicat: ${item.local_filename}`);
    assert(perCategory.has(item.category), `categoria desconeguda: ${item.category}`);
    assert(item.source === 'pexels', `font incorrecta per ${item.id}`);
    assert(Number.isInteger(item.pexels_photo_id), `Pexels Photo ID invàlid per ${item.id}`);
    assert(item.source_page.startsWith('https://www.pexels.com/'), `pàgina de procedència invàlida per ${item.id}`);
    assert(item.license_url === manifest.source_license_url, `URL de llicència invàlida per ${item.id}`);
    assert(item.generic_only === true && item.event_specific === false && item.jsonld_event_image_eligible === false, `política d’ús invàlida per ${item.id}`);
    assert(!item.local_filename.startsWith('/') && !item.local_filename.includes('..') && item.local_filename.endsWith('.webp'), `nom local invàlid per ${item.id}`);
    ids.add(item.id);
    filenames.add(item.local_filename);
    perCategory.set(item.category, perCategory.get(item.category) + 1);
  }
  for (const category of expectedCategories) {
    assert(manifest.categories[category] === 10 && perCategory.get(category) === 10, `calen 10 imatges a ${category}`);
  }
  return true;
}

function resolveCategory(plan, guidance) {
  const categories = plan.categories || [];
  for (const category of categories) {
    const slug = typeof category === 'string' ? category : category?.slug;
    if (CATEGORY_POOL_BY_PLAN_CATEGORY[slug]) return CATEGORY_POOL_BY_PLAN_CATEGORY[slug];
  }
  const text = normalizeText([plan.title, plan.description, plan.original_title, plan.original_description].filter(Boolean).join(' '));
  for (const category of guidance.category_order) {
    if ((guidance.keyword_hints?.[category] || []).some((hint) => text.includes(normalizeText(hint)))) return category;
  }
  if (plan.family === true || plan.family_friendly === true) return 'familia';
  if (plan.outdoor === true || plan.outdoor === 1) return 'natura';
  return guidance.fallback_category;
}

export class FallbackImageLibrary {
  constructor({ manifest, guidance, assetRoot = DEFAULT_FALLBACK_ASSET_ROOT, assetExists } = {}) {
    validateFallbackManifest(manifest, guidance);
    this.manifest = manifest;
    this.guidance = guidance;
    this.assetRoot = assetRoot;
    this.byCategory = new Map(guidance.category_order.map((category) => [category, []]));
    for (const item of manifest.items) this.byCategory.get(item.category).push(Object.freeze({ ...item }));
    this.availableAssets = new Map();
    for (const item of manifest.items) {
      const detail = path.join(assetRoot, item.local_filename);
      const card = path.join(assetRoot, 'card', item.local_filename);
      this.availableAssets.set(item.id, {
        detail: assetExists ? Boolean(assetExists(detail, 'detail', item)) : fs.existsSync(detail),
        card: assetExists ? Boolean(assetExists(card, 'card', item)) : fs.existsSync(card),
      });
    }
  }

  get items() {
    return this.manifest.items.map((item) => ({ ...item }));
  }

  get assetCount() {
    return [...this.availableAssets.values()].filter(({ detail, card }) => detail && card).length;
  }

  resolve(plan, { role = 'card', language = 'ca' } = {}) {
    const category = resolveCategory(plan, this.guidance);
    const pool = this.byCategory.get(category);
    const item = pool[stableHash(plan.fingerprint || plan.id || plan.title || '') % pool.length];
    const available = this.availableAssets.get(item.id);
    const useCard = role === 'card' && available.card;
    if (!(useCard || available.detail)) return null;
    const filename = useCard ? `card/${item.local_filename}` : item.local_filename;
    return {
      url: `/media/fallbacks/${filename}`,
      kind: 'generic',
      source: 'tenspla-fallback',
      category,
      id: item.id,
      alt: language === 'es' ? item.alt_es : item.alt_ca,
      disclosure: language === 'es' ? item.detail_disclosure_es : item.detail_disclosure_ca,
      photographer: item.photographer,
      sourcePage: item.source_page,
    };
  }
}

let cachedLibrary;

export function loadFallbackImageLibrary({ archivePath = DEFAULT_FALLBACK_ARCHIVE_PATH, assetRoot = DEFAULT_FALLBACK_ASSET_ROOT, assetExists } = {}) {
  if (!assetExists && archivePath === DEFAULT_FALLBACK_ARCHIVE_PATH && assetRoot === DEFAULT_FALLBACK_ASSET_ROOT && cachedLibrary) return cachedLibrary;
  const entries = readZipEntries(archivePath);
  const library = new FallbackImageLibrary({
    manifest: entryByBasename(entries, 'fallback-images.json'),
    guidance: entryByBasename(entries, 'resolver-guidance.json'),
    assetRoot,
    assetExists,
  });
  if (!assetExists && archivePath === DEFAULT_FALLBACK_ARCHIVE_PATH && assetRoot === DEFAULT_FALLBACK_ASSET_ROOT) cachedLibrary = library;
  return library;
}
