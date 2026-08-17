export const SEARCH_FILTER_KEYS = [
  'date', 'dateFrom', 'dateTo', 'comarca', 'municipality', 'category', 'free',
];

export function filtersFromSearchParams(searchParams) {
  return Object.fromEntries(
    SEARCH_FILTER_KEYS
      .map((key) => [key, searchParams.get(key) || ''])
      .filter(([, value]) => value !== ''),
  );
}

export function createPlansSearch(filters, extra = {}) {
  const parameters = new URLSearchParams();
  for (const key of SEARCH_FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      parameters.set(key, value === true ? 'true' : String(value));
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') parameters.set(key, String(value));
  }
  return parameters.toString();
}
