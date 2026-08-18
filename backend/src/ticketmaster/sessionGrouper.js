import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

export function groupDailySessions(items) {
  const groups = new Map();
  for (const item of items) {
    const key = [
      normalizeForFingerprint(item.record.eventName, { removeArticles: true }),
      item.record.venue?.venueId || normalizeForFingerprint(item.location.venueName),
      normalizeForFingerprint(item.location.municipality), item.dates.startDate,
    ].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].map((group) => ({
    records: group.map((item) => item.record),
    location: group[0].location,
    dates: { startDate: group[0].dates.startDate, endDate: group.reduce(
      (latest, item) => item.dates.endDate > latest ? item.dates.endDate : latest,
      group[0].dates.endDate,
    ) },
    hours: [...new Set(group.map((item) => item.record.eventStartLocalTime).filter(Boolean))].sort(),
  }));
}

