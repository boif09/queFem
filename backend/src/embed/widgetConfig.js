import crypto from 'node:crypto';

export const WIDGET_LAYOUTS = new Set(['list', 'grid', 'compact']);
export const WIDGET_THEMES = new Set(['light', 'dark', 'auto']);
export const WIDGET_LANGUAGES = new Set(['ca', 'es']);
export const WIDGET_SECTIONS = new Set(['upcoming', 'permanent']);
export const WIDGET_STATUSES = new Set(['active', 'suspended', 'revoked']);
export const MAX_ALLOWED_ORIGINS = 10;

const KEY_PATTERN = /^wgt_[A-Za-z0-9]{16,40}$/;
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CONFIG_KEYS = new Set([
  'territory', 'categories', 'freeOnly', 'sections', 'windowDays', 'limit',
  'layout', 'theme', 'accent', 'language', 'title',
]);
const TERRITORY_KEYS = new Set(['comarca', 'municipality', 'province', 'fallbackToComarca', 'fallbackMinimum', 'near']);
const NEAR_KEYS = new Set(['latitude', 'longitude', 'radiusKm']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class WidgetConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WidgetConfigError';
  }
}

export function isValidWidgetKey(value) {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

export function generateWidgetKey(randomBytes = crypto.randomBytes) {
  // Rejection sampling keeps every character uniformly distributed.
  let key = 'wgt_';
  while (key.length < 28) {
    for (const byte of randomBytes(32)) {
      if (byte < 248 && key.length < 28) key += KEY_ALPHABET[byte % 62];
    }
  }
  return key;
}

export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new WidgetConfigError('Origen buit.');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WidgetConfigError(`Origen no vàlid: ${value}`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new WidgetConfigError(`L’origen ha de ser https (http només per a localhost): ${value}`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new WidgetConfigError(`Indiqueu només l’origen, sense camí ni paràmetres: ${value}`);
  }
  if (url.hostname.includes('*')) throw new WidgetConfigError(`No s’admeten comodins: ${value}`);
  return url.origin.toLowerCase();
}

export function normalizeOrigins(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new WidgetConfigError('Cal indicar almenys un origen permès.');
  }
  const origins = [...new Set(values.map(normalizeOrigin))];
  if (origins.length > MAX_ALLOWED_ORIGINS) {
    throw new WidgetConfigError(`Com a màxim ${MAX_ALLOWED_ORIGINS} orígens per widget.`);
  }
  return origins;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(object, allowed, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length) throw new WidgetConfigError(`Camp no admès a ${label}: ${unknown.join(', ')}.`);
}

function integerInRange(value, name, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WidgetConfigError(`${name} ha de ser un enter entre ${minimum} i ${maximum}.`);
  }
  return value;
}

function oneOf(value, name, allowed, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.has(value)) throw new WidgetConfigError(`${name} ha de ser ${[...allowed].join(', ')}.`);
  return value;
}

// Radius territory for lodgings: a point, a distance and the municipality that names the place
// (heading and "see all plans" link). Catalonia's bounding box is checked loosely.
function normalizeNear(raw, placeNames) {
  const { near } = raw;
  if (!isPlainObject(near)) throw new WidgetConfigError('near ha de ser {latitude, longitude, radiusKm}.');
  rejectUnknownKeys(near, NEAR_KEYS, 'territory.near');
  const { latitude, longitude, radiusKm } = near;
  if (!Number.isFinite(latitude) || latitude < 40.4 || latitude > 42.95) {
    throw new WidgetConfigError('near.latitude ha de ser un número dins de Catalunya (40.4–42.95).');
  }
  if (!Number.isFinite(longitude) || longitude < 0.1 || longitude > 3.4) {
    throw new WidgetConfigError('near.longitude ha de ser un número dins de Catalunya (0.1–3.4).');
  }
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 50) {
    throw new WidgetConfigError('near.radiusKm ha de ser entre 1 i 50.');
  }
  if (raw.comarca !== undefined || raw.fallbackToComarca !== undefined || raw.fallbackMinimum !== undefined) {
    throw new WidgetConfigError('Amb near només s’admet municipality (el nom del lloc).');
  }
  const municipality = placeNames.findMunicipality(raw.municipality);
  if (!municipality) {
    throw new WidgetConfigError('Amb near cal indicar municipality, un municipi de l’ICGC que doni nom al lloc.');
  }
  return {
    near: {
      latitude: Math.round(latitude * 1e6) / 1e6,
      longitude: Math.round(longitude * 1e6) / 1e6,
      radiusKm: Math.round(radiusKm * 10) / 10,
    },
    municipality: municipality.name,
    comarca: municipality.comarca,
  };
}

