import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

export const RECURRING_POLICY = Object.freeze({
  minSessions: 80, minActiveDays: 21, minSpanDays: 28,
  minAveragePerActiveDay: 4, minMultiSessionDayRatio: 0.75, minActiveDayRatio: 0.60,
});

function groupKey(item) {
  return [
    normalizeForFingerprint(item.record.eventName, { removeArticles: true }),
    item.record.venue?.venueId || normalizeForFingerprint(item.location.venueName),
    normalizeForFingerprint(item.location.municipality),
  ].join('|');
}

export function detectRecurringInventory(items, policy = RECURRING_POLICY) {
  const groups = new Map();
  for (const item of items) {
    const key = groupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const skippedIds = new Set();
  const details = [];
  for (const group of groups.values()) {
    const days = new Map();
    for (const item of group) days.set(item.dates.startDate, (days.get(item.dates.startDate) || 0) + 1);
    const dates = [...days.keys()].sort();
    const spanDays = dates.length ? Math.round((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86_400_000) + 1 : 0;
    const activeDays = dates.length;
    const sessions = group.length;
    const average = activeDays ? sessions / activeDays : 0;
    const multiRatio = activeDays ? [...days.values()].filter((count) => count > 1).length / activeDays : 0;
    const activeRatio = spanDays ? activeDays / spanDays : 0;
    const recurring = sessions >= policy.minSessions && activeDays >= policy.minActiveDays
      && spanDays >= policy.minSpanDays && average >= policy.minAveragePerActiveDay
      && multiRatio >= policy.minMultiSessionDayRatio && activeRatio >= policy.minActiveDayRatio;
    if (!recurring) continue;
    group.forEach((item) => skippedIds.add(String(item.record.eventId)));
    details.push({
      title: group[0].record.eventName,
      venue: group[0].location.venueName,
      sessions, activeDays, startDate: dates[0], endDate: dates.at(-1),
      reason: `extreme recurring inventory (${sessions} sessions, ${activeDays} active days, ${spanDays}-day span)`,
    });
  }
  return { skippedIds, details };
}

