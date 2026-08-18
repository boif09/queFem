import { normalizeForFingerprint, nullableString } from './text.normalizer.js';
import { normalizeTicketmasterCategories } from './ticketmasterCategory.normalizer.js';

function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

export function normalizeTicketmasterGroup(group) {
  const record = group.records[0];
  const title = nullableString(record.eventName);
  if (!title) return null;
  const categorySlugs = normalizeTicketmasterCategories(record);
  const location = group.location;
  const plan = {
    kind: 'event',
    fingerprint: ['ticketmaster', normalizeForFingerprint(title, { removeArticles: true }),
      normalizeForFingerprint(location.municipality), normalizeForFingerprint(location.venueName), group.dates.startDate].join('|'),
    original_language: null, original_title: title,
    original_description: nullableString(record.eventInfo),
    title_ca: title, title_es: title, subtitle_ca: null, subtitle_es: null,
    description_ca: nullableString(record.eventInfo), description_es: nullableString(record.eventInfo),
    start_date: group.dates.startDate, end_date: group.dates.endDate,
    schedule_text: group.hours.length ? group.hours.join(', ') : null,
    permanent: 0, price_text: nullableString(record.priceRange || record.priceRanges),
    is_free: null, province: location.province, comarca: null,
    municipality: nullableString(location.municipality), locality: nullableString(location.locality),
    address: typeof location.address === 'object' ? nullableString(location.address.line1) : nullableString(location.address),
    postal_code: location.postalCode, venue_name: nullableString(location.venueName),
    latitude: location.latitude, longitude: location.longitude,
    website_url: null, ticket_url: safeUrl(record.primaryEventUrl),
    image_url: null, image_reuse_allowed: 0,
    family_friendly: categorySlugs.includes('familia') ? 1 : null,
    indoor: null, outdoor: null, recommended_months: null, featured: 0,
    quality_score: Math.min(100, 30 + (record.eventInfo ? 15 : 0) + (location.municipality ? 10 : 0)
      + (location.latitude !== null ? 10 : 0) + (location.address ? 5 : 0) + (record.primaryEventUrl ? 10 : 0)
      + (categorySlugs.length ? 5 : 0)),
    status: record.eventStatus === 'cancelled' ? 'cancelled' : 'active',
  };
  return { plan, categorySlugs };
}
