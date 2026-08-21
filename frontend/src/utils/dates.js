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

export function getQuickDateRange(type, today = new Date()) {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (type === 'today') return { date: toISODate(startOfToday) };
  if (type === 'tomorrow') return { date: toISODate(addDays(startOfToday, 1)) };
  if (type === 'nextSeven') {
    return { dateFrom: toISODate(startOfToday), dateTo: toISODate(addDays(startOfToday, 6)) };
  }
  if (type === 'weekend') {
    const day = startOfToday.getDay();
    const daysUntilFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
    const friday = addDays(startOfToday, daysUntilFriday);
    return { dateFrom: toISODate(day === 0 || day === 6 ? startOfToday : friday), dateTo: toISODate(addDays(friday, 2)) };
  }
  return {};
}

export function formatDate(value, language = 'ca') {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'ca-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}
