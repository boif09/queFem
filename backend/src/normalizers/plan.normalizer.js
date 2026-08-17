import { normalizeCategories, isFamilyFriendly } from './category.normalizer.js';
import { normalizeLocation } from './location.normalizer.js';
import { normalizeForFingerprint, nullableString, stripHtml } from './text.normalizer.js';

function parseDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function sourceBoolean(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (['si', 'yes', 'true', '1'].includes(normalized)) return 1;
  if (['no', 'false', '0'].includes(normalized)) return 0;
  return null;
}

function parseCoordinate(value, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeUrl(value) {
  const candidate = nullableString(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function qualityScore(plan, categorySlugs) {
  const checks = [
    [plan.original_title, 15],
    [plan.original_description, 15],
    [plan.start_date || plan.permanent, 10],
    [plan.municipality, 10],
    [plan.comarca, 5],
    [plan.latitude !== null && plan.longitude !== null, 10],
    [plan.address, 5],
    [plan.website_url, 10],
    [plan.price_text || plan.is_free !== null, 5],
    [plan.schedule_text, 5],
    [categorySlugs.length > 0, 5],
  ];
  return Math.min(100, 5 + checks.reduce((score, [present, points]) => score + (present ? points : 0), 0));
}

export function normalizePlan(record) {
  const originalTitle = nullableString(record.denominaci);
  if (!record.codi || !originalTitle) return null;

  const location = normalizeLocation(record);
  const startDate = parseDate(record.data_inici);
  const categories = normalizeCategories(record);
  const permanent = sourceBoolean(record.permanent) ?? 0;
  const fingerprint = [
    normalizeForFingerprint(originalTitle, { removeArticles: true }),
    normalizeForFingerprint(location.municipality),
    startDate || (permanent ? 'permanent' : 'sense-data'),
  ].join('|');

  const plan = {
    kind: 'event',
    fingerprint,
    original_language: 'ca',
    original_title: record.denominaci,
    original_description: nullableString(record.descripcio),
    title_ca: record.denominaci,
    title_es: null,
    subtitle_ca: stripHtml(record.subt_tol),
    subtitle_es: null,
    description_ca: nullableString(record.descripcio),
    description_es: null,
    start_date: startDate,
    end_date: parseDate(record.data_fi),
    schedule_text: stripHtml(record.horari),
    permanent,
    price_text: stripHtml(record.entrades),
    is_free: sourceBoolean(record.gratuita),
    ...location,
    address: nullableString(record.adre_a),
    postal_code: nullableString(record.codi_postal),
    venue_name: nullableString(record.espai),
    latitude: parseCoordinate(record.latitud, -90, 90),
    longitude: parseCoordinate(record.longitud, -180, 180),
    website_url: safeUrl(record.urlactivitat) || safeUrl(record.enllac1_url) || safeUrl(record.url),
    ticket_url: safeUrl(record.linkbotoentrades),
    image_url: null,
    image_reuse_allowed: 0,
    family_friendly: isFamilyFriendly(record),
    indoor: null,
    outdoor: null,
    recommended_months: null,
    featured: sourceBoolean(record.destacada) ?? 0,
    quality_score: 0,
    status: 'active',
  };
  plan.quality_score = qualityScore(plan, categories);

  return { plan, categorySlugs: categories };
}
