const CATEGORY_RULES = new Map([
  ['musica', ['concerts', 'music events', 'candlelight concerts', 'classical concerts', 'concerts & music festivals']],
  ['espectacles', ['live shows', 'theater, comedy & shows', 'theatre', 'stand-up comedy', 'dance performances', 'musicals', 'magic & mentalism', 'burlesque & cabaret']],
  ['cultura', ['culture', 'exhibitions', 'cinema', 'immersive experiences & exhibits']],
  ['museus', ['museums & art galleries', 'museums and exhibitions']],
  ['patrimoni', ['landmarks', 'top attractions', 'city tours', 'historical sites']],
  ['gastronomia', ['food & drink', 'restaurants', 'tasting experiences', 'drinks & happy hour', 'restaurant & show']],
  ['familia', ['family']],
  ['fires-mercats', ['markets', 'fairs']],
  ['natura', ['outdoor activities', 'day trips & excursions', 'cruises & boat tours']],
]);

export function feverCategorySlugs(subCategory) {
  const labels = new Set(String(subCategory || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  return [...CATEGORY_RULES].filter(([, signals]) => signals.some((signal) => labels.has(signal)))
    .map(([slug]) => slug);
}

export function normalizeFeverPrice(currentPrice, currency, labels) {
  if (currentPrice === null || currentPrice === undefined) return { type: 'unknown' };
  const raw = typeof currentPrice === 'string' ? currentPrice.trim() : currentPrice;
  if (raw === '') return { type: 'unknown' };
  const amount = typeof raw === 'number' ? raw
    : /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0 || String(currency || '').toUpperCase() !== 'EUR') return { type: 'unknown' };
  const values = (Array.isArray(labels) ? labels : [labels]).filter(Boolean)
    .flatMap((label) => (String(label).match(/\d+(?:[.,]\d+)?/g) || []).map((value) => Number(value.replace(',', '.'))));
  if (values.length && Math.min(...values) !== amount) return { type: 'unknown' };
  if (amount === 0) return { type: 'free', amount: 0, currency: 'EUR' };
  return { type: values.length > 1 ? 'from' : 'fixed', amount, currency: 'EUR' };
}

export function validFeverImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'applications-media.feverup.com'
      && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
