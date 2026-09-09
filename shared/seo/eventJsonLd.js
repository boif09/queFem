export const PUBLIC_ORIGIN = 'https://tenspla.cat';

export function hasValidCoordinates(latitude, longitude) {
  const valid = (value, minimum, maximum) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
  };
  return valid(latitude, -90, 90) !== null && valid(longitude, -180, 180) !== null;
}

export function compactDescription(value, limit = 160) {
  const compact = value?.replace(/\s+/g, ' ').trim();
  if (!compact || compact.length <= limit) return compact || '';
  const shortened = compact.slice(0, limit - 1);
  return `${shortened.slice(0, shortened.lastIndexOf(' ')) || shortened}…`;
}

export function buildEventJsonLd(plan, url, description) {
  const occurrenceDate = plan.nextOccurrence?.localDate;
  const hasOccurrence = /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate || '');
  const hasStartDate = hasOccurrence || /^\d{4}-\d{2}-\d{2}$/.test(plan.start_date || '');
  const hasCoordinates = hasValidCoordinates(plan.latitude, plan.longitude);
  const address = [plan.address, plan.postal_code, plan.locality, plan.municipality, plan.province]
    .filter(Boolean).join(', ');
  const hasNamedPlace = Boolean(plan.venue_name || plan.address);
  const hasGeographicContext = Boolean(address || hasCoordinates);
  if (!plan.title?.trim() || !hasStartDate || !hasNamedPlace || !hasGeographicContext) return null;
  const event = {
    '@context': 'https://schema.org', '@type': 'Event', name: plan.title, url,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
  };
  if (hasOccurrence) {
    event.startDate = plan.nextOccurrence.localTime ? `${occurrenceDate}T${plan.nextOccurrence.localTime}:00` : occurrenceDate;
  } else {
    event.startDate = plan.start_date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(plan.end_date || '')) event.endDate = plan.end_date;
  }
  if (description) event.description = description;
  if (plan.image?.kind === 'official' && plan.image.jsonld_event_image_eligible === true) event.image = new URL(plan.image.url, PUBLIC_ORIGIN).href;
  event.location = { '@type': 'Place', name: plan.venue_name || plan.address };
  if (address) event.location.address = address;
  if (hasCoordinates) event.location.geo = { '@type': 'GeoCoordinates', latitude: Number(plan.latitude), longitude: Number(plan.longitude) };
  return event;
}
