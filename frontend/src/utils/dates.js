export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export const CATALONIA_TIME_ZONE = 'Europe/Madrid';

function dateInTimeZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addIsoDays(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return next.toISOString().slice(0, 10);
}

function quickDateRangeFromIso(type, today) {
  if (type === 'today') return { date: today };
  if (type === 'tomorrow') return { date: addIsoDays(today, 1) };
  if (type === 'nextSeven') return { dateFrom: today, dateTo: addIsoDays(today, 6) };
  if (type === 'weekend') {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const daysUntilFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
    const friday = addIsoDays(today, daysUntilFriday);
    return { dateFrom: friday, dateTo: addIsoDays(friday, 2) };
  }
  return {};
}

export function getQuickDateRange(type, today = new Date()) {
  return quickDateRangeFromIso(type, toISODate(today));
}

export function getCataloniaQuickDateRange(type, now = new Date()) {
  return quickDateRangeFromIso(type, dateInTimeZone(now, CATALONIA_TIME_ZONE));
}

export function formatDate(value, language = 'ca') {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'ca-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}