function normalizeTerritory(raw, placeNames) {
  if (!isPlainObject(raw)) throw new WidgetConfigError('territory és obligatori.');
  rejectUnknownKeys(raw, TERRITORY_KEYS, 'territory');
  if (raw.near !== undefined) {
    if (raw.province !== undefined) throw new WidgetConfigError('Amb near només s’admet municipality (el nom del lloc).');
    return normalizeNear(raw, placeNames);
  }
  if (raw.province !== undefined) {
    if (Object.keys(raw).length > 1) throw new WidgetConfigError('province no es pot combinar amb altres camps de territory.');
    const province = placeNames.findProvince(raw.province);
    if (!province) throw new WidgetConfigError(`Província desconeguda: ${raw.province}`);
    return { province: province.name };
  }
  if (raw.municipality !== undefined) {
    const municipality = placeNames.findMunicipality(raw.municipality);
    if (!municipality) throw new WidgetConfigError(`Municipi desconegut a l’ICGC: ${raw.municipality}`);
    if (raw.comarca !== undefined) {
      throw new WidgetConfigError('Amb municipality, la comarca es dedueix de l’ICGC; no la indiqueu.');
    }
    const fallbackToComarca = raw.fallbackToComarca === undefined ? true : raw.fallbackToComarca;
    if (typeof fallbackToComarca !== 'boolean') throw new WidgetConfigError('fallbackToComarca ha de ser booleà.');
    return {
      municipality: municipality.name,
      comarca: municipality.comarca,
      fallbackToComarca,
      fallbackMinimum: integerInRange(raw.fallbackMinimum, 'fallbackMinimum', 3, 1, 24),
    };
  }
  if (raw.comarca !== undefined) {
    if (raw.fallbackToComarca !== undefined || raw.fallbackMinimum !== undefined) {
      throw new WidgetConfigError('fallbackToComarca només s’aplica a un municipi.');
    }
    const comarca = placeNames.findComarca(raw.comarca);
    if (!comarca) throw new WidgetConfigError(`Comarca desconeguda a l’ICGC: ${raw.comarca}`);
    return { comarca: comarca.name };
  }
  throw new WidgetConfigError('territory ha d’indicar municipality, comarca, province o near.');
}

function normalizeTitle(raw) {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) throw new WidgetConfigError('title ha de ser un objecte {ca, es}.');
  rejectUnknownKeys(raw, WIDGET_LANGUAGES, 'title');
  const title = {};
  for (const [language, text] of Object.entries(raw)) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 80) {
      throw new WidgetConfigError(`title.${language} ha de tenir entre 1 i 80 caràcters.`);
    }
    title[language] = text.trim();
  }
  return title;
}

export function normalizeWidgetConfig(raw, { placeNames, categorySlugs }) {
  if (!isPlainObject(raw)) throw new WidgetConfigError('La configuració ha de ser un objecte JSON.');
  rejectUnknownKeys(raw, CONFIG_KEYS, 'la configuració');

  let categories = [];
  if (raw.categories !== undefined) {
    if (!Array.isArray(raw.categories) || raw.categories.length > 10) {
      throw new WidgetConfigError('categories ha de ser una llista de fins a 10 slugs.');
    }
    categories = [...new Set(raw.categories)];
    const unknown = categories.filter((slug) => typeof slug !== 'string' || !categorySlugs.has(slug));
    if (unknown.length) throw new WidgetConfigError(`Categoria desconeguda: ${unknown.join(', ')}.`);
  }

  let sections = ['upcoming'];
  if (raw.sections !== undefined) {
    if (!Array.isArray(raw.sections) || raw.sections.length === 0
      || raw.sections.some((section) => !WIDGET_SECTIONS.has(section))) {
      throw new WidgetConfigError('sections ha de contenir upcoming i/o permanent.');
    }
    sections = [...new Set(raw.sections)];
  }

  if (raw.freeOnly !== undefined && typeof raw.freeOnly !== 'boolean') {
    throw new WidgetConfigError('freeOnly ha de ser booleà.');
  }
  if (raw.accent !== undefined && (typeof raw.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(raw.accent))) {
    throw new WidgetConfigError('accent ha de ser un color #rrggbb.');
  }

  const config = {
    territory: normalizeTerritory(raw.territory, placeNames),
    categories,
    freeOnly: raw.freeOnly === true,
    sections,
    windowDays: integerInRange(raw.windowDays, 'windowDays', 30, 1, 90),
    limit: integerInRange(raw.limit, 'limit', 8, 1, 24),
    layout: oneOf(raw.layout, 'layout', WIDGET_LAYOUTS, 'list'),
    theme: oneOf(raw.theme, 'theme', WIDGET_THEMES, 'light'),
    accent: (raw.accent || '#0055ff').toLowerCase(),
    language: oneOf(raw.language, 'language', WIDGET_LANGUAGES, 'ca'),
  };
  const title = normalizeTitle(raw.title);
  if (title) config.title = title;
  return config;
}
