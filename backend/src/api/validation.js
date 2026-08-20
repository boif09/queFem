const PLAN_QUERY_PARAMETERS = new Set([
  'q', 'date', 'dateFrom', 'dateTo', 'province', 'comarca', 'municipality',
  'category', 'free', 'family', 'indoor', 'outdoor', 'kind',
  'page', 'limit', 'sort', 'lang',
]);
const KINDS = new Set(['event', 'place', 'route', 'beach', 'nature', 'activity']);
const SORTS = new Set(['date', 'quality', 'title']);
const LANGUAGES = new Set(['ca', 'es']);
export const MAX_PLANS_PAGE = 200;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.code = 'INVALID_PARAMETER';
  }
}

function singleString(value, name, { required = false, maxLength = 120 } = {}) {
  if (value === undefined) {
    if (required) throw new ValidationError(`El paràmetre ${name} és obligatori.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`El paràmetre ${name} només es pot indicar una vegada.`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`El paràmetre ${name} no pot estar buit.`);
  if (trimmed.length > maxLength) throw new ValidationError(`El paràmetre ${name} és massa llarg.`);
  return trimmed;
}

function optionalSearchQuery(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError('El paràmetre q només es pot indicar una vegada.');
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 100) throw new ValidationError('El paràmetre q és massa llarg.');
  return trimmed;
}

function integer(value, name, fallback, minimum, maximum) {
  if (value === undefined) return fallback;
  const text = singleString(value, name);
  if (!/^\d+$/.test(text)) throw new ValidationError(`El paràmetre ${name} ha de ser un enter.`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ValidationError(`El paràmetre ${name} ha d’estar entre ${minimum} i ${maximum}.`);
  }
  return parsed;
}

function boolean(value, name) {
  if (value === undefined) return undefined;
  const text = singleString(value, name).toLowerCase();
  if (['true', '1'].includes(text)) return 1;
  if (['false', '0'].includes(text)) return 0;
  throw new ValidationError(`El paràmetre ${name} ha de ser true, false, 1 o 0.`);
}

function isoDate(value, name) {
  if (value === undefined) return undefined;
  const text = singleString(value, name);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new ValidationError(`El paràmetre ${name} ha de tenir el format YYYY-MM-DD.`);
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ValidationError(`El paràmetre ${name} no és una data vàlida.`);
  }
  return text;
}

export function validateLanguage(value, fallback = 'ca') {
  const language = value === undefined ? fallback : singleString(value, 'lang', { maxLength: 2 });
  if (!LANGUAGES.has(language)) throw new ValidationError('El paràmetre lang ha de ser ca o es.');
  return language;
}

export function rejectUnknownParameters(query, allowed) {
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(`Paràmetre no admès: ${unknown.join(', ')}.`);
  }
}

export function validatePlansQuery(query, defaultLanguage = 'ca') {
  rejectUnknownParameters(query, PLAN_QUERY_PARAMETERS);
  const date = isoDate(query.date, 'date');
  const dateFrom = isoDate(query.dateFrom, 'dateFrom');
  const dateTo = isoDate(query.dateTo, 'dateTo');
  if (date && (dateFrom || dateTo)) {
    throw new ValidationError('date no es pot combinar amb dateFrom o dateTo.');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError('dateFrom no pot ser posterior a dateTo.');
  }

  const kind = singleString(query.kind, 'kind');
  if (kind && !KINDS.has(kind)) throw new ValidationError(`Tipus de pla no admès: ${kind}.`);
  const sort = singleString(query.sort, 'sort') || 'date';
  if (!SORTS.has(sort)) {
    throw new ValidationError('El paràmetre sort ha de ser date, quality o title.');
  }
  const category = singleString(query.category, 'category');
  if (category && !/^[a-z0-9-]+$/.test(category)) {
    throw new ValidationError('El paràmetre category ha de ser un slug vàlid.');
  }

  return {
    q: optionalSearchQuery(query.q),
    date,
    dateFrom,
    dateTo,
    province: singleString(query.province, 'province'),
    comarca: singleString(query.comarca, 'comarca'),
    municipality: singleString(query.municipality, 'municipality'),
    category,
    free: boolean(query.free, 'free'),
    family: boolean(query.family, 'family'),
    indoor: boolean(query.indoor, 'indoor'),
    outdoor: boolean(query.outdoor, 'outdoor'),
    kind,
    page: integer(query.page, 'page', 1, 1, MAX_PLANS_PAGE),
    limit: integer(query.limit, 'limit', 20, 1, 100),
    sort,
    lang: validateLanguage(query.lang, defaultLanguage),
  };
}

export function validatePlanId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ValidationError('L’identificador del pla ha de ser un enter positiu.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new ValidationError('L’identificador del pla no és vàlid.');
  return id;
}

export function validateMunicipalitiesQuery(query) {
  rejectUnknownParameters(query, new Set(['comarca']));
  return { comarca: singleString(query.comarca, 'comarca') };
}

export function validateNoQueryParameters(query) {
  rejectUnknownParameters(query, new Set());
}
