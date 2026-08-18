import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

const VIP_SUFFIX = /\s*\|\s*paquetes?\s+vip\s*$/iu;
const ADD_ON_PREFIX = /^\s*(?:upgrade\b|meet\s*&\s*greet\b)/iu;
const ADD_ON_MARKERS = /\b(?:upgrade|meet\s*&\s*greet)\b/giu;

function normalized(value) {
  return normalizeForFingerprint(value, { removeArticles: true });
}

function sameVenueAndPlace(a, b) {
  const aVenue = a.record.venue?.venueId || normalized(a.location.venueName);
  const bVenue = b.record.venue?.venueId || normalized(b.location.venueName);
  return Boolean(aVenue && aVenue === bVenue)
    && normalized(a.location.municipality) === normalized(b.location.municipality);
}

function vipVariant(item, items) {
  if (!VIP_SUFFIX.test(item.record.eventName || '')) return null;
  const baseTitle = normalized(item.record.eventName.replace(VIP_SUFFIX, ''));
  const main = items.find((candidate) => candidate !== item
    && normalized(candidate.record.eventName) === baseTitle
    && candidate.dates.startDate === item.dates.startDate
    && candidate.record.eventStartLocalTime === item.record.eventStartLocalTime
    && sameVenueAndPlace(candidate, item));
  return main ? {
    type: 'PACKAGE_VARIANT', mainEventId: String(main.record.eventId),
    reason: 'unambiguous VIP package suffix with matching main event, date, time, municipality and venue',
  } : null;
}

function addOnVariant(item, items) {
  const title = item.record.eventName || '';
  if (!ADD_ON_PREFIX.test(title)) return null;
  const remainder = normalized(title.replace(ADD_ON_MARKERS, ' '));
  if (!remainder) return null;
  const main = items.find((candidate) => candidate !== item
    && candidate.dates.startDate === item.dates.startDate
    && sameVenueAndPlace(candidate, item)
    && (remainder.includes(normalized(candidate.record.eventName))
      || normalized(candidate.record.eventName).includes(remainder)));
  return main ? {
    type: 'PRODUCT_VARIANT', mainEventId: String(main.record.eventId),
    reason: 'unambiguous upgrade/meet-and-greet prefix with recognizable main event on the same date and venue',
  } : null;
}

export function classifyProductVariants(items) {
  const variants = new Map();
  for (const item of items) {
    const result = vipVariant(item, items) || addOnVariant(item, items);
    if (result) variants.set(String(item.record.eventId), result);
  }
  return variants;
}

export function classifyProductVariant(record) {
  const possible = VIP_SUFFIX.test(record?.eventName || '') || ADD_ON_PREFIX.test(record?.eventName || '');
  return { confirmed: false, possible, reason: possible ? 'title suggests a variant but confirmation requires a matching main event' : null };
}
